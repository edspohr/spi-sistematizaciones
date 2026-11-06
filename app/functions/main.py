"""Cloud Functions for SPI Sistematización (Firebase, Python 2nd gen).

Callables used by the web app:
    extraer_tramite(tramiteId)                     dossier in Storage -> planilla (Gemini)
    aplicar_decisiones(tramiteId, respuestas[])    analyst answers -> new planilla version
    exportar_excel(tramiteId)                      planilla -> MAESTRO NSO xlsx in Storage

Data model (see app/README.md):
    usuarios/{email}                 {nombre, rol: admin|analista, activo}
    clientes/{id}                    {nombre, titular_nso, representante_legal, responsable_tecnico}
    config/criterios                 overrides of extractor/recursos/criterios_spi.json
    tramites/{id}                    state, summary, NSO vigente, INVIMA result
    tramites/{id}/planillas/v{n}     {json, version, origen, por, creado}
    tramites/{id}/eventos/{auto}     audit log
    Storage tramites/{id}/dossier/…  the product folder as uploaded
    Storage tramites/{id}/salida/…   generated files
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "nucleo"))

from firebase_admin import firestore, initialize_app, storage  # noqa: E402
from firebase_functions import https_fn, options  # noqa: E402
from invimagil_base import __version__ as NUCLEO_VERSION  # noqa: E402
from invimagil_base.catalogos import load_catalog, validate_planilla  # noqa: E402
from invimagil_base.prompts import RECURSOS, ExtraccionError, criterios_publicos, criterios_spi, intro_aplicar, intro_extraer  # noqa: E402

REGION = "southamerica-east1"
APP_VERSION = "0.1.0"
SIMULAR_ENV = "INVIMAGIL_SIMULAR"  # path to a planilla.json: skips Gemini (emulator / layout work)
EXTRACCION_COLGADA = dt.timedelta(minutes=35)

initialize_app()
options.set_global_options(region=REGION, max_instances=10)

Codigo = https_fn.FunctionsErrorCode


def _db():
    return firestore.client()


def _bucket():
    """Default bucket. Against the Storage emulator, anonymous credentials: otherwise the client
    tries to refresh the developer's Application Default Credentials before every call."""
    host = os.environ.get("FIREBASE_STORAGE_EMULATOR_HOST") or os.environ.get("STORAGE_EMULATOR_HOST")
    if not host:
        return storage.bucket()
    from google.auth.credentials import AnonymousCredentials
    from google.cloud import storage as gcs

    cfg = json.loads(os.environ.get("FIREBASE_CONFIG") or "{}")
    name = cfg.get("storageBucket") or f"{cfg.get('projectId', 'demo-spi-invimagil')}.appspot.com"
    endpoint = host if host.startswith("http") else f"http://{host}"
    client = gcs.Client(project=cfg.get("projectId"), credentials=AnonymousCredentials(), client_options={"api_endpoint": endpoint})
    return client.bucket(name)


def _ahora() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _usuario(req: https_fn.CallableRequest) -> dict:
    if not req.auth:
        raise https_fn.HttpsError(Codigo.UNAUTHENTICATED, "Inicie sesión.")
    email = (req.auth.token or {}).get("email")
    if not email:
        raise https_fn.HttpsError(Codigo.PERMISSION_DENIED, "La cuenta no tiene correo.")
    doc = _db().collection("usuarios").document(email).get()
    if not doc.exists or not doc.get("activo"):
        raise https_fn.HttpsError(Codigo.PERMISSION_DENIED, f"{email} no tiene acceso a la herramienta.")
    return {"email": email, **doc.to_dict()}


def _tramite(tid: str):
    if not tid or not isinstance(tid, str):
        raise https_fn.HttpsError(Codigo.INVALID_ARGUMENT, "Falta tramiteId.")
    ref = _db().collection("tramites").document(tid)
    snap = ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(Codigo.NOT_FOUND, "El trámite no existe.")
    return ref, snap.to_dict()


def _evento(ref, tipo: str, por: str, detalle: str = "") -> None:
    ref.collection("eventos").add({"tipo": tipo, "detalle": detalle[:2000], "por": por, "fecha": _ahora()})


def _criterios(tramite: dict) -> dict:
    """criterios_spi.json, then config/criterios, then the client's own data."""
    c = criterios_spi()
    over = _db().collection("config").document("criterios").get()
    if over.exists:
        c.update({k: v for k, v in (over.to_dict() or {}).items() if v not in (None, "")})
    if tramite.get("clienteId"):
        cli = _db().collection("clientes").document(tramite["clienteId"]).get()
        if cli.exists:
            d = cli.to_dict() or {}
            for k in ("titular_nso", "representante_legal", "responsable_tecnico"):
                if d.get(k):
                    c[k] = d[k]
    return c


def _planilla_actual(ref, tramite: dict) -> dict:
    v = tramite.get("version")
    if not v:
        raise https_fn.HttpsError(Codigo.FAILED_PRECONDITION, "El trámite aún no tiene planilla. Extraiga primero.")
    snap = ref.collection("planillas").document(f"v{v}").get()
    if not snap.exists:
        raise https_fn.HttpsError(Codigo.DATA_LOSS, f"No se encontró la versión v{v} de la planilla.")
    return json.loads(snap.get("json"))


def _resumen(planilla: dict, avisos: list[str]) -> dict:
    return {
        "producto": (planilla.get("_meta") or {}).get("producto") or "",
        "ingredientes": len((planilla.get("composition") or {}).get("ingredients") or []),
        "presentaciones": len((planilla.get("general") or {}).get("presentations") or []),
        "decisiones": len(planilla.get("decisiones") or []),
        "avisos": avisos[:50],
    }


def _guardar_planilla(ref, tramite: dict, planilla: dict, origen: str, por: str, avisos: list[str], uso: dict, estado: str) -> int:
    version = int(tramite.get("version") or 0) + 1
    ref.collection("planillas").document(f"v{version}").set(
        {"json": json.dumps(planilla, ensure_ascii=False), "version": version, "origen": origen, "por": por, "creado": _ahora(), "uso": uso}
    )
    resumen = _resumen(planilla, avisos)
    upd = {
        "version": version,
        "estado": estado,
        "resumen": resumen,
        "uso": uso,
        "error": None,
        "progreso": None,
        "actualizado": _ahora(),
    }
    if resumen["producto"] and not tramite.get("productoConfirmado"):
        upd["producto"] = resumen["producto"]
    ref.update(upd)
    return version


def _fallo(ref, por: str, accion: str, exc: Exception, estado_previo: str) -> https_fn.HttpsError:
    msg = f"{type(exc).__name__}: {exc}"
    ref.update({"estado": "error" if accion == "extraer" else estado_previo, "error": msg[:1500], "progreso": None, "actualizado": _ahora()})
    detalle = traceback.format_exc()
    if getattr(exc, "respuesta", None):
        detalle += "\n--- respuesta del modelo (inicio) ---\n" + exc.respuesta[:3000]
    _evento(ref, f"error_{accion}", por, detalle)
    return https_fn.HttpsError(Codigo.INTERNAL, msg[:500])


def _simulada() -> dict | None:
    p = os.environ.get(SIMULAR_ENV)
    return json.loads(Path(p).read_text(encoding="utf-8")) if p else None


@https_fn.on_call(timeout_sec=1800, memory=options.MemoryOption.GB_1)
def extraer_tramite(req: https_fn.CallableRequest) -> dict:
    u = _usuario(req)
    ref, t = _tramite((req.data or {}).get("tramiteId"))
    if t.get("estado") == "extrayendo" and t.get("progresoDesde") and _ahora() - t["progresoDesde"] < EXTRACCION_COLGADA:
        raise https_fn.HttpsError(Codigo.FAILED_PRECONDITION, "Ya hay una extracción en curso para este trámite.")
    previo = t.get("estado") or "cargado"
    ref.update({"estado": "extrayendo", "progreso": "Preparando documentos…", "progresoDesde": _ahora(), "error": None})
    _evento(ref, "extraccion_iniciada", u["email"])
    try:
        from spi import dossier

        criterios = _criterios(t)
        bucket = _bucket()

        def progreso(m: str) -> None:
            ref.update({"progreso": m[:300]})

        parts, archivos = dossier.construir_partes(
            bucket, f"tramites/{ref.id}/dossier/", lambda n: intro_extraer(n, t.get("carpeta") or t.get("producto") or ref.id, criterios), progreso
        )
        if not archivos:
            raise ExtraccionError("El trámite no tiene documentos cargados.")
        simulada = _simulada()
        if simulada is not None:
            planilla, uso = simulada, {"modo": "simulado"}
        else:
            from spi import gemini

            progreso(f"Extrayendo con Gemini ({len(archivos)} archivos; toma varios minutos)…")
            r = gemini.generar(parts, progreso)
            planilla, uso = r.planilla, r.uso
        cat = load_catalog(RECURSOS / "invimagil-catalogos.txt")
        avisos = validate_planilla(planilla, cat)
        meta = planilla.setdefault("_meta", {})
        meta["generado"] = f"{_ahora():%Y-%m-%d %H:%M} UTC · SPI Sistematización {APP_VERSION} · núcleo {NUCLEO_VERSION}"
        meta["inventario"] = dossier.inventario(archivos)
        meta["criterios"] = criterios_publicos(criterios)
        version = _guardar_planilla(ref, t, planilla, "extraccion", u["email"], avisos, uso, "en_revision")
        _evento(ref, "extraccion_terminada", u["email"], f"v{version} · {len(archivos)} archivos · modo {uso.get('modo')}")
        return {"version": version, "resumen": _resumen(planilla, avisos)}
    except https_fn.HttpsError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _fallo(ref, u["email"], "extraer", exc, previo) from exc


@https_fn.on_call(timeout_sec=1800, memory=options.MemoryOption.GB_1)
def aplicar_decisiones(req: https_fn.CallableRequest) -> dict:
    u = _usuario(req)
    data = req.data or {}
    ref, t = _tramite(data.get("tramiteId"))
    planilla = _planilla_actual(ref, t)
    por_id = {d.get("id"): d for d in planilla.get("decisiones") or []}
    respuestas = []
    for r in data.get("respuestas") or []:
        d = por_id.get(r.get("id"))
        texto = str(r.get("respuesta") or "").strip()
        if d and texto:
            respuestas.append({"id": d["id"], "tema": d.get("tema", ""), "donde": d.get("donde", ""), "hallazgo": d.get("hallazgo", ""), "propuesta": d.get("propuesta", ""), "respuesta": texto})
    if not respuestas:
        raise https_fn.HttpsError(Codigo.INVALID_ARGUMENT, "No hay respuestas para aplicar.")
    previo = t.get("estado") or "en_revision"
    ref.update({"progreso": "Aplicando decisiones…", "progresoDesde": _ahora()})
    try:
        if _simulada() is not None:
            ids = {r["id"] for r in respuestas}
            nueva = {**planilla, "decisiones": [d for d in planilla.get("decisiones") or [] if d.get("id") not in ids]}
            uso = {"modo": "simulado"}
        else:
            from google.genai import types

            from spi import gemini

            r = gemini.generar([types.Part.from_text(text=intro_aplicar(planilla, respuestas, _criterios(t)))])
            nueva, uso = r.planilla, r.uso
        avisos = validate_planilla(nueva, load_catalog(RECURSOS / "invimagil-catalogos.txt"))
        pendientes = {d.get("id") for d in nueva.get("decisiones") or []}
        hoy = f"{_ahora():%Y-%m-%d}"
        nueva["_decisiones_resueltas"] = (planilla.get("_decisiones_resueltas") or []) + [
            {**r, "fecha": hoy, "por": u["email"]} for r in respuestas if r["id"] not in pendientes
        ]
        meta = nueva.setdefault("_meta", {})
        for k in ("inventario", "criterios"):
            meta[k] = (planilla.get("_meta") or {}).get(k, meta.get(k))
        meta["generado"] = f"{_ahora():%Y-%m-%d %H:%M} UTC · SPI Sistematización {APP_VERSION} · decisiones aplicadas"
        version = _guardar_planilla(ref, t, nueva, "decisiones", u["email"], avisos, uso, previo if previo != "error" else "en_revision")
        sin_cerrar = [r["id"] for r in respuestas if r["id"] in pendientes]
        _evento(ref, "decisiones_aplicadas", u["email"], f"v{version} · {', '.join(r['id'] for r in respuestas)}" + (f" · sin cerrar: {', '.join(sin_cerrar)}" if sin_cerrar else ""))
        return {"version": version, "sinCerrar": sin_cerrar, "pendientes": len(pendientes)}
    except https_fn.HttpsError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _fallo(ref, u["email"], "decisiones", exc, previo) from exc


@https_fn.on_call(timeout_sec=300, memory=options.MemoryOption.MB_512)
def exportar_excel(req: https_fn.CallableRequest) -> dict:
    from invimagil_base.excel import write_excel

    u = _usuario(req)
    ref, t = _tramite((req.data or {}).get("tramiteId"))
    planilla = _planilla_actual(ref, t)
    bucket = _bucket()
    prefix = f"tramites/{ref.id}/dossier/"
    producto = (planilla.get("_meta") or {}).get("producto") or t.get("producto") or "producto"
    nombre = "MAESTRO NSO - " + "".join("-" if c in '<>:"/\\|?*' else c for c in producto).strip(" .")[:80] + ".xlsx"
    with tempfile.TemporaryDirectory() as tmp:
        carpeta = Path(tmp) / (t.get("carpeta") or "carpeta")
        # The Excel writer reports each attachment's size from the folder: sparse placeholders of the real size.
        for b in bucket.list_blobs(prefix=prefix):
            p = carpeta / b.name[len(prefix):]
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "wb") as f:
                f.truncate(b.size or 0)
        out = Path(tmp) / nombre
        write_excel(planilla, carpeta, out, load_catalog(RECURSOS / "invimagil-catalogos.txt"), resueltas=planilla.get("_decisiones_resueltas"))
        destino = f"tramites/{ref.id}/salida/{nombre}"
        bucket.blob(destino).upload_from_filename(
            str(out), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    _evento(ref, "excel_exportado", u["email"], f"v{t.get('version')} · {nombre}")
    return {"ruta": destino, "nombre": nombre}
