import json
import os
import re
from http.client import RemoteDisconnected
from pathlib import Path
from posixpath import normpath
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from .config import (
    MAX_PROJECT_BYTES,
    MAX_PROJECT_FILES,
    MODEL_REQUEST_TIMEOUT_SECONDS,
    PROJECT_FILE_EXTENSIONS,
    load_env,
)

def model_endpoint(model_url):
    parsed = urlsplit(model_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("MODEL_URL must be a complete HTTP(S) URL.")
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        endpoint_path = path
    elif path.endswith("/v1/models"):
        endpoint_path = path[: -len("/models")] + "/chat/completions"
    elif path.endswith("/v1"):
        endpoint_path = path + "/chat/completions"
    else:
        endpoint_path = path + "/v1/chat/completions"
    return urlunsplit((parsed.scheme, parsed.netloc, endpoint_path, parsed.query, ""))

def extract_model_text(response_data):
    if not isinstance(response_data, dict):
        raise RuntimeError("The model endpoint returned an unsupported response format.")
    choices = response_data.get("choices", [])
    if isinstance(choices, list) and choices:
        choice = choices[0]
        if not isinstance(choice, dict):
            raise RuntimeError("The model endpoint returned an unsupported response format.")
        message = choice.get("message")
        if not isinstance(message, dict):
            raise RuntimeError("The model endpoint returned no assistant message.")
        content = message.get("content", "")
        if isinstance(content, list):
            content = "".join(
                str(part.get("text", "") or "") if isinstance(part, dict) else str(part)
                for part in content
            )
        if isinstance(content, str) and content.strip():
            return content.strip()
    for key in ("response", "output", "text", "content"):
        content = response_data.get(key)
        if isinstance(content, str) and content.strip():
            return content.strip()
    raise RuntimeError("The model response did not include generated text.")

def validate_project_files(files, entrypoint):
    if not isinstance(files, dict) or not files or len(files) > MAX_PROJECT_FILES:
        raise RuntimeError("The model returned an invalid project file list.")
    normalized = {}
    total_bytes = 0
    for file_path, content in files.items():
        if not isinstance(file_path, str) or not isinstance(content, str):
            raise RuntimeError("Project paths and file contents must be text.")
        path = normpath(file_path.replace("\\", "/"))
        suffix = Path(path).suffix.lower()
        if (
            not re.fullmatch(r"[A-Za-z0-9_./-]+", file_path)
            or path.startswith("/")
            or path in (".", "..")
            or path.startswith("../")
            or path != file_path
            or suffix not in PROJECT_FILE_EXTENSIONS
        ):
            raise RuntimeError("The model returned an unsafe or unsupported project file path.")
        total_bytes += len(content.encode("utf-8"))
        normalized[path] = content
    if total_bytes > MAX_PROJECT_BYTES:
        raise RuntimeError("The generated project is too large. Keep it under 700 KB.")
    if not isinstance(entrypoint, str) or entrypoint not in normalized:
        raise RuntimeError("The generated project is missing its HTML entry page.")
    if Path(entrypoint).suffix.lower() != ".html":
        raise RuntimeError("The project entry page must be an HTML file.")
    return normalized, entrypoint

def parse_generated_project(content):
    content = content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\s*```$", "", content)
    try:
        project = json.loads(content)
    except json.JSONDecodeError as error:
        raise RuntimeError("The model returned invalid project JSON. Please try again.") from error
    if not isinstance(project, dict):
        raise RuntimeError("The model returned an invalid project format.")
    files = project.get("files")
    entrypoint = project.get("entrypoint", "index.html")
    return validate_project_files(files, entrypoint)

def connection_error_detail(error, api_key, model_url):
    reason = getattr(error, "reason", error)
    detail = str(reason).replace(api_key, "[redacted]").replace(model_url, "[configured endpoint]").strip()
    return detail[:300]

def generate_project(prompt, current_files=None, current_entrypoint="index.html", current_assets=None):
    env = load_env()
    api_key = os.environ.get("API_KEY") or env.get("API_KEY", "")
    model_url = os.environ.get("MODEL_URL") or env.get("MODEL_URL", "")
    model_name = os.environ.get("MODEL_NAME") or env.get("MODEL_NAME", "")
    if not model_url:
        raise ValueError("Add MODEL_URL to .env to connect your Azure OpenAI endpoint.")
    if not api_key:
        raise ValueError("Add API_KEY to .env to connect your Azure OpenAI endpoint.")
    if not model_name:
        raise ValueError("Add MODEL_NAME to .env to identify the Azure OpenAI deployment.")

    system_prompt = (
        "You are a senior web designer and frontend developer. Build a complete, "
        "multi-page static website. Respond with only valid JSON matching this shape: "
        '{"entrypoint":"index.html","files":{"index.html":"...","about.html":"...",'
        '"assets/styles.css":"...","assets/main.js":"..."}}. Include all file contents '
        "as strings; escape JSON correctly. Use semantic accessible markup, responsive "
        "layouts, polished typography, and real image URLs from images.unsplash.com "
        "when useful. Use relative links for internal pages and assets. Keep all files "
        "text-only and under 700 KB total. Do not use external JavaScript libraries. "
        "When revising an existing project, preserve its structure and all unrelated "
        "pages. If the user asks to add or change a specific page, update that page "
        "and any required shared assets, preserve links between pages, and return the "
        "complete files map."
    )
    user_prompt = prompt
    if current_files:
        user_prompt += "\n\nCurrent project entrypoint: " + current_entrypoint
        user_prompt += "\n\nCurrent project files (JSON):\n" + json.dumps(current_files, ensure_ascii=False)[:100_000]
    if current_assets:
        user_prompt += "\n\nExisting uploaded assets available to reference by relative path:\n"
        user_prompt += "\n".join("- " + path for path in current_assets)
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
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
        with urlopen(request, timeout=MODEL_REQUEST_TIMEOUT_SECONDS) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = ""
        try:
            error_data = json.loads(error.read().decode("utf-8"))
            api_error = error_data.get("error") if isinstance(error_data, dict) else None
            if isinstance(api_error, dict) and isinstance(api_error.get("message"), str):
                detail = api_error["message"].replace(api_key, "[redacted]").strip()[:500]
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        message = "The model endpoint returned HTTP " + str(error.code) + "."
        if detail:
            message += " " + detail
        raise RuntimeError(message) from None
    except URLError as error:
        detail = connection_error_detail(error, api_key, model_url)
        message = "Could not reach the model endpoint. Check MODEL_URL and network access."
        if detail:
            message += " Connection detail: " + detail
        raise RuntimeError(message) from None
    except RemoteDisconnected:
        raise RuntimeError(
            "The model endpoint closed the connection without an HTTP response. "
            "Check that MODEL_URL points to an OpenAI-compatible chat-completions endpoint."
        ) from None
    except (TimeoutError, OSError) as error:
        if isinstance(error, TimeoutError):
            raise RuntimeError(
                "Azure OpenAI did not return a complete response within "
                + str(MODEL_REQUEST_TIMEOUT_SECONDS)
                + " seconds. Try again with a smaller change request."
            ) from None
        detail = connection_error_detail(error, api_key, model_url)
        message = "The connection to the model endpoint failed. Check MODEL_URL and network access."
        if detail:
            message += " Connection detail: " + detail
        raise RuntimeError(message) from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError("The model endpoint returned an unreadable response.") from None
    return parse_generated_project(extract_model_text(response_data))
