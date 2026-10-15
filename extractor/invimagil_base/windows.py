"""Windows-only helpers: DPAPI, MessageBox, Explorer context menu. Safe no-ops elsewhere."""
from __future__ import annotations

import ctypes
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path

IS_WIN = sys.platform == "win32"
MENU_KEYS = {
    "InvimagilBase.Generar": ("Generar archivo base InvimÁgil", ""),
    "InvimagilBase.Aplicar": ("Aplicar decisiones InvimÁgil", "--aplicar"),
}


# --- DPAPI ----------------------------------------------------------------------------
class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> _DATA_BLOB:
    buf = ctypes.create_string_buffer(data, len(data))
    return _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _crypt(data: bytes, protect: bool) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    inp = _blob(data)
    out = _DATA_BLOB()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(inp), None, None, None, None, 0, ctypes.byref(out))
    if not ok:
        raise OSError("DPAPI falló")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def dpapi_protect(data: bytes) -> bytes:
    return _crypt(data, True)


def dpapi_unprotect(data: bytes) -> bytes:
    return _crypt(data, False)


# --- UI ----------------------------------------------------------------------------------
def message_box(title: str, text: str, error: bool = False) -> None:
    if IS_WIN:
        MB_ICONERROR, MB_ICONINFORMATION, MB_TOPMOST = 0x10, 0x40, 0x40000
        ctypes.windll.user32.MessageBoxW(None, text, title, (MB_ICONERROR if error else MB_ICONINFORMATION) | MB_TOPMOST)
    else:
        print(f"\n[{title}] {text}\n")


def open_path(path: Path) -> None:
    try:
        if IS_WIN:
            import os

            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except Exception:  # noqa: BLE001
        pass


def setup_console() -> None:
    if IS_WIN:
        try:
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
            ctypes.windll.kernel32.SetConsoleCP(65001)
            ctypes.windll.kernel32.SetConsoleTitleW("InvimÁgil Base")
        except Exception:  # noqa: BLE001
            pass
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass


# --- Context menu -----------------------------------------------------------------------------
def _command(python_exe: Path, script: Path, extra: str, arg_token: str) -> str:
    extra = f" {extra}" if extra else ""
    return f'"{python_exe}" "{script}"{extra} "{arg_token}"'


def install_context_menu(python_exe: Path, script: Path, icon: Path | None = None) -> list[str]:
    """Per-user keys (HKCU) -> no admin rights needed. Returns the registry paths written."""
    if not IS_WIN:
        return []
    import winreg

    written = []
    for key_name, (label, extra) in MENU_KEYS.items():
        for base, token in (("Directory\\shell", "%1"), ("Directory\\Background\\shell", "%V")):
            path = f"Software\\Classes\\{base}\\{key_name}"
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, path) as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, label)
                winreg.SetValueEx(k, "MUIVerb", 0, winreg.REG_SZ, label)
                if icon and icon.exists():
                    winreg.SetValueEx(k, "Icon", 0, winreg.REG_SZ, str(icon))
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, path + "\\command") as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, _command(python_exe, script, extra, token))
            written.append(path)
    return written


def uninstall_context_menu() -> None:
    if not IS_WIN:
        return
    import winreg

    for key_name in MENU_KEYS:
        for base in ("Directory\\shell", "Directory\\Background\\shell"):
            path = f"Software\\Classes\\{base}\\{key_name}"
            for sub in (path + "\\command", path):
                try:
                    winreg.DeleteKey(winreg.HKEY_CURRENT_USER, sub)
                except OSError:
                    pass
