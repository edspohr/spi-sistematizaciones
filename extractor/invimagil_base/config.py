"""Per-user configuration: where outputs go, where the API key lives."""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "InvimagilBase"
OUT_DIR_NAME = "_invimagil"
KEY_ENV = "ANTHROPIC_API_KEY"


def app_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    d = base / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _key_file() -> Path:
    return app_dir() / "clave.bin"


def save_api_key(key: str) -> None:
    data = key.strip().encode("utf-8")
    if sys.platform == "win32":
        from .windows import dpapi_protect

        data = dpapi_protect(data)
    f = _key_file()
    f.write_bytes(data)
    try:
        os.chmod(f, 0o600)
    except OSError:
        pass


def load_api_key() -> str | None:
    env = os.environ.get(KEY_ENV)
    if env:
        return env.strip()
    f = _key_file()
    if not f.exists():
        return None
    data = f.read_bytes()
    if sys.platform == "win32":
        from .windows import dpapi_unprotect

        try:
            data = dpapi_unprotect(data)
        except OSError:
            return None
    return data.decode("utf-8").strip() or None


def delete_api_key() -> None:
    f = _key_file()
    if f.exists():
        f.unlink()


def output_dir(folder: Path) -> Path:
    d = folder / OUT_DIR_NAME
    d.mkdir(exist_ok=True)
    return d
