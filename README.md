# Cursor Chat Colors

Give every Cursor Agent chat a stable color — sidebar rows, chat pane, and top tabs.

This is a **hack**: it injects CSS/JS into Cursor’s `workbench.html`. It can break after Cursor updates. Use at your own risk.

## Install (macOS)

```bash
git clone https://github.com/TheoDepr/cursor-chat-colors.git
cd cursor-chat-colors
chmod +x enable-chat-colors.sh
./enable-chat-colors.sh
```

Then **fully quit Cursor (`Cmd+Q`)** and reopen.

The script also symlinks the files into `~/.config/cursor/` for convenience.

## After editing colors / CSS / JS

```bash
./enable-chat-colors.sh
```

Then `Cmd+Q` and reopen Cursor. Reload Window is not enough.

## Manual colors

Edit `chat-colors.js`:

```js
const OVERRIDES = {
  "My chat title": "#e85d04",
};
```

Colors are sticky per composer id (stored in `localStorage`) so auto-renames don’t reshuffle them.

## Disable

1. Restore `workbench.html` from a `workbench.*.bak-custom-css` backup in:
   `/Applications/Cursor.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/`
2. Restore checksums from:
   `/Applications/Cursor.app/Contents/Resources/app/product.json.bak-chat-colors`
3. Or reinstall Cursor.

## How it works

Cursor doesn’t expose a theming API for Agent chats. This tool inlines `chat-colors.css` + `chat-colors.js` into the workbench HTML (same approach as Custom CSS and JS Loader) and updates `product.json` checksums so Cursor doesn’t complain.
