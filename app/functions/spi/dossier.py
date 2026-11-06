"""Turn the files of a trámite in Cloud Storage into Gemini parts.

* PDFs and images go by reference (``gs://`` URI): Gemini reads scans natively and the
  request stays small, so nothing is rasterised.
* DOCX / XLSX / TXT / CSV / MD are converted to text, reusing the extractor's readers.
* Anything else is listed by name only.

Against the Storage emulator Vertex cannot read the bucket, so bytes are sent inline.
"""
from __future__ import annotations

import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from google.genai import types
from invimagil_base.documentos import IGNORED_DIR_PREFIXES, IGNORED_DIRS, IGNORED_FILES, IGNORED_PREFIXES, _docx_text, _xlsx_text

MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
TEXT_EXT = {".txt", ".md", ".csv"}


@dataclass
class Archivo:
    rel: str           # path inside the product folder, e.g. "Etiquetas/arte.pdf"
    blob_name: str     # full object name in the bucket
    size_mb: float
    kind: str = "other"
    note: str = ""


def ignorar(rel: str) -> bool:
    """Same filters as the Windows extractor (documentos.list_files)."""
    parts = PurePosixPath(rel).parts
    for d in parts[:-1]:
        low = d.strip().lower()
        if d in IGNORED_DIRS or d.startswith(".") or low.startswith(IGNORED_DIR_PREFIXES):
            return True
    f = parts[-1]
    return f in IGNORED_FILES or f.startswith("~$") or f.startswith(".") or f.startswith(IGNORED_PREFIXES)


def _emulador() -> bool:
    return bool(os.environ.get("FIREBASE_STORAGE_EMULATOR_HOST") or os.environ.get("FUNCTIONS_EMULATOR"))


def construir_partes(bucket, prefix: str, intro: Callable[[int], str], on_progress=lambda m: None) -> tuple[list[types.Part], list[Archivo]]:
    blobs = sorted((b for b in bucket.list_blobs(prefix=prefix) if not b.name.endswith("/")), key=lambda b: b.name)
    archivos = []
    for b in blobs:
        rel = b.name[len(prefix):]
        if not ignorar(rel):
            archivos.append(Archivo(rel=rel, blob_name=b.name, size_mb=round((b.size or 0) / 1e6, 2)))
    parts: list[types.Part] = [types.Part.from_text(text=intro(len(archivos)))]
    inline = _emulador()
    with tempfile.TemporaryDirectory() as tmp:
        for i, a in enumerate(archivos, 1):
            ext = Path(a.rel).suffix.lower()
            header = f"\n=== Archivo {i}/{len(archivos)}: «{a.rel}» · {a.size_mb} MB"
            try:
                if ext in MIME:
                    a.kind = "pdf" if ext == ".pdf" else "image"
                    parts.append(types.Part.from_text(text=header))
                    if inline:
                        parts.append(types.Part.from_bytes(data=bucket.blob(a.blob_name).download_as_bytes(), mime_type=MIME[ext]))
                    else:
                        parts.append(types.Part.from_uri(file_uri=f"gs://{bucket.name}/{a.blob_name}", mime_type=MIME[ext]))
                elif ext in {".docx", ".xlsx", ".xlsm"} | TEXT_EXT:
                    local = Path(tmp) / f"f{i}{ext}"
                    bucket.blob(a.blob_name).download_to_filename(str(local))
                    if ext == ".docx":
                        a.kind, body = "docx", _docx_text(local)
                    elif ext in {".xlsx", ".xlsm"}:
                        a.kind, body = "xlsx", _xlsx_text(local)
                    else:
                        a.kind, body = "text", local.read_text(encoding="utf-8", errors="replace")
                    parts.append(types.Part.from_text(text=f"{header}\nContenido de «{a.rel}»:\n{body}"))
                else:
                    a.note = "formato no leído; solo se registra el nombre"
                    parts.append(types.Part.from_text(text=f"{header} · {a.note}"))
            except Exception as exc:  # noqa: BLE001 - report, never abort the whole folder
                a.kind, a.note = "other", f"no se pudo leer: {exc}"
                parts.append(types.Part.from_text(text=f"{header} · {a.note}"))
            on_progress(f"{a.rel} ({a.size_mb} MB, {a.kind})")
    return parts, archivos


def inventario(archivos: list[Archivo]) -> str:
    lines = ["| Archivo | MB | Cómo se leyó |", "|---|---:|---|"]
    for a in archivos:
        lines.append(f"| {a.rel} | {a.size_mb} | {a.kind}{' · ' + a.note if a.note else ''} |")
    return "\n".join(lines)
