"""InvimÁgil Base — genera el archivo base (planilla.json + Excel maestro) de una carpeta de producto.

Uso:
    generar_base.py "C:\\ruta\\carpeta del producto"            genera planilla y Excel
    generar_base.py --aplicar "C:\\ruta\\carpeta del producto"  aplica las respuestas de la hoja Decisiones
    generar_base.py --instalar                                 guarda la clave y crea el menú de clic derecho
    generar_base.py --desinstalar                              quita el menú y la clave
"""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import json
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from invimagil_base import __version__  # noqa: E402
from invimagil_base.catalogos import load_catalog, validate_planilla  # noqa: E402
from invimagil_base.config import KEY_ENV, delete_api_key, load_api_key, output_dir, save_api_key  # noqa: E402
from invimagil_base.ui import Console  # noqa: E402
from invimagil_base.windows import (  # noqa: E402
    IS_WIN,
    install_context_menu,
    message_box,
    open_path,
    setup_console,
    uninstall_context_menu,
)

RECURSOS = HERE / "recursos"
PRICE_IN, PRICE_OUT, PRICE_CACHE_READ, PRICE_CACHE_WRITE = 4.0, 20.0, 0.20, 5.0  # USD per 1M tokens, Opus 5.5


def _cost(usage: dict) -> float:
    return (
        usage.get("input_tokens", 0) * PRICE_IN
        + usage.get("output_tokens", 0) * PRICE_OUT
        + usage.get("cache_read", 0) * PRICE_CACHE_READ
        + usage.get("cache_write", 0) * PRICE_CACHE_WRITE
    ) / 1e6


def _criterios_publicos() -> dict:
    """SPI criteria copied into planilla._meta so the browser add-on can apply them (e.g. reference list order)."""
    c = json.loads((RECURSOS / "criterios_spi.json").read_text(encoding="utf-8"))
    return {k: v for k, v in c.items() if not k.startswith("_") and k != "notas"}


def _safe_name(s: str) -> str:
    bad = '<>:"/\\|?*'
    out = "".join("-" if c in bad else c for c in (s or "producto")).strip(" .")
    return out[:80] or "producto"


def _excel_path(out: Path, planilla: dict) -> Path:
    return out / f"MAESTRO NSO - {_safe_name(planilla.get('_meta', {}).get('producto', 'producto'))}.xlsx"


def _append_log(out: Path, mode: str, planilla: dict, usage: dict, warnings: list[str], elapsed: float, con: Console) -> None:
    log = out / "log-nso.md"
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    n_ing = len((planilla.get("composition") or {}).get("ingredients") or [])
    n_dec = len(planilla.get("decisiones") or [])
    if not log.exists():
        log.write_text(f"# Log — {planilla.get('_meta', {}).get('producto', '')}\n\n| Fecha | Acción | Resultado | Avisos | Tokens / costo | Duración |\n|---|---|---|---|---|---|\n", encoding="utf-8")
    avisos = "<br>".join(w.replace("|", "/") for w in warnings) or "—"
    tok = f"{usage.get('input_tokens', 0):,} in / {usage.get('output_tokens', 0):,} out · USD {_cost(usage):.2f}" if usage else "sin llamada a la API"
    with log.open("a", encoding="utf-8") as f:
        f.write(f"| {stamp} | {mode} | {n_ing} ingredientes, {n_dec} decisiones pendientes | {avisos} | {tok} | {elapsed / 60:.1f} min |\n")


def _ask_folder() -> Path:
    print("Arrastre aquí la carpeta del producto (o pegue la ruta) y presione Enter:")
    raw = input("> ").strip().strip('"').strip("'")
    return Path(raw).expanduser()


def _require_key(con: Console) -> None:
    key = load_api_key()
    if key:
        os.environ[KEY_ENV] = key
        return
    con.warn("No hay clave de API guardada.")
    key = getpass.getpass("Pegue la clave de API (no se muestra al escribir) y presione Enter: ").strip()
    if not key:
        raise SystemExit("Sin clave no se puede continuar.")
    from invimagil_base.extraccion import verificar_clave

    err = verificar_clave(key)
    if err:
        raise SystemExit(f"La clave no sirve: {err}")
    save_api_key(key)
    os.environ[KEY_ENV] = key
    con.step("Clave verificada y guardada en este equipo (solo para este usuario).")


def _pause(no_pause: bool) -> None:
    if not no_pause and IS_WIN:
        input("\nPresione Enter para cerrar esta ventana.")


# --- Modes ----------------------------------------------------------------------------------
def cmd_generar(folder: Path, con: Console) -> Path:
    from invimagil_base.documentos import inventory_table, payload_mb, prepare_docs
    from invimagil_base.excel import write_excel

    t0 = time.time()
    if not folder.is_dir():
        raise SystemExit(f"No existe la carpeta: {folder}")
    cat = load_catalog(RECURSOS / "invimagil-catalogos.txt")
    out = output_dir(folder)
    con.banner(f"InvimÁgil Base {__version__} · {folder.name}")

    con.step("1/4 Leyendo los documentos de la carpeta…")
    docs = prepare_docs(folder, progress=con.detail)
    if not any(d.blocks for d in docs):
        raise SystemExit("La carpeta no tiene documentos legibles (PDF, Word, Excel o imágenes).")
    con.step(f"    {len(docs)} archivos preparados · {payload_mb(docs):.1f} MB a enviar")

    simulated = os.environ.get("INVIMAGIL_SIMULAR")
    if simulated:
        con.warn(f"MODO SIMULADO: se usa {simulated} en lugar de llamar a la API")
        planilla = json.loads(Path(simulated).read_text(encoding="utf-8"))
        usage = {}
    else:
        _require_key(con)
        from invimagil_base.extraccion import extraer

        con.step("2/4 Extrayendo los datos con el modelo (esto toma varios minutos; no cierre la ventana)…")
        planilla, usage = extraer(docs, folder.name, on_progress=con.detail)
        con.step(f"    Listo · {usage['input_tokens']:,} tokens de entrada, {usage['output_tokens']:,} de salida · USD {_cost(usage):.2f}")

    con.step("3/4 Validando contra el catálogo de InvimÁgil…")
    warnings = validate_planilla(planilla, cat)
    for w in warnings:
        con.detail(f"    · {w}")
    planilla.setdefault("_meta", {})["generado"] = f"{dt.datetime.now():%Y-%m-%d %H:%M} · InvimÁgil Base {__version__}"
    planilla["_meta"]["inventario"] = inventory_table(docs)
    planilla["_meta"]["criterios"] = _criterios_publicos()

    pj = out / "planilla.json"
    if pj.exists():
        shutil.copy2(pj, out / f"planilla.anterior.{dt.datetime.now():%Y%m%d-%H%M}.json")
    pj.write_text(json.dumps(planilla, ensure_ascii=False, indent=1), encoding="utf-8")

    con.step("4/4 Escribiendo el Excel maestro…")
    xlsx = _excel_path(out, planilla)
    write_excel(planilla, folder, xlsx, cat, resueltas=planilla.get("_decisiones_resueltas"))
    _append_log(out, "Generar archivo base", planilla, usage, warnings, time.time() - t0, con)

    n_dec = len(planilla.get("decisiones") or [])
    n_ing = len((planilla.get("composition") or {}).get("ingredients") or [])
    n_pres = len((planilla.get("general") or {}).get("presentations") or [])
    ileg = [a["archivo"] for a in planilla.get("archivos") or [] if not a.get("legible")]
    resumen = (
        f"Producto: {planilla.get('_meta', {}).get('producto', '?')}\n\n"
        f"Ingredientes: {n_ing}\nPresentaciones: {n_pres}\nDecisiones pendientes: {n_dec}\n"
        + (f"Archivos que no se pudieron leer: {len(ileg)}\n" if ileg else "")
        + f"\nEl Excel quedó en:\n{xlsx}\n\nRevise la hoja «Decisiones», responda en la columna amarilla y luego use clic derecho → «Aplicar decisiones InvimÁgil»."
    )
    con.banner("Terminado")
    con.detail(resumen)
    message_box("InvimÁgil Base — listo", resumen)
    open_path(xlsx)
    return xlsx


def cmd_aplicar(folder: Path, con: Console) -> Path:
    from invimagil_base.excel import read_answers, write_excel

    t0 = time.time()
    out = output_dir(folder)
    pj = out / "planilla.json"
    if not pj.exists():
        raise SystemExit("Esta carpeta aún no tiene archivo base. Use primero «Generar archivo base InvimÁgil».")
    planilla = json.loads(pj.read_text(encoding="utf-8"))
    xlsx = _excel_path(out, planilla)
    if not xlsx.exists():
        cands = list(out.glob("MAESTRO NSO - *.xlsx"))
        if not cands:
            raise SystemExit("No se encontró el Excel maestro en la carpeta _invimagil.")
        xlsx = cands[0]
    con.banner(f"InvimÁgil Base {__version__} · aplicar decisiones · {folder.name}")
    con.step("1/3 Leyendo las respuestas de la hoja Decisiones…")
    try:
        answers = read_answers(xlsx)
    except PermissionError:
        raise SystemExit("El Excel está abierto. Ciérrelo y vuelva a intentar.") from None
    if not answers:
        msg = "No hay respuestas en la columna amarilla de la hoja Decisiones. Escríbalas, guarde el Excel y vuelva a intentar."
        message_box("InvimÁgil Base", msg)
        raise SystemExit(msg)
    for a in answers:
        con.detail(f"    {a['id']}: {a['respuesta'][:90]}")

    cat = load_catalog(RECURSOS / "invimagil-catalogos.txt")
    simulated = os.environ.get("INVIMAGIL_SIMULAR")
    if simulated:
        con.warn("MODO SIMULADO: no se llama a la API; se marcan las decisiones como resueltas sin cambiar campos")
        ids = {a["id"] for a in answers}
        planilla["decisiones"] = [d for d in planilla.get("decisiones") or [] if d.get("id") not in ids]
        usage = {}
    else:
        _require_key(con)
        from invimagil_base.extraccion import aplicar_decisiones

        con.step("2/3 Aplicando las decisiones con el modelo…")
        planilla, usage = aplicar_decisiones(planilla, answers, on_progress=con.detail)
        con.step(f"    Listo · USD {_cost(usage):.2f}")

    warnings = validate_planilla(planilla, cat)
    prev = json.loads(pj.read_text(encoding="utf-8"))
    resueltas = (prev.get("_decisiones_resueltas") or []) + [
        {**a, "fecha": f"{dt.datetime.now():%Y-%m-%d}"} for a in answers if a["id"] not in {d.get("id") for d in planilla.get("decisiones") or []}
    ]
    planilla["_decisiones_resueltas"] = resueltas
    planilla.setdefault("_meta", {})["generado"] = f"{dt.datetime.now():%Y-%m-%d %H:%M} · InvimÁgil Base {__version__} · decisiones aplicadas"
    planilla["_meta"]["inventario"] = prev.get("_meta", {}).get("inventario", "")
    shutil.copy2(pj, out / f"planilla.anterior.{dt.datetime.now():%Y%m%d-%H%M}.json")
    pj.write_text(json.dumps(planilla, ensure_ascii=False, indent=1), encoding="utf-8")

    con.step("3/3 Regenerando el Excel maestro…")
    try:
        write_excel(planilla, folder, xlsx, cat, resueltas=resueltas)
    except PermissionError:
        raise SystemExit("El Excel está abierto. Ciérrelo y vuelva a intentar.") from None
    _append_log(out, f"Aplicar decisiones ({', '.join(a['id'] for a in answers)})", planilla, usage, warnings, time.time() - t0, con)
    pend = len(planilla.get("decisiones") or [])
    still = [a["id"] for a in answers if a["id"] in {d.get("id") for d in planilla.get("decisiones") or []}]
    resumen = f"Decisiones aplicadas: {len(answers) - len(still)}\nQuedan pendientes: {pend}" + (f"\nNo se pudieron cerrar (respuesta ambigua): {', '.join(still)}" if still else "") + f"\n\nExcel actualizado:\n{xlsx}"
    con.banner("Terminado")
    con.detail(resumen)
    message_box("InvimÁgil Base — decisiones aplicadas", resumen)
    open_path(xlsx)
    return xlsx


def cmd_instalar(con: Console) -> None:
    con.banner(f"InvimÁgil Base {__version__} · instalación")
    if not load_api_key():
        _require_key(con)
    else:
        con.step("Ya hay una clave guardada; se conserva.")
    python_exe = Path(sys.executable).resolve()
    paths = install_context_menu(python_exe, HERE / "generar_base.py", HERE / "recursos" / "invimagil.ico")
    if paths:
        con.step("Menú de clic derecho creado: «Generar archivo base InvimÁgil» y «Aplicar decisiones InvimÁgil».")
    else:
        con.step("Este sistema no es Windows: no se crea menú contextual. Use la línea de comandos.")
    msg = "Instalación lista.\n\nAhora puede hacer clic derecho sobre cualquier carpeta de producto y elegir «Generar archivo base InvimÁgil».\n\nNo mueva ni borre esta carpeta del programa: el menú apunta a ella."
    con.detail(msg)
    message_box("InvimÁgil Base", msg)


def cmd_cambiar_clave(con: Console) -> None:
    con.banner(f"InvimÁgil Base {__version__} · cambiar clave de API")
    delete_api_key()
    os.environ.pop(KEY_ENV, None)
    _require_key(con)
    msg = "Clave reemplazada. El menú de clic derecho sigue igual."
    con.detail(msg)
    message_box("InvimÁgil Base", msg)


def cmd_desinstalar(con: Console) -> None:
    uninstall_context_menu()
    delete_api_key()
    msg = "Se quitó el menú de clic derecho y la clave guardada. Puede borrar la carpeta del programa."
    con.step(msg)
    message_box("InvimÁgil Base", msg)


def _comprobar_instalacion() -> str | None:
    """Return a Spanish message if the program is running from a temp/zip folder or files are missing."""
    here = str(HERE).lower()
    if IS_WIN and ("\\temp\\" in here or ".zip\\" in here):
        return (
            "El programa se está ejecutando desde dentro del archivo .zip (carpeta temporal de Windows).\n\n"
            "Primero descomprímalo: clic derecho sobre el .zip → «Extraer todo…» → elija Documentos.\n"
            "Luego abra la carpeta extraída y ejecute Instalar.bat desde ahí."
        )
    faltan = []
    for mod, nombre in (("anthropic", "anthropic"), ("openpyxl", "openpyxl"), ("pymupdf", "pymupdf"), ("docx", "python-docx")):
        try:
            __import__(mod)
        except Exception as exc:  # noqa: BLE001
            faltan.append(f"{nombre} ({type(exc).__name__}: {str(exc)[:80]})")
    if faltan:
        return (
            "Faltan archivos del programa; la carpeta se copió incompleta:\n- " + "\n- ".join(faltan)
            + "\n\nVuelva a descomprimir el .zip con «Extraer todo…» directamente en Documentos (ruta corta) y ejecute Instalar.bat de nuevo."
        )
    return None


def main(argv: list[str] | None = None) -> int:
    setup_console()
    problema = _comprobar_instalacion()
    if problema:
        print(problema)
        message_box("InvimÁgil Base — instalación incompleta", problema, error=True)
        _pause(False)
        return 3
    ap = argparse.ArgumentParser(prog="generar_base", description="InvimÁgil Base")
    ap.add_argument("carpeta", nargs="?", help="carpeta del producto")
    ap.add_argument("--aplicar", action="store_true", help="aplicar las respuestas de la hoja Decisiones")
    ap.add_argument("--instalar", action="store_true")
    ap.add_argument("--desinstalar", action="store_true")
    ap.add_argument("--cambiar-clave", action="store_true", help="borrar la clave guardada y pedir una nueva")
    ap.add_argument("--sin-pausa", action="store_true", help="no esperar Enter al final")
    args = ap.parse_args(argv)
    con = Console()
    code = 0
    try:
        if args.instalar:
            cmd_instalar(con)
        elif args.desinstalar:
            cmd_desinstalar(con)
        elif args.cambiar_clave:
            cmd_cambiar_clave(con)
        else:
            folder = Path(args.carpeta).expanduser() if args.carpeta else _ask_folder()
            folder = folder.resolve()
            if folder.name == "_invimagil":
                folder = folder.parent
            if args.aplicar:
                cmd_aplicar(folder, con)
            else:
                cmd_generar(folder, con)
    except SystemExit as exc:
        if exc.code not in (None, 0):
            msg = str(exc.code)
            con.warn(msg)
            message_box("InvimÁgil Base — no se pudo continuar", msg, error=True)
            code = 1
    except KeyboardInterrupt:
        con.warn("Cancelado por el usuario.")
        code = 130
    except Exception as exc:  # noqa: BLE001
        detail = traceback.format_exc()
        try:
            err_file = Path(args.carpeta or ".").expanduser().resolve()
            err_file = (err_file / "_invimagil" if err_file.is_dir() else Path.cwd()) / "ultimo-error.txt"
            err_file.parent.mkdir(exist_ok=True)
            err_file.write_text(detail, encoding="utf-8")
        except Exception:  # noqa: BLE001
            err_file = None
        msg = f"Ocurrió un error inesperado:\n{type(exc).__name__}: {exc}\n\nTome una captura de esta ventana y avise a Edmundo." + (f"\nDetalle guardado en: {err_file}" if err_file else "")
        con.warn(msg)
        con.detail(detail)
        message_box("InvimÁgil Base — error", msg, error=True)
        code = 2
    _pause(args.sin_pausa)
    return code


if __name__ == "__main__":
    sys.exit(main())
