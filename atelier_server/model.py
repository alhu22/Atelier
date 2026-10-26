import json
import logging
import re
from http.client import RemoteDisconnected
from pathlib import Path
from posixpath import normpath
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from .config import (
    MAX_PROJECT_BYTES,
    MAX_PROJECT_FILES,
    MODEL_REQUEST_TIMEOUT_SECONDS,
    PROJECT_FILE_EXTENSIONS,
    load_env,
    setting,
)
from .projects import compile_project, is_react_project, template_files, validate_migrated_routes, validate_react_project

def model_endpoint(model_url, deployment=None, api_version=None):
    parsed = urlsplit(model_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("MODEL_URL must be a complete HTTP(S) URL.")
    path = parsed.path.rstrip("/")
    azure = (parsed.hostname or "").endswith((".openai.azure.com", ".services.ai.azure.com", ".models.ai.azure.com"))
    query = parse_qs(parsed.query)
    version = query.get("api-version", [api_version])[0]
    if "/openai/deployments/" in path:
        configured_deployment = unquote(path.split("/openai/deployments/", 1)[1].split("/")[0])
        if deployment and configured_deployment != deployment:
            raise ValueError("MODEL_NAME must match the deployment in MODEL_URL: " + configured_deployment + ".")
        if not version:
            raise ValueError("The deployment-style MODEL_URL requires api-version or AZURE_OPENAI_API_VERSION. Alternatively use /openai/v1.")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:-preview)?", version):
            raise ValueError("Azure api-version must be a date such as 2024-10-21, optionally ending in -preview.")
        query["api-version"] = [version]
        endpoint_path = path if path.endswith("/chat/completions") else path + "/chat/completions"
        return urlunsplit((parsed.scheme, parsed.netloc, endpoint_path, urlencode(query, doseq=True), ""))
    if azure and path in ("", "/openai"):
        if version:
            if not deployment:
                raise ValueError("MODEL_NAME is required to build an Azure deployment URL.")
            return model_endpoint(
                urlunsplit((parsed.scheme, parsed.netloc, "/openai/deployments/" + quote(deployment, safe=""), parsed.query, "")),
                deployment, version,
            )
        path = "/openai/v1"
    if path.endswith("/chat/completions"):
        endpoint_path = path
    elif path.endswith("/v1/models"):
        endpoint_path = path[: -len("/models")] + "/chat/completions"
    elif path.endswith("/v1"):
        endpoint_path = path + "/chat/completions"
    else:
        endpoint_path = path + "/v1/chat/completions"
    return urlunsplit((parsed.scheme, parsed.netloc, endpoint_path, parsed.query, ""))

def model_settings():
    env = load_env()
    values = {key: setting(key, env).strip() for key in ("API_KEY", "MODEL_URL", "MODEL_NAME")}
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise ValueError("Missing Azure OpenAI configuration: " + ", ".join(missing) + ". Set these server-side in .env.")
    values["endpoint"] = model_endpoint(values["MODEL_URL"], values["MODEL_NAME"], setting("AZURE_OPENAI_API_VERSION", env) or setting("API_VERSION", env))
    return values


def model_error(status, body, api_key, model_url, deployment=""):
    safe_body = body.replace(api_key, "[redacted]") if api_key else body
    if model_url:
        safe_body = safe_body.replace(model_url, "[configured endpoint]")
    logging.getLogger(__name__).error("Azure OpenAI HTTP %s response: %s", status, safe_body)
    try:
        parsed = json.loads(safe_body)
        if isinstance(parsed, dict) and isinstance(parsed.get("response"), dict):
            parsed = parsed["response"]
        detail = parsed.get("error", parsed)
        detail = str(detail.get("message") or safe_body) if isinstance(detail, dict) else str(detail)
    except (ValueError, AttributeError):
        detail = safe_body
    message = f"Azure OpenAI returned HTTP {status}: {detail.strip() or 'Empty error response.'}"
    if status == 404:
        message += f" Check MODEL_URL, the MODEL_NAME deployment '{deployment}', and api-version for deployment-style URLs."
    return RuntimeError(message)

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
            or (suffix not in PROJECT_FILE_EXTENSIONS and file_path not in {".gitignore", ".env.example"})
            or any(segment in {"node_modules", "dist", ".git"} for segment in path.split("/"))
            or (Path(path).name.startswith(".env") and file_path != ".env.example")
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

REACT_CONVENTION = (
    "Build the user's actual website source, NOT the Atelier builder. Return only valid JSON "
    'with shape {"entrypoint":"index.html","files":{"path":"complete file contents"}}. '
    "Use React, strict TypeScript, Vite, Tailwind 3 and React Router 7. Follow the supplied "
    "project architecture: src/app/App.tsx only composes the router; router.tsx owns routes; "
    "providers.tsx owns providers; src/pages/ composes typed, accessible reusable components; "
    "src/components/ui/ contains composable shadcn-inspired primitives, layout/ shared layout, "
    "sections/ visual sections. Put reusable state in src/hooks/, business/data-access code in "
    "src/services/, provider clients in src/integrations/, domain types in src/types/, helpers "
    "in src/utils/. Only create folders/files that are actually used. Do not create placeholder "
    "Dashboard/Auth pages or mock integrations. Preserve all existing routes, content, behavior, "
    "responsive design, dark mode, API contracts and authentication. Never put the whole app "
    "in App.tsx or embed the original app as raw HTML/an iframe. Use @/ imports consistently "
    "with tsconfig and Vite. Keep tsconfig strict true and avoid any. Maintain package.json "
    "dev/typecheck/build scripts, index.html loading /src/main.tsx, components.json, and all "
    "existing build configuration. Use CSS variables in src/styles/globals.css and put "
    "serializable Tailwind theme extensions in src/styles/theme.json, imported by tailwind.config.ts. "
    "Do not add executable Tailwind plugins or CSS @config directives. Available runtime packages "
    "are react, react-dom, react-router-dom and firebase (only if already needed). Use native "
    "accessible primitives instead of adding dependencies. Do not introduce services. Never "
    "include secrets, real .env files, node_modules or dist. Public browser configuration only "
    "goes in a placeholder .env.example when needed; server secrets stay server-side. Use "
    "public/assets/ or src/assets/ for text SVG assets and preserve existing external image URLs. "
    "Keep the complete source under 700 KB and 100 files. Return the COMPLETE files map, not "
    "patches or a single HTML file. On follow-up edits preserve unrelated files and architecture."
)


def generate_project(prompt, current_files=None, current_entrypoint="index.html", current_assets=None, migrate=False):
    settings = model_settings()
    api_key, model_url, model_name = settings["API_KEY"], settings["endpoint"], settings["MODEL_NAME"]

    legacy_prompt = (
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
    react_output = migrate or not current_files or is_react_project(current_files)
    system_prompt = REACT_CONVENTION if react_output else legacy_prompt
    if migrate:
        if not current_files:
            raise ValueError("An existing project is required for migration.")
        system_prompt += (
            " Migrate the supplied existing static website into this architecture without "
            "redesigning it. Preserve every HTML URL (including index.html and nested .html paths) "
            "as an explicit full path in src/app/router.tsx, "
            "all anchors, scripts' interactions and assets. The original remains saved as a "
            "separate project, so return a self-contained migrated source tree, not a wrapper. "
            "Use the architecture of the reference below, NOT its restaurant content:\n"
            + json.dumps(template_files(), ensure_ascii=False)
        )
    user_prompt = prompt
    source_files = current_files or template_files()
    if source_files:
        user_prompt += "\n\nCurrent project entrypoint: " + current_entrypoint
        user_prompt += "\n\nCurrent project files (JSON):\n" + json.dumps(source_files, ensure_ascii=False)
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
    for attempt in range(2):
        content = request_model(payload, api_key, model_url)
        try:
            files, entrypoint = parse_generated_project(content)
            if react_output:
                validate_react_project(files, entrypoint)
                if migrate:
                    validate_migrated_routes(current_files, files)
                compile_project(files, check_types=True)
            return files, entrypoint
        except RuntimeError as error:
            if attempt:
                raise
            payload["messages"].extend([
                {"role": "assistant", "content": content},
                {"role": "user", "content": "Repair these validation errors without dropping content or features. Return the complete corrected project JSON:\n" + str(error)},
            ])


def request_model(payload, api_key, model_url):
    request = Request(
        model_endpoint(model_url, payload.get("model"), setting("AZURE_OPENAI_API_VERSION") or setting("API_VERSION")),
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
        raise model_error(error.code, error.read().decode("utf-8", errors="replace"), api_key, model_url, payload.get("model", "")) from None
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
    return extract_model_text(response_data)
