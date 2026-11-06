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

import anthropic

from .documentos import Doc, build_user_content
from .esquema import build_schema, completar_planilla, normalizar_planilla
from .prompts import (  # noqa: F401 - ExtraccionError and extraer_json are re-exported for callers
    ExtraccionError,
    catalogo_texto,
    criterios_text,
    extraer_json,
    formato_texto,
    intro_aplicar,
    intro_extraer,
    prompt_base,
)

MODEL = "claude-opus-5-5"
EFFORT = "high"
MAX_TOKENS = 64000
MODO_ENV = "INVIMAGIL_SALIDA"
MODOS = ("esquema", "texto")

_SCHEMA_ERROR_HINTS = ("grammar", "schema", "complex", "union", "strict", "output_config", "output_format", "json_schema")


def _system_blocks(con_esquema: bool) -> list[dict]:
    blocks = [
        {"type": "text", "text": prompt_base()},
        {"type": "text", "text": catalogo_texto(), "cache_control": {"type": "ephemeral"}},
    ]
    if not con_esquema:
        # Same prefix as the structured mode, so the cached catalog is reused; the schema goes after the breakpoint.
        blocks.append({"type": "text", "text": formato_texto(build_schema())})
    return blocks


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(timeout=1800.0, max_retries=2)


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
    intro = intro_extraer(len(docs), folder_name)
    content = build_user_content(docs, intro)
    on_progress("  Enviando los documentos al modelo…")
    return _run(_client(), content, on_progress)


def aplicar_decisiones(planilla: dict, respuestas: list[dict], on_progress=lambda m: None) -> tuple[dict, dict]:
    """respuestas: [{id, tema, hallazgo, propuesta, respuesta}]"""
    intro = intro_aplicar(planilla, respuestas)
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
