# Smoke test — mapper.js against mock-invimagil.html

Manual test before shipping the handoff. Takes ~3 minutes. Playwright is not
installed on this machine, so this is documented instead of automated.

## Setup

1. `open tools/mock-invimagil.html` (Chrome or Edge — the mapper is
   browser-agnostic; the guion is Edge-specific because that is what the
   analyst uses).
2. F12 → *Sources / Orígenes* → *Snippets / Fragmentos*.
3. New snippet, paste `tools/mapper.js`, Ctrl+Enter.

## Steps

- [ ] Panel appears bottom-right titled **InvimÁgil — Mapeo**.
- [ ] Progress strip shows the 10 screen chips, all grey (pending).
- [ ] Pick `sistematizacion` in the dropdown → **Marcar pantalla**.
  - Chip turns light blue with orange outline.
- [ ] Pick `producto` → **Marcar pantalla**.
  - `producto` chip turns light blue (orange outline moves to it).
- [ ] **Guardar snapshot** → `producto` chip turns green.
- [ ] Click **Mapear** next to *Nombre del producto* → click the
      `#nombre` input → chip for current screen shows count `(1)`.
- [ ] **＋ Campo nuevo** → click on the `#marca` input → accept the
      suggested key `marca` → accept section `producto` → chip count
      becomes `(2)`.
- [ ] **Probar inyección** → confirm advertencia → accept detected
      search box (the `input[type=search]`) → wait for alert:
      *"El valor se mantuvo…"* + *"Valor original restaurado."*
- [ ] In sonda section, click **Iniciar** for **caso1** → click the
      `#inci` combobox → type `Aqua` → pick an option → **Detener
      sonda** → checklist for caso1 turns to `✓`.
- [ ] **Descargar JSON** → confirm resumen (should list marked screens,
      counts, injection = OK, sonda caso1 done, caso2-4 pending) →
      confirm warn → file `mapeo-invimagil-sistematizacion-YYYYMMDD-HHmm.json`
      downloads.
- [ ] Open the JSON, verify keys: `resumen`, `pantallas`, `mapeos`,
      `camposAdHoc`, `pruebasInyeccion`, `sondas`.
- [ ] Reload the mock page (mapper disappears).
- [ ] Re-run the snippet → panel reappears with the same state
      (pantallas marked, campos mapped, sonda caso1 done).
- [ ] Click **Borrar todo** to clean up localStorage.

If every checkbox passes, the kit is ready to ship. If any fails, do not
run `tools/build-handoff.sh` for distribution — fix first.
