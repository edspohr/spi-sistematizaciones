"""One PDF per InvimÁgil upload slot: which dossier files go to which slot (from the planilla),
merged into a single PDF and compressed under the platform's 10 MB limit.

Pure functions over bytes, so they run the same in the Cloud Function and in a local test.
"""
from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass, field

from pypdf import PdfReader, PdfWriter

LIMITE_MB = 10.0
IMAGENES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".gif"}


@dataclass
class Casilla:
    clave: str
    titulo: str
    archivos: list[str]
    avisos: list[str] = field(default_factory=list)


def _lista(v) -> list[str]:
    return [x for x in (v or []) if isinstance(x, str) and x.strip()]


def casillas(planilla: dict, documento_oficial: str | None = None) -> list[Casilla]:
    """Upload slots and the dossier files that go in each, in screen order."""
    md = planilla.get("mandatoryDocuments") or {}
    label = md.get("label") or {}
    fosforo = md.get("phosphorusContent") or {}
    lotes = [f for x in (md.get("lotsCoding") or []) for f in _lista((x or {}).get("files"))]
    out = []
    if documento_oficial:
        out.append(Casilla("sistematizacion", "Último documento oficial de la NSO", [documento_oficial]))
    for clave, titulo, archivos in [
        ("animalTestingDeclaration", "Declaración de no experimentación en animales", _lista(md.get("animalTestingDeclaration"))),
        ("cosmeticBenefitsSupport", "Soporte de beneficios cosméticos", _lista(md.get("cosmeticBenefitsSupport"))),
        ("label", "Etiqueta y sticker", _lista(label.get("artworkFiles"))),
        ("lotsCoding", "Codificación de lotes", lotes),
        ("phosphorusAnalytical", "Contenido de fósforo - certificado analítico", _lista(fosforo.get("analyticalCertificate"))),
        ("phosphorusConformity", "Contenido de fósforo - declaración de conformidad", _lista(fosforo.get("conformityDeclaration"))),
    ]:
        if archivos:
            out.append(Casilla(clave, titulo, list(dict.fromkeys(archivos))))
    for i, d in enumerate(planilla.get("additionalDocuments") or [], 1):
        if (d or {}).get("archivo"):
            out.append(Casilla(f"adicional-{i}", (d.get("descripcion") or d["archivo"]).strip()[:120], [d["archivo"]]))
    return out


def _clave_nombre(s: str) -> str:
    s = unicodedata.normalize("NFC", s).strip().lower()
    return re.sub(r"\s+", " ", s)


def resolver(nombre: str, disponibles: list[str]) -> str | None:
    """Match a file name written by the extractor against the dossier paths (exact path, then
    base name, accent- and case-insensitive)."""
    k = _clave_nombre(nombre)
    por_ruta = {_clave_nombre(r): r for r in disponibles}
    if k in por_ruta:
        return por_ruta[k]
    base = {}
    for r in disponibles:
        base.setdefault(_clave_nombre(r.rsplit("/", 1)[-1]), []).append(r)
    hits = base.get(_clave_nombre(k.rsplit("/", 1)[-1]), [])
    return hits[0] if len(hits) == 1 else None


def nombre_archivo(c: Casilla) -> str:
    t = unicodedata.normalize("NFKD", c.titulo).encode("ascii", "ignore").decode()
    t = re.sub(r"[^A-Za-z0-9 ._-]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:80] + ".pdf"


def _imagen_a_pdf(data: bytes) -> bytes:
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "PDF", resolution=150.0)
    return buf.getvalue()


def _mb(b: bytes) -> float:
    return len(b) / 1e6


def _escribir(writer: PdfWriter) -> bytes:
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _rasterizar(data: bytes, dpi: int, calidad: int) -> bytes:
    """Render every page (pdfium, so spot colours and overprint look as on screen) to JPEG and
    rebuild the PDF at the same page size. Only used when the lossless merge is over the limit."""
    import pypdfium2 as pdfium
    from PIL import Image

    doc = pdfium.PdfDocument(data)
    imagenes = []
    try:
        for page in doc:
            w_pt, h_pt = page.get_size()
            escala = dpi / 72
            # cap very large artwork pages (labels can be 1 m wide) at ~6000 px on the long side
            escala = min(escala, 6000 / max(w_pt, h_pt))
            pil = page.render(scale=escala).to_pil().convert("RGB")
            imagenes.append((pil, escala))
    finally:
        doc.close()
    buf = io.BytesIO()
    primera, escala0 = imagenes[0]
    primera.save(buf, "PDF", save_all=True, append_images=[i for i, _ in imagenes[1:]], quality=calidad, resolution=72 * escala0)
    return buf.getvalue()


def unir(partes: list[tuple[str, bytes]], limite_mb: float = LIMITE_MB) -> tuple[bytes, list[str], int]:
    """Merge (name, bytes) into one PDF. Returns (pdf, avisos, páginas)."""
    avisos: list[str] = []
    writer = PdfWriter()
    for nombre, data in partes:
        ext = "." + nombre.rsplit(".", 1)[-1].lower() if "." in nombre else ""
        try:
            if ext == ".pdf":
                writer.append(PdfReader(io.BytesIO(data)))
            elif ext in IMAGENES:
                writer.append(PdfReader(io.BytesIO(_imagen_a_pdf(data))))
            else:
                avisos.append(f"«{nombre}» no es PDF ni imagen: conviértalo a PDF y cárguelo a mano.")
        except Exception as exc:  # noqa: BLE001
            avisos.append(f"«{nombre}» no se pudo leer como PDF: {exc}")
    if not writer.pages:
        return b"", avisos, 0
    for page in writer.pages:
        try:
            page.compress_content_streams()
        except Exception:  # noqa: BLE001
            pass
    writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
    pdf = _escribir(writer)
    paginas = len(writer.pages)
    if _mb(pdf) > limite_mb:
        original, sin_perdida = _mb(pdf), pdf
        for dpi, calidad in ((200, 85), (150, 80), (120, 72), (96, 65), (72, 55)):
            pdf = _rasterizar(sin_perdida, dpi, calidad)
            if _mb(pdf) <= limite_mb:
                avisos.append(f"Pesaba {original:.1f} MB: se convirtió a imagen a {dpi} ppp ({_mb(pdf):.1f} MB). El texto ya no se puede seleccionar; revise que se lea bien.")
                break
        else:
            avisos.append(f"Sigue pesando {_mb(pdf):.1f} MB tras comprimir: la plataforma acepta hasta {limite_mb:.0f} MB. Divida el archivo a mano.")
    return pdf, avisos, paginas
