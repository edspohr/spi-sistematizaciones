"""Claude API calls: folder -> planilla, and planilla + answers -> updated planilla."""
from __future__ import annotations

import json
from pathlib import Path

import anthropic

from .documentos import Doc, build_user_content
from .esquema import build_schema

MODEL = "claude-opus-5-5"
EFFORT = "high"
MAX_TOKENS = 64000

RECURSOS = Path(__file__).resolve().parent.parent / "recursos"


class ExtraccionError(RuntimeError):
    pass


def _system_blocks() -> list[dict]:
    prompt = (RECURSOS / "prompt_fase_a.md").read_text(encoding="utf-8")
    catalog = (RECURSOS / "invimagil-catalogos.txt").read_text(encoding="utf-8")
    return [
        {"type": "text", "text": prompt},
        {
            "type": "text",
            "text": "# Catálogo InvimÁgil (listas jerárquicas; formato `slug | NOMBRE`, la sangría indica el nivel)\n\n" + catalog,
            "cache_control": {"type": "ephemeral"},
        },
    ]


def _criterios_text() -> str:
    c = json.loads((RECURSOS / "criterios_spi.json").read_text(encoding="utf-8"))
    lines = [
        "# Criterios fijos de SPI para este producto",
        f"- Titular de la NSO: {c.get('titular_nso') or 'pendiente (decisión)'}",
        f"- Representante legal / apoderado: {c.get('representante_legal') or 'pendiente (decisión)'}",
        f"- Responsable técnico: {c.get('responsable_tecnico') or 'no definido: dejar como decisión'}",
        f"- Unidad de composición: {c['unidad_composicion']['slug']} | {c['unidad_composicion']['name']}",
        f"- Listado de referencia: {c['listado_referencia']['slug']} | {c['listado_referencia']['name']}",
        f"- Tipo de fabricante por defecto: {c.get('fabricante_tipo_por_defecto', 'tercero')}",
        f"- Tamaño máximo por adjunto: {c.get('tamano_maximo_adjunto_mb', 10)} MB",
    ]
    for n in c.get("notas", []):
        lines.append(f"- {n}")
    return "\n".join(lines)


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(timeout=1800.0, max_retries=2)


def _run(client: anthropic.Anthropic, user_content: list[dict], on_progress) -> tuple[dict, dict]:
    schema = build_schema()
    with client.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=_system_blocks(),
        messages=[{"role": "user", "content": user_content}],
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": schema}},
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
    text = next(b.text for b in message.content if b.type == "text")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ExtraccionError(f"La respuesta no es JSON válido: {exc}") from exc
    u = message.usage
    usage = {
        "input_tokens": u.input_tokens,
        "output_tokens": u.output_tokens,
        "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
        "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0,
        "model": message.model,
    }
    return data, usage


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
        "escribe el valor decidido (con su slug de catálogo si corresponde), pon `_decision` en null en los campos resueltos, "
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
