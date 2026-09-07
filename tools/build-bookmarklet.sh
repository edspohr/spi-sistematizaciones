#!/usr/bin/env bash
# Produce tools/mapper.bookmarklet.txt from tools/mapper.js.
#
# The DevTools Snippet is the primary re-injection path. The bookmarklet is a
# fallback that may be blocked by CSP on enterprise Odoo deployments.
#
# This script does a *conservative* minification only — strip block/line
# comments and collapse whitespace. We do not rename identifiers, so the
# result stays debuggable if something goes wrong on the day.

set -euo pipefail
cd "$(dirname "$0")"

IN="mapper.js"
OUT="mapper.bookmarklet.txt"

# 1) Strip /* ... */ block comments (multi-line safe via awk state machine)
# 2) Strip // line comments (but not inside strings — approximate; our source
#    doesn't use // inside string literals except in URL-like text, which is
#    fine because we then URL-encode the whole thing)
# 3) Collapse runs of whitespace outside strings — again approximate; we only
#    collapse runs of spaces/tabs and newlines to single spaces.

python3 - "$IN" "$OUT" <<'PY'
import re, sys, urllib.parse
src = open(sys.argv[1], 'r', encoding='utf-8').read()

# Remove block comments
src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
# Remove line comments (naive but adequate for our source)
src = re.sub(r'(^|[\s;{}()\[\],=+])//[^\n]*', r'\1', src)
# Collapse whitespace
src = re.sub(r'[ \t]+', ' ', src)
src = re.sub(r'\s*\n\s*', '\n', src)
src = re.sub(r'\n+', '\n', src).strip()
# Bookmarklet body wraps in an IIFE already; URL-encode
encoded = urllib.parse.quote(src, safe='')
out = 'javascript:' + encoded
open(sys.argv[2], 'w', encoding='utf-8').write(out)
print(f'wrote {sys.argv[2]}: {len(out)} bytes')
PY
