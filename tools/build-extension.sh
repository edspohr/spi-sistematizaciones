#!/usr/bin/env bash
# Package the InvimÁgil Inyector extension for Chrome / Edge (unlisted store upload or "Load unpacked").
# Strips the localhost entries used for local tests (mock page and the web app dev server).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(python3 -c "import json;print(json.load(open('$ROOT/extension/manifest.json'))['version'])")
OUT="$ROOT/dist/InvimagilInyector-$VERSION"
rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT"
cp -R "$ROOT/extension/"{manifest.json,background.js,mapa-formulario.json,content,main,panel} "$OUT/"
cp "$ROOT/docs/GUIA-INYECTOR.md" "$OUT/LEEME.md"
python3 - "$OUT/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p, encoding="utf-8"))
dev = lambda u: u.startswith("http://localhost") or u.startswith("http://127.0.0.1")
for cs in m["content_scripts"]:
    cs["matches"] = [u for u in cs["matches"] if not dev(u)]
for w in m.get("web_accessible_resources", []):
    w["matches"] = [u for u in w["matches"] if not dev(u)]
json.dump(m, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
(cd "$OUT" && zip -qr "$OUT.zip" .)
echo "Extensión lista: $OUT (carpeta para «Cargar descomprimida») y $OUT.zip (para la tienda)"
