"""Prompt texts and JSON parsing shared by every model backend (Anthropic CLI, Gemini cloud).

No SDK imports here: this module is copied into the Firebase functions as-is.
"""
from __future__ import annotations

import json
from pathlib import Path

RECURSOS = Path(__file__).resolve().parent.parent / "recursos"


class ExtraccionError(RuntimeError):
    def __init__(self, msg: str, respuesta: str | None = None):
        super().__init__(msg)
        self.respuesta = respuesta


def prompt_base() -> str:
    return (RECURSOS / "prompt_fase_a.md").read_text(encoding="utf-8")


def catalogo_texto() -> str:
    catalog = (RECURSOS / "invimagil-catalogos.txt").read_text(encoding="utf-8")
    return "# Catálogo InvimÁgil (listas jerárquicas; formato `slug | NOMBRE`, la sangría indica el nivel)\n\n" + catalog


def formato_texto(schema: dict) -> str:
    """Instructions for text mode: the schema travels in the prompt instead of as an output constraint."""
    return (
        "# Formato de la respuesta\n\n"
        "Responde ÚNICAMENTE con un objeto JSON válido: sin texto antes ni después, sin comentarios y sin "
        "cercas de código (```). El objeto debe cumplir exactamente este JSON Schema: todas las propiedades "
        "`required` presentes, ninguna propiedad adicional, los tipos tal como se indican (los campos sin dato "
        "van como cadena vacía \"\"). Cuida que el JSON quede completo y bien cerrado.\n\n"
        + json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
    )


def criterios_spi() -> dict:
    return json.loads((RECURSOS / "criterios_spi.json").read_text(encoding="utf-8"))


def criterios_publicos(c: dict | None = None) -> dict:
    """SPI criteria copied into planilla._meta so the browser add-on can apply them (e.g. reference list order)."""
    c = c if c is not None else criterios_spi()
    return {k: v for k, v in c.items() if not k.startswith("_") and k != "notas"}


def criterios_text(c: dict | None = None) -> str:
    c = c if c is not None else criterios_spi()
    lines = [
        "# Criterios fijos de SPI para este producto",
        f"- Titular de la NSO: {c.get('titular_nso') or 'pendiente (decisión)'}",
        f"- Representante legal / apoderado: {c.get('representante_legal') or 'pendiente (decisión)'}",
        f"- Responsable técnico: {c.get('responsable_tecnico') or 'no definido: dejar como decisión'}",
        f"- Unidad de composición: {c['unidad_composicion']['slug']} | {c['unidad_composicion']['name']}",
        "- Listado de referencia, en orden de preferencia: "
        + " > ".join(f"{r['slug']} | {r['name']}" for r in c["listados_referencia_prioridad"])
        + ". En la planilla se escribe el primero; el add-on elegirá en pantalla el primero que la plataforma ofrezca para ese INCI.",
        f"- Tipo de fabricante por defecto: {c.get('fabricante_tipo_por_defecto', 'tercero')}",
        f"- Tamaño máximo por adjunto: {c.get('tamano_maximo_adjunto_mb', 10)} MB",
    ]
    for n in c.get("notas", []):
        lines.append(f"- {n}")
    return "\n".join(lines)


def intro_extraer(n_docs: int, folder_name: str, criterios: dict | None = None) -> str:
    return (
        f"Carpeta del producto: «{folder_name}». A continuación van los {n_docs} archivos de la carpeta, "
        "cada uno precedido por una línea «=== Archivo n/N: nombre». Genera la planilla completa.\n\n" + criterios_text(criterios)
    )


def intro_aplicar(planilla: dict, respuestas: list[dict], criterios: dict | None = None) -> str:
    """respuestas: [{id, tema, hallazgo, propuesta, respuesta}]"""
    return (
        "Esta es la planilla vigente de un producto (JSON) y las respuestas de la analista a las decisiones pendientes. "
        "Devuelve la planilla COMPLETA con el mismo esquema, aplicando cada respuesta en los campos afectados: "
        "escribe el valor decidido (con su slug de catálogo si corresponde), deja `_decision` como \"\" en los campos resueltos, "
        "y quita de `decisiones` las que quedaron resueltas. Si una respuesta es ambigua o no responde la pregunta, "
        "conserva la decisión y anota en su `propuesta` qué falta. No cambies nada que la analista no haya pedido. "
        "Añade a `_meta.hallazgos` una línea «Decisiones aplicadas: D1, D3, …».\n\n"
        + criterios_text(criterios)
        + "\n\n# Respuestas de la analista\n"
        + "\n".join(
            f"- {r['id']} ({r['tema']}): hallazgo: {r['hallazgo']}\n  propuesta: {r['propuesta']}\n  RESPUESTA: {r['respuesta']}"
            for r in respuestas
        )
        + "\n\n# Planilla vigente\n```json\n"
        + json.dumps(planilla, ensure_ascii=False, indent=1)
        + "\n```"
    )


def extraer_json(text: str) -> dict:
    """Parse the model's text answer: tolerate code fences and stray prose around the object."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    try:
        obj = json.loads(t)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    start = t.find("{")
    if start < 0:
        raise ExtraccionError("La respuesta del modelo no contiene un objeto JSON.", text)
    try:
        obj, _ = json.JSONDecoder().raw_decode(t[start:])
    except json.JSONDecodeError as exc:
        raise ExtraccionError(f"La respuesta del modelo no es JSON válido ({exc}). Se guardó en ultima-respuesta.txt.", text) from exc
    if not isinstance(obj, dict):
        raise ExtraccionError("La respuesta del modelo no es un objeto JSON.", text)
    return obj
