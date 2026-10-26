import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 1_000_000


def load_env():
    values = {}
    env_path = ROOT / ".env"
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def model_endpoint(model_url):
    parsed = urlsplit(model_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("MODEL_URL must be a complete HTTP(S) URL.")
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        endpoint_path = path
    elif path.endswith("/v1"):
        endpoint_path = path + "/chat/completions"
    else:
        endpoint_path = path + "/v1/chat/completions"
    return urlunsplit((parsed.scheme, parsed.netloc, endpoint_path, parsed.query, ""))


def extract_html(response_data):
    choices = response_data.get("choices", [])
    if choices:
        content = choices[0].get("message", {}).get("content", "")
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        if content:
            return str(content)
    for key in ("response", "output", "text", "content"):
        if response_data.get(key):
            return str(response_data[key])
    raise ValueError("The model response did not include generated content.")


def clean_html(content):
    content = content.strip()
    content = re.sub(r"^```(?:html)?\s*", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\s*```$", "", content)
    start = content.lower().find("<!doctype html")
    if start < 0:
        start = content.lower().find("<html")
    if start >= 0:
        content = content[start:]
    return content.strip()


def generate_page(prompt, current_html=""):
    env = load_env()
    api_key = os.environ.get("API_KEY") or env.get("API_KEY", "")
    model_url = os.environ.get("MODEL_URL") or env.get("MODEL_URL", "")
    model_name = os.environ.get("MODEL_NAME") or env.get("MODEL_NAME", "")
    if not model_url:
        raise ValueError("Add MODEL_URL to .env to connect your Gemma endpoint.")
    if not api_key:
        raise ValueError("Add API_KEY to .env to connect your Gemma endpoint.")
    if not model_name:
        raise ValueError("Add MODEL_NAME to .env to identify the Gemma model.")

    system_prompt = (
        "You are a senior web designer and frontend developer. Return one complete, "
        "self-contained HTML document and nothing else. Put all CSS in a style tag. "
        "Use semantic accessible markup, responsive layouts, polished typography, "
        "and real image URLs from images.unsplash.com when imagery helps. Do not use "
        "external JavaScript libraries. Preserve existing working content when asked "
        "to revise a project."
    )
    user_prompt = prompt
    if current_html:
        user_prompt += "\n\nCurrent project HTML:\n" + current_html[:80_000]
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.7,
    }
    request = Request(
        model_endpoint(model_url),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError("The model endpoint returned HTTP " + str(error.code) + ".") from None
    except URLError:
        raise RuntimeError("Could not reach the model endpoint. Check MODEL_URL and network access.") from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError("The model endpoint returned an unreadable response.") from None
    return clean_html(extract_html(response_data))


class StudioHandler(BaseHTTPRequestHandler):
    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
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
        if self.path not in ("/", "/index.html"):
            self.send_error(404)
            return
        page = (ROOT / "index.html").read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(page)

    def do_POST(self):
        if self.path != "/api/generate":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_REQUEST_BYTES:
                self.send_json(413, {"error": "Request size is outside the allowed limit."})
                return
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            prompt = data.get("prompt", "").strip()
            if not prompt:
                self.send_json(400, {"error": "Write a prompt before generating."})
                return
            if len(prompt) > 20_000:
                self.send_json(413, {"error": "Prompt is too long."})
                return
            html = generate_page(prompt, data.get("currentHtml", ""))
            self.send_json(200, {"html": html})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Request body must be valid JSON."})
        except RuntimeError as error:
            self.send_json(502, {"error": str(error)})
        except Exception:
            self.send_json(500, {"error": "Something went wrong while generating the page."})

    def log_message(self, format_string, *args):
        print("%s - %s" % (self.address_string(), format_string % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5173"))
    server = ThreadingHTTPServer(("127.0.0.1", port), StudioHandler)
    print("Studio running at http://127.0.0.1:%s" % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStudio stopped.")
        server.server_close()