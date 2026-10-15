# InvimÁgil Systematization Assistant

Local, offline toolchain that helps a regulatory analyst migrate existing Colombian
sanitary registrations (cosméticos) into INVIMA's InvimÁgil platform.

Two modules share a single field schema:

1. **Extractor** (Python CLI) — reads dossier PDFs, produces a canonical
   `ficha.json` and a color-coded `planilla.xlsx` for human review.
2. **Extension** (Chrome MV3) — assists filling the InvimÁgil web form one
   section at a time. The human approves each section and performs the final
   submission. The extension never submits.

## Non-negotiable constraints

- The only network traffic allowed is the Anthropic API (organization configured
  with zero data retention, agreed with SPI on 2026-09-15). No other cloud services,
  no telemetry. The mapping kit (`tools/`) stays fully offline.
- The extension fills; the human approves and submits.
- No credentials. The extension uses the analyst's already-open session.
- All user-facing text in Spanish (Colombia). Code, comments, commits in English.
- Runs on Windows 11, no admin rights, one-command setup.

## Repository layout

```
tools/     Live-session mapping kit (Slice 0) + package build script
schema/    Shared field schema (data, not code)
extractor/ InvimÁgil Base: product folder -> planilla.json + Excel maestro (Slice 2)
extension/ Chrome MV3 extension (Slices 1 and 3)
docs/      User-facing documentation, Spanish
dist/      Hand-off packages (zips are gitignored)
samples/   Sample dossiers (gitignored, never committed)
```

## Slice 2 — InvimÁgil Base (extractor)

Windows tool for the analyst, no admin rights: right-click a product folder →
**Generar archivo base InvimÁgil**. Reads every PDF/DOCX/XLSX/image in the folder,
sends them in one call to `claude-opus-5-5` with structured output (schema in
`extractor/invimagil_base/esquema.py`, rules in `extractor/recursos/prompt_fase_a.md`),
validates every `{slug, name}` against `extractor/recursos/invimagil-catalogos.txt`,
and writes to `<folder>/_invimagil/`: `planilla.json`, `MAESTRO NSO - <producto>.xlsx`
(one sheet per wizard step + Decisiones sheet) and `log-nso.md`. A second entry,
**Aplicar decisiones InvimÁgil**, reads the analyst's answers from the yellow column
of the Decisiones sheet and regenerates both files.

- Run locally on macOS/Linux for development:
  `ANTHROPIC_API_KEY=... python3 extractor/generar_base.py "<carpeta>"`
  (`INVIMAGIL_SIMULAR=<planilla.json>` skips the API call; useful for layout work).
- Build the hand-off zip (embeddable Python 3.12 + wheels, nothing compiled):
  `tools/build-windows-package.sh` → `dist/InvimagilBase-<date>.zip`.
- SPI defaults (titular, apoderado, unidad, listado de referencia):
  `extractor/recursos/criterios_spi.json`.
- Analyst docs: `docs/INSTRUCCIONES-LAURA-BASE.md`.


## Slice 0 — Live Mapping Kit (this repo, right now)

For the first working session with the analyst, before any extension exists.

- `tools/mapper.js` — pasteable DevTools Snippet. Maps InvimÁgil form fields,
  runs a safe value-injection test, probes the ingredient autocomplete, takes
  sanitized screen snapshots. Exports a JSON of everything captured. Zero
  network. Autosaves to `localStorage`. Survives SPA navigations.
- `tools/mapper.bookmarklet.txt` — fallback bookmarklet (may be blocked by CSP).
- `tools/mock-invimagil.html` — local rehearsal page.
- `schema/fields.cosmeticos.json` — seed field schema (expanded in-session).
- `docs/GUION-SESION.md` — session run order, Spanish.

### Using the mapper (short version, full guide in `docs/GUION-SESION.md`)

1. Open the InvimÁgil page in Chrome. Log in as usual.
2. Open DevTools (F12) → **Sources** → **Snippets** → **New snippet**.
3. If Chrome asks, type `allow pasting` in the Console first.
4. Paste the contents of `tools/mapper.js` → Ctrl+Enter.
5. Follow the panel that appears in the bottom-right.

The mapper writes only to your local `localStorage` and to a JSON download.
It never sends anything anywhere.
