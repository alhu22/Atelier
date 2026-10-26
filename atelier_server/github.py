import base64
import binascii
import json
import re
import threading
from posixpath import normpath
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .config import MAX_PROJECT_BYTES, MAX_PROJECT_FILES, setting

GITHUB_API = "https://api.github.com"
GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize"
GITHUB_ACCESS_TOKEN = "https://github.com/login/oauth/access_token"
GITHUB_SESSION_COOKIE = "atelier_github_session"
GITHUB_STATE_COOKIE = "atelier_github_oauth_state"
GITHUB_SESSION_TTL_SECONDS = 12 * 60 * 60

github_sessions = {}
github_states = {}
github_lock = threading.Lock()

def github_configured():
    return bool(setting("GITHUB_CLIENT_ID") and setting("GITHUB_CLIENT_SECRET"))

def github_api_request(path, token, method="GET", body=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(GITHUB_API + path, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            response_data = response.read()
    except HTTPError as error:
        try:
            error_data = json.loads(error.read().decode("utf-8"))
            message = error_data.get("message") if isinstance(error_data, dict) else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            message = None
        raise RuntimeError(message or "GitHub API returned HTTP " + str(error.code) + ".") from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("Could not reach GitHub. Check your network connection and try again.") from None
    if not response_data:
        return None
    try:
        return json.loads(response_data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError("GitHub returned an unreadable response.") from None

def github_export(token, repository, branch, project_name, files):
    if not isinstance(repository, str) or not re.fullmatch(
        r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository
    ):
        raise ValueError("Select a valid GitHub repository.")
    if not isinstance(files, dict) or not files or len(files) > MAX_PROJECT_FILES:
        raise ValueError("The project file list is invalid.")
    if not isinstance(project_name, str) or len(project_name) > 120:
        raise ValueError("The project name is invalid.")
    if not isinstance(branch, str):
        raise ValueError("The branch name is invalid.")

    normalized = {}
    total_bytes = 0
    for path, content in files.items():
        if not isinstance(path, str) or not isinstance(content, str):
            raise ValueError("Project paths and file contents must be text.")
        normalized_path = normpath(path.replace("\\", "/"))
        if (
            not re.fullmatch(r"[A-Za-z0-9_./-]+", path)
            or normalized_path != path
            or path.startswith("/")
            or path in (".", "..")
            or path.startswith("../")
        ):
            raise ValueError("The project contains an unsafe file path.")
        if content.startswith("data:"):
            match = re.fullmatch(r"data:([^;,]+);base64,([\s\S]*)", content)
            if not match:
                raise ValueError("The project contains an invalid uploaded asset.")
            try:
                file_bytes = base64.b64decode(match.group(2), validate=True)
            except (ValueError, binascii.Error):
                raise ValueError("The project contains an invalid uploaded asset.") from None
        else:
            file_bytes = content.encode("utf-8")
        total_bytes += len(file_bytes)
        if total_bytes > MAX_PROJECT_BYTES:
            raise ValueError("The project is too large to export (700 KB maximum).")
        normalized[path] = base64.b64encode(file_bytes).decode("ascii")

    repository_info = github_api_request("/repos/" + repository, token)
    branch = (branch or "").strip() or repository_info.get("default_branch")
    if not isinstance(branch, str) or not branch:
        raise RuntimeError("This repository has no default branch. Add an initial commit on GitHub first.")
    encoded_branch = "/".join(quote(part, safe="") for part in branch.split("/"))
    base_path = "/repos/" + repository
    reference = github_api_request(base_path + "/git/ref/heads/" + encoded_branch, token)
    parent = github_api_request(base_path + "/git/commits/" + reference["object"]["sha"], token)
    tree = []
    for path, content in normalized.items():
        blob = github_api_request(
            base_path + "/git/blobs",
            token,
            method="POST",
            body={"content": content, "encoding": "base64"},
        )
        tree.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    next_tree = github_api_request(
        base_path + "/git/trees",
        token,
        method="POST",
        body={"base_tree": parent["tree"]["sha"], "tree": tree},
    )
    commit = github_api_request(
        base_path + "/git/commits",
        token,
        method="POST",
        body={
            "message": "Export " + (project_name or "Atelier project"),
            "tree": next_tree["sha"],
            "parents": [parent["sha"]],
        },
    )
    github_api_request(
        base_path + "/git/refs/heads/" + encoded_branch,
        token,
        method="PATCH",
        body={"sha": commit["sha"], "force": False},
    )
    return {"message": "Exported " + str(len(normalized)) + " files to " + repository + " (" + branch + ")."}
