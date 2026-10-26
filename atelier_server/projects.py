import json
import os
import re
import subprocess
import threading

from .config import ROOT

TEMPLATE_ROOT = ROOT / "templates" / "react"
COMPILER_SLOTS = threading.BoundedSemaphore(2)
CORE_FILES = (
    "index.html", "package.json", "tsconfig.json", "vite.config.ts",
    "tailwind.config.ts", "postcss.config.js", "components.json", "src/main.tsx",
    "src/app/App.tsx", "src/app/router.tsx", "src/app/providers.tsx",
    "src/pages/Index.tsx", "src/pages/NotFound.tsx", "src/styles/globals.css",
    "src/styles/theme.json",
)


def template_files():
    return {
        path.relative_to(TEMPLATE_ROOT).as_posix(): path.read_text(encoding="utf-8")
        for path in sorted(TEMPLATE_ROOT.rglob("*"))
        if path.is_file()
        and not {"node_modules", "dist", ".git"}.intersection(path.relative_to(TEMPLATE_ROOT).parts)
        and path.name != "package-lock.json"
        and (not path.name.startswith(".env") or path.name == ".env.example")
    }


def is_react_project(files):
    return isinstance(files, dict) and "src/main.tsx" in files and "package.json" in files


def validate_react_project(files, entrypoint):
    missing = [name for name in CORE_FILES if not files.get(name)]
    if missing or entrypoint != "index.html":
        raise RuntimeError("React project architecture is incomplete: " + ", ".join(missing or ["index.html entrypoint"]))
    for directory in ("src/components/ui/", "src/components/layout/", "src/components/sections/"):
        if not any(name.startswith(directory) and name.endswith(".tsx") for name in files):
            raise RuntimeError("React project is missing components in " + directory)
    try:
        manifest = json.loads(files["package.json"])
        config = json.loads(files["tsconfig.json"])
        json.loads(files["src/styles/theme.json"])
        json.loads(files["components.json"])
    except (ValueError, TypeError) as error:
        raise RuntimeError("Project configuration must be valid JSON.") from error
    if not isinstance(manifest, dict) or not isinstance(config, dict):
        raise RuntimeError("Project configuration must be JSON objects.")
    options = config.get("compilerOptions", {})
    if not isinstance(options, dict) or not isinstance(options.get("paths", {}), dict):
        raise RuntimeError("TypeScript compilerOptions and paths must be objects.")
    if options.get("strict") is not True or options.get("paths", {}).get("@/*") != ["src/*"]:
        raise RuntimeError("Generated projects must enable strict TypeScript and the @/ alias.")
    for key in ("dependencies", "devDependencies", "scripts"):
        value = manifest.get(key, {})
        if not isinstance(value, dict) or any(not isinstance(item, str) for item in value.values()):
            raise RuntimeError("package.json " + key + " must contain string values.")
    dependencies = {**manifest.get("dependencies", {}), **manifest.get("devDependencies", {})}
    for name in ("react", "react-dom", "react-router-dom", "typescript", "vite", "tailwindcss"):
        if name not in dependencies:
            raise RuntimeError("Generated project is missing dependency " + name)
    if not all(manifest.get("scripts", {}).get(name) for name in ("dev", "build", "typecheck")):
        raise RuntimeError("Generated projects must include dev, build and typecheck scripts.")
    if not re.search(r"""new\s+URL\(\s*['"]\./src/?['"]\s*,\s*import\.meta\.url\s*\)""", files["vite.config.ts"]):
        raise RuntimeError("Keep the Vite @ alias pointed at new URL('./src', import.meta.url).")
    if not re.search(r"""src\s*=\s*['"]/?src/main\.tsx['"]""", files["index.html"]):
        raise RuntimeError("index.html must load /src/main.tsx.")


def validate_migrated_routes(original, files):
    router = files["src/app/router.tsx"]
    for name in original:
        if not name.endswith(".html"):
            continue
        pattern = r"""(?:\bpath\s*:|\bpath\s*=)\s*['"]/?""" + re.escape(name) + r"""['"]"""
        if not re.search(pattern, router):
            raise RuntimeError("Migration must preserve the existing URL /" + name + " as an explicit route in src/app/router.tsx.")


def compile_project(files, check_types=False):
    if not COMPILER_SLOTS.acquire(timeout=5):
        raise RuntimeError("The local compiler is busy. Try again shortly.")
    try:
        # Only trusted compiler code runs. No generated scripts/configs or environment files are executed.
        environment = {name: os.environ[name] for name in ("PATH", "SYSTEMROOT") if name in os.environ}
        process = subprocess.run(
            ["node", str(ROOT / "scripts" / "compile-project.mjs")],
            input=json.dumps({"files": files, "checkTypes": check_types}),
            capture_output=True, text=True, cwd=ROOT, env=environment, timeout=45,
        )
        try:
            result = json.loads(process.stdout)
        except ValueError:
            raise RuntimeError("Local compiler unavailable. Run npm install and verify Node.js is installed.") from None
        if process.returncode or result.get("error"):
            raise RuntimeError("Project compilation failed:\n" + result.get("error", "Unknown compiler error."))
        return result["html"]
    except FileNotFoundError:
        raise RuntimeError("Node.js is required to compile React projects.") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError("Project compilation timed out.") from None
    finally:
        COMPILER_SLOTS.release()
