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

- Fully offline. No network calls, ever. No LLM APIs, no cloud OCR, no telemetry.
- The extension fills; the human approves and submits.
- No credentials. The extension uses the analyst's already-open session.
- All user-facing text in Spanish (Colombia). Code, comments, commits in English.
- Runs on Windows 11, no admin rights, one-command setup.

## Repository layout

```
tools/     Live-session mapping kit (Slice 0)
schema/    Shared field schema (data, not code)
extractor/ Python CLI (Slice 2)
extension/ Chrome MV3 extension (Slices 1 and 3)
docs/      User-facing documentation, Spanish
samples/   Sample dossiers (gitignored, never committed)
```

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
