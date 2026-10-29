"""Claude API calls: folder -> planilla, and planilla + answers -> updated planilla.

Two output modes, chosen automatically:

* ``esquema`` — structured output (``output_config.format`` with the JSON schema). The API
  guarantees the JSON shape, but it compiles the schema into a grammar and rejects large
  schemas with opaque 400 errors ("too many parameters with union types", "compiled grammar
  is too large", "schema is too complex").
* ``texto`` — the same schema goes into the system prompt as text and the model answers
  with plain JSON. Nothing can be rejected up front; the JSON is parsed, missing keys are
  filled with empty values and the result is normalised exactly as in the other mode.

The first call tries ``esquema`` and falls back to ``texto`` on any schema-related 400.
``INVIMAGIL_SALIDA=texto`` or ``INVIMAGIL_SALIDA=esquema`` forces one mode.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic

from .documentos import Doc, build_user_content
from .esquema import build_schema, completar_planilla, normalizar_planilla

MODEL = "claude-opus-5-5"
EFFORT = "high"
MAX_TOKENS = 64000
MODO_ENV = "INVIMAGIL_SALIDA"
MODOS = ("esquema", "texto")

RECURSOS = Path(__file__).resolve().parent.parent / "recursos"

_SCHEMA_ERROR_HINTS = ("grammar", "schema", "complex", "union", "strict", "output_config", "output_format", "json_schema")


class ExtraccionError(RuntimeError):
    def __init__(self, msg: str, respuesta: str | None = None):
        super().__init__(msg)
        self.respuesta = respuesta


def _system_blocks(con_esquema: bool) -> list[dict]:
    prompt = (RECURSOS / "prompt_fase_a.md").read_text(encoding="utf-8")
    catalog = (RECURSOS / "invimagil-catalogos.txt").read_text(encoding="utf-8")
    blocks = [
        {"type": "text", "text": prompt},
        {
            "type": "text",
            "text": "# Catálogo InvimÁgil (listas jerárquicas; formato `slug | NOMBRE`, la sangría indica el nivel)\n\n" + catalog,
            "cache_control": {"type": "ephemeral"},
        },
    ]
    if not con_esquema:
        # Same prefix as the structured mode, so the cached catalog is reused; the schema goes after the breakpoint.
        blocks.append(
            {
                "type": "text",
                "text": (
                    "# Formato de la respuesta\n\n"
                    "Responde ÚNICAMENTE con un objeto JSON válido: sin texto antes ni después, sin comentarios y sin "
                    "cercas de código (```). El objeto debe cumplir exactamente este JSON Schema: todas las propiedades "
                    "`required` presentes, ninguna propiedad adicional, los tipos tal como se indican (los campos sin dato "
                    "van como cadena vacía \"\"). Cuida que el JSON quede completo y bien cerrado.\n\n"
                    + json.dumps(build_schema(), ensure_ascii=False, separators=(",", ":"))
                ),
            }
        )
    return blocks


def _criterios_text() -> str:
    c = json.loads((RECURSOS / "criterios_spi.json").read_text(encoding="utf-8"))
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


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(timeout=1800.0, max_retries=2)


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


def _es_error_de_esquema(exc: anthropic.BadRequestError) -> bool:
    msg = str(exc).lower()
    return any(h in msg for h in _SCHEMA_ERROR_HINTS)


def _llamar(client: anthropic.Anthropic, user_content: list[dict], on_progress, con_esquema: bool) -> tuple[dict, dict]:
    schema = build_schema()
    output_config: dict = {"effort": EFFORT}
    if con_esquema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    with client.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=_system_blocks(con_esquema),
        messages=[{"role": "user", "content": user_content}],
        output_config=output_config,
    ) as stream:
        chars = 0
        for text in stream.text_stream:
            chars += len(text)
            if chars % 4000 < len(text):
                on_progress(f"  … recibiendo la planilla ({chars // 1000} k caracteres)")
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        raise ExtraccionError("El modelo declinó procesar la solicitud (stop_reason=refusal). Avise a Edmundo.")
    if message.stop_reason == "max_tokens":
        raise ExtraccionError("La respuesta superó el tamaño máximo; la planilla quedó incompleta. Avise a Edmundo.")
    text = "".join(b.text for b in message.content if b.type == "text")
    if con_esquema:
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ExtraccionError(f"La respuesta no es JSON válido: {exc}", text) from exc
    else:
        raw = extraer_json(text)
    data = normalizar_planilla(completar_planilla(raw, schema))
    u = message.usage
    usage = {
        "input_tokens": u.input_tokens,
        "output_tokens": u.output_tokens,
        "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
        "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0,
        "model": message.model,
        "modo": "esquema" if con_esquema else "texto",
    }
    return data, usage


def _run(client: anthropic.Anthropic, user_content: list[dict], on_progress) -> tuple[dict, dict]:
    modo = (os.environ.get(MODO_ENV) or "").strip().lower()
    if modo and modo not in MODOS:
        raise ExtraccionError(f"{MODO_ENV} debe ser uno de {MODOS}, no «{modo}».")
    if modo != "texto":
        try:
            return _llamar(client, user_content, on_progress, con_esquema=True)
        except anthropic.BadRequestError as exc:
            if modo == "esquema" or not _es_error_de_esquema(exc):
                raise
            on_progress("  La API rechazó el esquema de salida; se repite la solicitud en modo texto (mismo contenido).")
    return _llamar(client, user_content, on_progress, con_esquema=False)


def extraer(docs: list[Doc], folder_name: str, on_progress=lambda m: None) -> tuple[dict, dict]:
    intro = (
        f"Carpeta del producto: «{folder_name}». A continuación van los {len(docs)} archivos de la carpeta, "
        "cada uno precedido por una línea «=== Archivo n/N: nombre». Genera la planilla completa.\n\n" + _criterios_text()
    )
    content = build_user_content(docs, intro)
    on_progress("  Enviando los documentos al modelo…")
    return _run(_client(), content, on_progress)


def aplicar_decisiones(planilla: dict, respuestas: list[dict], on_progress=lambda m: None) -> tuple[dict, dict]:
    """respuestas: [{id, tema, hallazgo, propuesta, respuesta}]"""
    intro = (
        "Esta es la planilla vigente de un producto (JSON) y las respuestas de la analista a las decisiones pendientes. "
        "Devuelve la planilla COMPLETA con el mismo esquema, aplicando cada respuesta en los campos afectados: "
        "escribe el valor decidido (con su slug de catálogo si corresponde), deja `_decision` como \"\" en los campos resueltos, "
        "y quita de `decisiones` las que quedaron resueltas. Si una respuesta es ambigua o no responde la pregunta, "
        "conserva la decisión y anota en su `propuesta` qué falta. No cambies nada que la analista no haya pedido. "
        "Añade a `_meta.hallazgos` una línea «Decisiones aplicadas: D1, D3, …».\n\n"
        + _criterios_text()
        + "\n\n# Respuestas de la analista\n"
        + "\n".join(
            f"- {r['id']} ({r['tema']}): hallazgo: {r['hallazgo']}\n  propuesta: {r['propuesta']}\n  RESPUESTA: {r['respuesta']}"
            for r in respuestas
        )
        + "\n\n# Planilla vigente\n```json\n"
        + json.dumps(planilla, ensure_ascii=False, indent=1)
        + "\n```"
    )
    on_progress("  Aplicando las decisiones con el modelo…")
    return _run(_client(), [{"type": "text", "text": intro}], on_progress)


def verificar_clave(api_key: str) -> str | None:
    """Return None when the key works, otherwise a Spanish error message."""
    try:
        anthropic.Anthropic(api_key=api_key, timeout=30.0, max_retries=0).models.retrieve(MODEL)
        return None
    except anthropic.AuthenticationError:
        return "La clave no es válida (la API la rechazó)."
    except anthropic.PermissionDeniedError:
        return "La clave es válida pero no tiene permiso para usar el modelo."
    except anthropic.APIConnectionError:
        return "No hay conexión con la API. Revise Internet o el proxy de la empresa."
    except anthropic.APIStatusError as exc:
        return f"La API respondió con error {exc.status_code}."
