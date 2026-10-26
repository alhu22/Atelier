import json
import mimetypes
import os
import re
import secrets
import threading
import time
import traceback
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen

from .config import MAX_PROJECT_FILES, MAX_REQUEST_BYTES, ROOT, load_env, setting
from .github import (
    GITHUB_ACCESS_TOKEN,
    GITHUB_AUTHORIZE,
    GITHUB_SESSION_COOKIE,
    GITHUB_SESSION_TTL_SECONDS,
    GITHUB_STATE_COOKIE,
    github_api_request,
    github_configured,
    github_export,
    github_lock,
    github_sessions,
    github_states,
)
from .model import generate_project, model_endpoint, validate_project_files


class StudioHandler(BaseHTTPRequestHandler):
    def send_json(self, status, data, cookies=()):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def send_redirect(self, location, cookies=()):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def github_session_id(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(GITHUB_SESSION_COOKIE)
        return morsel.value if morsel else None

    def github_state_cookie(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(GITHUB_STATE_COOKIE)
        return morsel.value if morsel else None

    def github_session(self):
        session_id = self.github_session_id()
        if not session_id:
            return None
        now = time.time()
        with github_lock:
            session = github_sessions.get(session_id)
            if not session or session["expires_at"] <= now:
                github_sessions.pop(session_id, None)
                return None
            return session

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Content-Length is invalid."})
            return None
        if length < 1 or length > MAX_REQUEST_BYTES:
            self.send_json(413, {"error": "Request size is outside the allowed limit."})
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Request body must be valid JSON."})
            return None
        if not isinstance(data, dict):
            self.send_json(400, {"error": "Request body must be a JSON object."})
            return None
        return data

    def handle_github_callback(self, query):
        env = load_env()
        redirect_uri = setting("GITHUB_REDIRECT_URI", env) or (
            "http://127.0.0.1:" + str(self.server.server_port) + "/api/github/callback"
        )
        secure = "; Secure" if urlsplit(redirect_uri).scheme == "https" else ""
        state_cookie = (
            GITHUB_STATE_COOKIE + "=; HttpOnly; SameSite=Lax; Path=/api/github/callback; Max-Age=0" + secure
        )
        if query.get("error"):
            self.send_redirect("/?github=error", [state_cookie])
            return
        state = query.get("state", [""])[0]
        code = query.get("code", [""])[0]
        now = time.time()
        with github_lock:
            for expired_state, created_at in list(github_states.items()):
                if created_at + 600 < now:
                    github_states.pop(expired_state, None)
            state_created = github_states.pop(state, None)
        if (
            not state
            or not self.github_state_cookie()
            or not secrets.compare_digest(state, self.github_state_cookie())
            or state_created is None
            or state_created + 600 < now
            or not code
        ):
            self.send_redirect("/?github=error", [state_cookie])
            return

        client_id = setting("GITHUB_CLIENT_ID", env)
        client_secret = setting("GITHUB_CLIENT_SECRET", env)
        body = urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "state": state,
        }).encode("utf-8")
        request = Request(
            GITHUB_ACCESS_TOKEN,
            data=body,
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                token_response = json.loads(response.read().decode("utf-8"))
            access_token = token_response.get("access_token") if isinstance(token_response, dict) else None
            scope = token_response.get("scope", "") if isinstance(token_response, dict) else ""
            if not access_token:
                oauth_error = token_response.get("error") if isinstance(token_response, dict) else None
                if isinstance(oauth_error, str) and re.fullmatch(r"[A-Za-z0-9_ -]{1,100}", oauth_error):
                    print("GitHub OAuth token exchange rejected: " + oauth_error, flush=True)
                else:
                    print("GitHub OAuth token exchange returned no access token.", flush=True)
                self.send_redirect("/?github=error", [state_cookie])
                return
            if not isinstance(scope, str) or "repo" not in scope.split(","):
                print("GitHub OAuth token was issued without the required repo scope.", flush=True)
                self.send_redirect("/?github=error", [state_cookie])
                return
            user = github_api_request("/user", access_token)
            login = user.get("login") if isinstance(user, dict) else None
            if not login:
                print("GitHub OAuth token was accepted, but the user profile had no login.", flush=True)
                self.send_redirect("/?github=error", [state_cookie])
                return
        except HTTPError as error:
            print("GitHub OAuth callback failed with HTTP " + str(error.code) + ".", flush=True)
            self.send_redirect("/?github=error", [state_cookie])
            return
        except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError, RuntimeError) as error:
            print("GitHub OAuth callback failed: " + type(error).__name__ + ".", flush=True)
            self.send_redirect("/?github=error", [state_cookie])
            return

        session_id = secrets.token_urlsafe(32)
        with github_lock:
            github_sessions[session_id] = {
                "access_token": access_token,
                "login": login,
                "expires_at": now + GITHUB_SESSION_TTL_SECONDS,
            }
        session_cookie = (
            GITHUB_SESSION_COOKIE + "=" + session_id
            + "; HttpOnly; SameSite=Lax; Path=/api/github; Max-Age="
            + str(GITHUB_SESSION_TTL_SECONDS) + secure
        )
        self.send_redirect("/?github=connected", [state_cookie, session_cookie])

    def do_GET(self):
        parsed_url = urlsplit(self.path)
        if parsed_url.path == "/api/github/login":
            env = load_env()
            client_id = setting("GITHUB_CLIENT_ID", env)
            client_secret = setting("GITHUB_CLIENT_SECRET", env)
            if not client_id or not client_secret:
                self.send_json(503, {"error": "Configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env first."})
                return
            state = secrets.token_urlsafe(32)
            with github_lock:
                for expired_state, created_at in list(github_states.items()):
                    if created_at + 600 < time.time():
                        github_states.pop(expired_state, None)
                if len(github_states) >= 1000:
                    oldest = min(github_states, key=github_states.get)
                    github_states.pop(oldest, None)
                github_states[state] = time.time()
            redirect_uri = setting("GITHUB_REDIRECT_URI", env) or (
                "http://127.0.0.1:" + str(self.server.server_port) + "/api/github/callback"
            )
            location = GITHUB_AUTHORIZE + "?" + urlencode({
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "scope": "repo",
                "state": state,
            })
            secure = "; Secure" if urlsplit(redirect_uri).scheme == "https" else ""
            state_cookie = (
                GITHUB_STATE_COOKIE + "=" + state
                + "; HttpOnly; SameSite=Lax; Path=/api/github/callback; Max-Age=600" + secure
            )
            self.send_redirect(location, [state_cookie])
            return
        if parsed_url.path == "/api/github/callback":
            self.handle_github_callback(parse_qs(parsed_url.query))
            return
        if parsed_url.path == "/api/github/status":
            session = self.github_session()
            self.send_json(200, {
                "configured": github_configured(),
                "connected": session is not None,
                "login": session.get("login") if session else None,
            })
            return
        if parsed_url.path == "/api/github/repos":
            session = self.github_session()
            if not session:
                self.send_json(401, {"error": "Connect GitHub to list repositories."})
                return
            try:
                repositories = []
                for page in range(1, 1001):
                    path = "/user/repos?" + urlencode({
                        "affiliation": "owner,collaborator,organization_member",
                        "per_page": 100,
                        "page": page,
                        "sort": "updated",
                    })
                    batch = github_api_request(path, session["access_token"])
                    if not isinstance(batch, list):
                        raise RuntimeError("GitHub returned an unexpected repository list.")
                    repositories.extend({
                        "full_name": repo.get("full_name"),
                        "private": repo.get("private", False),
                        "default_branch": repo.get("default_branch"),
                    } for repo in batch if isinstance(repo, dict) and repo.get("full_name"))
                    if len(batch) < 100:
                        break
                self.send_json(200, {"repositories": repositories})
            except RuntimeError as error:
                self.send_json(502, {"error": str(error)})
            return
        if self.path == "/api/health":
            env = load_env()
            model_url = os.environ.get("MODEL_URL") or env.get("MODEL_URL", "")
            try:
                model_endpoint(model_url)
                configured = True
            except ValueError:
                configured = False
            self.send_json(200, {"modelConfigured": configured})
            return
        frontend_root = (ROOT / "dist").resolve()
        if not (frontend_root / "index.html").is_file():
            self.send_error(503, "Frontend build missing. Run npm run build.")
            return
        requested_path = unquote(parsed_url.path).lstrip("/")
        if not requested_path or requested_path in {"users", "users.html", "index.html"}:
            static_file = frontend_root / "index.html"
        else:
            static_file = (frontend_root / requested_path).resolve()
            try:
                static_file.relative_to(frontend_root)
            except ValueError:
                self.send_error(404)
                return
            if not static_file.is_file():
                if "." not in Path(requested_path).name:
                    static_file = frontend_root / "index.html"
                else:
                    self.send_error(404)
                    return
        page = static_file.read_bytes()
        content_type = mimetypes.guess_type(static_file.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {
            "application/javascript",
            "application/json",
        }:
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(page)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(page)

    def do_POST(self):
        parsed_url = urlsplit(self.path)
        if parsed_url.path == "/api/github/logout":
            session_id = self.github_session_id()
            if session_id:
                with github_lock:
                    github_sessions.pop(session_id, None)
            self.send_json(
                200,
                {"connected": False},
                [GITHUB_SESSION_COOKIE + "=; HttpOnly; SameSite=Lax; Path=/api/github; Max-Age=0"],
            )
            return
        if parsed_url.path == "/api/github/export":
            session = self.github_session()
            if not session:
                self.send_json(401, {"error": "Connect GitHub before exporting."})
                return
            data = self.read_json_body()
            if data is None:
                return
            try:
                result = github_export(
                    session["access_token"],
                    data.get("repository"),
                    data.get("branch", ""),
                    data.get("projectName", ""),
                    data.get("files"),
                )
                self.send_json(200, result)
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
            except RuntimeError as error:
                self.send_json(502, {"error": str(error)})
            return
        if parsed_url.path != "/api/generate":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_REQUEST_BYTES:
                self.send_json(413, {"error": "Request size is outside the allowed limit."})
                return
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict):
                self.send_json(400, {"error": "Request body must be a JSON object."})
                return
            prompt = data.get("prompt", "")
            if not isinstance(prompt, str):
                self.send_json(400, {"error": "Prompt must be text."})
                return
            prompt = prompt.strip()
            if not prompt:
                self.send_json(400, {"error": "Write a prompt before generating."})
                return
            if len(prompt) > 20_000:
                self.send_json(413, {"error": "Prompt is too long."})
                return
            current_files = data.get("currentFiles")
            if current_files is None:
                legacy_html = data.get("currentHtml", "")
                if not isinstance(legacy_html, str):
                    self.send_json(400, {"error": "Current project HTML must be text."})
                    return
                current_files = {"index.html": legacy_html} if legacy_html else None
            current_entrypoint = data.get("currentEntrypoint", "index.html")
            current_assets = data.get("currentAssets", [])
            if (
                not isinstance(current_assets, list)
                or len(current_assets) > MAX_PROJECT_FILES
                or any(not isinstance(path, str) or len(path) > 240 for path in current_assets)
            ):
                self.send_json(400, {"error": "Current project asset paths are invalid."})
                return
            if current_files is not None:
                try:
                    current_files, current_entrypoint = validate_project_files(current_files, current_entrypoint)
                except RuntimeError as error:
                    self.send_json(400, {"error": "Current project files are invalid: " + str(error)})
                    return
            files, entrypoint = generate_project(prompt, current_files, current_entrypoint, current_assets)
            self.send_json(200, {"files": files, "entrypoint": entrypoint})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Request body must be valid JSON."})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except RuntimeError as error:
            self.send_json(502, {"error": str(error)})
        except Exception:
            traceback.print_exc()
            self.send_json(
                500,
                {"error": "Unexpected server error. Check the server terminal for details."},
            )

    def log_message(self, format_string, *args):
        print("%s - %s" % (self.address_string(), format_string % args))
