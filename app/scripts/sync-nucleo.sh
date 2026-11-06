#!/usr/bin/env bash
# Copy the extractor core (schema, catalog, prompts, Excel writer) into the functions source.
# Firebase deploys only app/functions, so the shared code must live inside it. Runs as predeploy
# and before the emulators; the copy is gitignored and always regenerated from extractor/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/app/functions/nucleo"
rm -rf "$DEST"
mkdir -p "$DEST/invimagil_base" "$DEST/recursos"
for f in __init__.py catalogos.py esquema.py excel.py prompts.py documentos.py; do
  cp "$ROOT/extractor/invimagil_base/$f" "$DEST/invimagil_base/$f"
done
cp "$ROOT/extractor/recursos/prompt_fase_a.md" \
   "$ROOT/extractor/recursos/criterios_spi.json" \
   "$ROOT/extractor/recursos/invimagil-catalogos.txt" "$DEST/recursos/"
echo "nucleo sincronizado en $DEST"
