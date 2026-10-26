import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_REQUEST_BYTES = 1_500_000
MAX_PROJECT_FILES = 100
MAX_PROJECT_BYTES = 700_000
MODEL_REQUEST_TIMEOUT_SECONDS = 300
PROJECT_FILE_EXTENSIONS = {".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".svg", ".txt", ".md"}

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

def setting(name, env=None):
    env = env if env is not None else load_env()
    return os.environ.get(name) or env.get(name, "")
