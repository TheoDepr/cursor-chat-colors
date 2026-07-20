# Cursor Chat Colors

Give every Cursor Agent chat its own color so you can switch tabs by color at a glance — sidebar, top tabs, and a left accent line on the conversation stay in sync.

This is a **hack**: it injects CSS/JS into Cursor’s `workbench.html`. It can break after Cursor updates. Use at your own risk.

## Install (macOS)

```bash
git clone https://github.com/TheoDepr/cursor-chat-colors.git
cd cursor-chat-colors
chmod +x cursor-chat-colors
./cursor-chat-colors on
```

Then **fully quit Cursor (`Cmd+Q`)** and reopen.

Optional — put it on your PATH:

```bash
ln -sfn "$(pwd)/cursor-chat-colors" /usr/local/bin/cursor-chat-colors
```

## Usage

```bash
cursor-chat-colors on         # enable
cursor-chat-colors off        # disable
cursor-chat-colors status      # is it on?
cursor-chat-colors reinstall  # after editing css/js
```

Aliases: `enable`/`disable`/`reload`.

After `on` / `off` / `reinstall`: **Cmd+Q** and reopen. Reload Window is not enough.

## How colors work

- **New chat** → random dark tint (a little hue, not gray; avoids hues already on open/recent chats)
- **Same chat forever** → locked to that composer id in `localStorage`
- **Tab + left conversation line** → always the same color, including after renames

That’s the whole point: scan the tab bar by color, not by title.

## Manual color overrides

Edit `chat-colors.js`:

```js
const OVERRIDES = {
  "My chat title": "#36ADA3",
};
```

Then:

```bash
./cursor-chat-colors reinstall
```

## After a Cursor update

If colors disappear or Cursor complains about a corrupt installation:

```bash
./cursor-chat-colors on
```

## How it works

Cursor doesn’t expose a theming API for Agent chats. This tool inlines `chat-colors.css` + `chat-colors.js` into the workbench HTML (same approach as Custom CSS and JS Loader) and updates `product.json` checksums so Cursor doesn’t complain.
