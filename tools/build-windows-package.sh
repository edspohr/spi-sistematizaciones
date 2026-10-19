#!/usr/bin/env bash
# Assemble the Windows hand-off package for Laura: embeddable Python + wheels + app + docs -> dist/InvimagilBase-<date>.zip
# Runs on macOS/Linux; nothing is compiled. Requires: python3, curl, unzip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYVER="3.12.10"
EMBED_URL="https://www.python.org/ftp/python/${PYVER}/python-${PYVER}-embed-amd64.zip"
CACHE="${BUILD_CACHE:-$ROOT/dist/.cache}"
DATE="$(date +%Y%m%d)"
NAME="InvimagilBase"
ZIPNAME="InvimagilBase-${DATE}"
OUT="$ROOT/dist/$NAME"

mkdir -p "$CACHE/wheels"
[ -f "$CACHE/python-embed.zip" ] || curl -sSL -o "$CACHE/python-embed.zip" "$EMBED_URL"
if [ -z "$(ls -A "$CACHE/wheels" 2>/dev/null)" ]; then
  python3 -m pip download -q --dest "$CACHE/wheels" --platform win_amd64 --python-version 3.12 \
    --only-binary=:all: anthropic openpyxl pymupdf python-docx
fi

rm -rf "$OUT"
mkdir -p "$OUT/python/Lib/site-packages" "$OUT/app"
unzip -q "$CACHE/python-embed.zip" -d "$OUT/python"
# Let the embedded interpreter see site-packages (the embeddable build ignores site by default).
cat > "$OUT/python/python312._pth" <<'PTH'
python312.zip
.
Lib\site-packages
PTH
# The anthropic SDK has file names >100 chars; extracted under a user path they can exceed
# Windows MAX_PATH and Explorer drops them silently. Keep that package inside a zip (zipimport);
# everything else (binary wheels included) is extracted normally.
for whl in "$CACHE"/wheels/*.whl; do
  case "$(basename "$whl")" in
    anthropic-*) mkdir -p "$CACHE/anth" && rm -rf "$CACHE/anth"/* && unzip -qo "$whl" -d "$CACHE/anth" \
                 && ( cd "$CACHE/anth" && rm -f ../anthropic.zip && zip -qr ../anthropic.zip . -x "*/RECORD" ) \
                 && cp "$CACHE/anthropic.zip" "$OUT/python/Lib/anthropic.zip" ;;
    *) unzip -qo "$whl" -d "$OUT/python/Lib/site-packages" ;;
  esac
done
rm -rf "$OUT/python/Lib/site-packages"/*.dist-info/RECORD
echo "Lib\\anthropic.zip" >> "$OUT/python/python312._pth"

cp -R "$ROOT/extractor/invimagil_base" "$OUT/app/"
cp -R "$ROOT/extractor/recursos" "$OUT/app/"
cp "$ROOT/extractor/generar_base.py" "$OUT/app/"
find "$OUT/app" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
cp "$ROOT/extractor/windows/"*.bat "$OUT/"
echo "InvimagilBase $DATE" > "$OUT/VERSION.txt"
cp "$ROOT/docs/LEEME-INVIMAGIL-BASE.txt" "$OUT/LEEME.txt"
cp "$ROOT/docs/INSTRUCCIONES-LAURA-BASE.md" "$OUT/"

# Windows line endings for the .bat and txt files
for f in "$OUT"/*.bat "$OUT"/LEEME.txt; do perl -pi -e 's/\r?\n/\r\n/' "$f"; done

LONGEST=$(cd "$OUT/.." && find "$NAME" -type f | awk '{ print length }' | sort -rn | head -1)
echo "Ruta más larga dentro del paquete: $LONGEST caracteres (límite práctico ~200 con la carpeta del usuario)"
( cd "$ROOT/dist" && rm -f "$ZIPNAME.zip" && zip -qr "$ZIPNAME.zip" "$NAME" -x "*.DS_Store" )
echo "Paquete: $ROOT/dist/$ZIPNAME.zip  ($(du -sh "$ROOT/dist/$ZIPNAME.zip" | cut -f1))"
