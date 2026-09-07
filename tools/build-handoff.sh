#!/usr/bin/env bash
# Build the handoff package for the analyst.
#
# Output: dist/handoff-laura-YYYYMMDD.zip containing:
#   - mapper.js
#   - mapper.bookmarklet.txt (rebuilt from mapper.js)
#   - GUION-SESION.md
#   - CHECKLIST-LAURA.md
#   - mock-invimagil.html
#   - LEEME.txt
#
# The dist/ directory is gitignored.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
DOCS="$ROOT/docs"
DIST="$ROOT/dist"
STAMP="$(date +%Y%m%d)"
STAGE="$DIST/handoff-laura-$STAMP"
ZIP="$DIST/handoff-laura-$STAMP.zip"

mkdir -p "$STAGE"

# Rebuild the bookmarklet so the zip is always in sync with mapper.js.
bash "$TOOLS/build-bookmarklet.sh"

cp "$TOOLS/mapper.js"                 "$STAGE/mapper.js"
cp "$TOOLS/mapper.bookmarklet.txt"    "$STAGE/mapper.bookmarklet.txt"
cp "$TOOLS/mock-invimagil.html"       "$STAGE/mock-invimagil.html"
cp "$DOCS/GUION-SESION.md"            "$STAGE/GUION-SESION.md"
cp "$DOCS/CHECKLIST-LAURA.md"         "$STAGE/CHECKLIST-LAURA.md"

cat > "$STAGE/LEEME.txt" <<'EOF'
Kit de mapeo InvimAgil - sesion de Laura.
Nunca envia datos a Internet; solo guarda un JSON local que usted descarga.
Devuelva el JSON exportado al equipo de Sistematizaciones por el canal acordado.
EOF

# Zip: prefer the built-in `zip` if present; otherwise fall back to Python.
if command -v zip >/dev/null 2>&1; then
  (cd "$DIST" && rm -f "$(basename "$ZIP")" && zip -qr "$(basename "$ZIP")" "$(basename "$STAGE")")
else
  python3 - "$STAGE" "$ZIP" <<'PY'
import os, sys, zipfile
stage, out = sys.argv[1], sys.argv[2]
if os.path.exists(out): os.remove(out)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(stage):
        for f in files:
            p = os.path.join(root, f)
            arc = os.path.relpath(p, os.path.dirname(stage))
            z.write(p, arc)
PY
fi

echo "wrote $ZIP"
