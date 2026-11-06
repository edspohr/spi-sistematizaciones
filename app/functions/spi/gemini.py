"""Gemini on Vertex AI: dossier parts -> planilla, and planilla + answers -> updated planilla.

Same contract as extractor/invimagil_base/extraccion.py (the Anthropic CLI backend):
the prompt, catalog and schema come from the shared core, and the answer goes through
completar_planilla + normalizar_planilla. Two output modes:

* ``esquema``: ``response_json_schema`` constrains the output.
* ``texto``: the schema goes in the system instruction and the JSON is parsed by hand.

The first call tries ``esquema`` and falls back to ``texto`` when Vertex rejects the
schema with a 400. ``INVIMAGIL_SALIDA=texto|esquema`` forces one mode.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

from google import genai
from google.genai import errors, types
from invimagil_base.esquema import build_schema, completar_planilla, normalizar_planilla
from invimagil_base.prompts import ExtraccionError, catalogo_texto, extraer_json, formato_texto, prompt_base

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.1-pro-preview")
LOCATION = os.environ.get("GEMINI_LOCATION", "global")
MAX_OUTPUT_TOKENS = int(os.environ.get("GEMINI_MAX_OUTPUT_TOKENS", "65535"))
MODO_ENV = "INVIMAGIL_SALIDA"
MODOS = ("esquema", "texto")
TIMEOUT_MS = 1_700_000  # just under the 30 min function timeout


@dataclass
class Resultado:
    planilla: dict
    uso: dict


def _project() -> str:
    p = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT")
    if not p:
        raise ExtraccionError("No se conoce el proyecto de Google Cloud (GOOGLE_CLOUD_PROJECT).")
    return p


def _client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=_project(),
        location=LOCATION,
        http_options=types.HttpOptions(timeout=TIMEOUT_MS),
    )


def _system(con_esquema: bool) -> list[str]:
    parts = [prompt_base(), catalogo_texto()]
    if not con_esquema:
        parts.append(formato_texto(build_schema()))
    return parts


def _es_error_de_esquema(exc: errors.ClientError) -> bool:
    msg = str(exc).lower()
    return getattr(exc, "code", None) == 400 and any(h in msg for h in ("schema", "json", "response_json_schema", "too complex", "nesting", "properties"))


def _llamar(client: genai.Client, parts: list[types.Part], con_esquema: bool) -> Resultado:
    schema = build_schema()
    config = types.GenerateContentConfig(
        system_instruction=_system(con_esquema),
        response_mime_type="application/json",
        max_output_tokens=MAX_OUTPUT_TOKENS,
        temperature=0.2,
    )
    if con_esquema:
        config.response_json_schema = schema
    resp = client.models.generate_content(
        model=MODEL,
        contents=[types.Content(role="user", parts=parts)],
        config=config,
    )
    cand = (resp.candidates or [None])[0]
    reason = str(getattr(cand, "finish_reason", "") or "")
    if cand is None or "SAFETY" in reason or "PROHIBITED" in reason or "BLOCKLIST" in reason:
        raise ExtraccionError(f"Gemini no devolvió respuesta (motivo: {reason or 'bloqueada'}).")
    if "MAX_TOKENS" in reason:
        raise ExtraccionError("La respuesta superó el tamaño máximo; la planilla quedó incompleta.", resp.text)
    text = resp.text or ""
    if con_esquema:
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ExtraccionError(f"La respuesta no es JSON válido: {exc}", text) from exc
    else:
        raw = extraer_json(text)
    data = normalizar_planilla(completar_planilla(raw, schema))
    u = resp.usage_metadata
    uso = {
        "input_tokens": getattr(u, "prompt_token_count", 0) or 0,
        "output_tokens": getattr(u, "candidates_token_count", 0) or 0,
        "thinking_tokens": getattr(u, "thoughts_token_count", 0) or 0,
        "cache_read": getattr(u, "cached_content_token_count", 0) or 0,
        "model": getattr(resp, "model_version", None) or MODEL,
        "modo": "esquema" if con_esquema else "texto",
    }
    return Resultado(data, uso)


def generar(parts: list[types.Part], on_progress=lambda m: None) -> Resultado:
    modo = (os.environ.get(MODO_ENV) or "").strip().lower()
    if modo and modo not in MODOS:
        raise ExtraccionError(f"{MODO_ENV} debe ser uno de {MODOS}, no «{modo}».")
    client = _client()
    if modo != "texto":
        try:
            return _llamar(client, parts, con_esquema=True)
        except errors.ClientError as exc:
            if modo == "esquema" or not _es_error_de_esquema(exc):
                raise
            on_progress("Vertex rechazó el esquema de salida; se repite en modo texto.")
    return _llamar(client, parts, con_esquema=False)
