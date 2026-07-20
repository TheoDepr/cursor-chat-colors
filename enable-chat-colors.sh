#!/usr/bin/env bash
# Inject chat-colors CSS/JS into Cursor's workbench.html and fix checksums.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/Cursor.app/Contents/Resources/app"
HTML="$APP/out/vs/code/electron-sandbox/workbench/workbench.html"
CSS="$ROOT/chat-colors.css"
JS="$ROOT/chat-colors.js"
PRODUCT="$APP/product.json"

# Optional statusbar indicator from Custom CSS extension (if installed)
STATUSBAR="$HOME/.cursor/extensions/be5invis.vscode-custom-css-7.4.0/src/statusbar.js"
if [[ ! -f "$STATUSBAR" ]]; then
  STATUSBAR=""
fi

if [[ ! -f "$HTML" ]]; then
  echo "Cursor workbench.html not found at: $HTML" >&2
  exit 1
fi
if [[ ! -f "$CSS" || ! -f "$JS" ]]; then
  echo "Missing chat-colors.css or chat-colors.js next to this script." >&2
  exit 1
fi

python3 - "$HTML" "$CSS" "$JS" "$STATUSBAR" "$PRODUCT" "$APP" <<'PY'
import sys, uuid, re, json, hashlib, base64, pathlib, shutil

html_path = pathlib.Path(sys.argv[1])
css_path = pathlib.Path(sys.argv[2])
js_path = pathlib.Path(sys.argv[3])
statusbar_path = pathlib.Path(sys.argv[4]) if sys.argv[4] else None
product_path = pathlib.Path(sys.argv[5])
app = pathlib.Path(sys.argv[6])

html = html_path.read_text()
html = re.sub(r"<!-- !! VSCODE-CUSTOM-CSS-START !! -->[\s\S]*?<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n*", "", html)
html = re.sub(r"<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID [\w-]+ !! -->\n*", "", html)

backups = sorted(html_path.parent.glob("workbench.*.bak-custom-css"))
if backups:
    for b in reversed(backups):
        raw = b.read_text()
        if "VSCODE-CUSTOM-CSS" not in raw and "Content-Security-Policy" in raw:
            html = raw
            break

session = str(uuid.uuid4())
backup = html_path.with_name(f"workbench.{session}.bak-custom-css")
clean = html
clean = re.sub(r"<!-- !! VSCODE-CUSTOM-CSS-START !! -->[\s\S]*?<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n*", "", clean)
clean = re.sub(r"<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID [\w-]+ !! -->\n*", "", clean)
backup.write_text(clean)

html = clean
html = re.sub(r'<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?/>', "", html)

css = css_path.read_text()
js = js_path.read_text()
indicator = ""
if statusbar_path and statusbar_path.exists():
    indicator = statusbar_path.read_text()

inject = (
    f"<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID {session} !! -->\n"
    "<!-- !! VSCODE-CUSTOM-CSS-START !! -->\n"
    + (f"<script>{indicator}</script>\n" if indicator else "")
    + f"<style>{css}</style>\n"
    + f"<script>{js}</script>\n"
    + "<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n"
)
html = html.replace("</html>", inject + "</html>")
html_path.write_text(html)

product_bak = product_path.with_suffix(".json.bak-chat-colors")
if not product_bak.exists():
    shutil.copy2(product_path, product_bak)
product = json.loads(product_path.read_text())
key = "vs/code/electron-sandbox/workbench/workbench.html"
new = base64.b64encode(hashlib.sha256(html_path.read_bytes()).digest()).decode().rstrip("=")
product.setdefault("checksums", {})[key] = new
product_path.write_text(json.dumps(product, indent="\t") + "\n")
print("OK: patched workbench.html")
print("session:", session)
print("checksum:", new)
print("Fully quit Cursor (Cmd+Q) and reopen.")
PY

# Keep a convenience copy/symlink in ~/.config/cursor for local edits
mkdir -p "$HOME/.config/cursor"
ln -sfn "$ROOT/chat-colors.css" "$HOME/.config/cursor/chat-colors.css"
ln -sfn "$ROOT/chat-colors.js" "$HOME/.config/cursor/chat-colors.js"
ln -sfn "$ROOT/enable-chat-colors.sh" "$HOME/.config/cursor/enable-chat-colors.sh"
echo "Linked into ~/.config/cursor/"
