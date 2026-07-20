/**
 * Cursor per-chat colors — glanceable tab switching
 *
 * New chat → random color. Locked to composer id forever.
 * Top tabs + left sidebar always resolve through the same title→color map.
 * Title bindings are never stolen when selection lags behind a tab switch.
 */
(function () {
  if (window.__cursorChatColorsInstalled) return;
  window.__cursorChatColorsInstalled = true;

  const OVERRIDES = {
    // "My chat title": "#36ADA3",
  };

  // Fresh store — do not migrate old fixed-palette assignments
  const STORE_KEY = "cursor-chat-colors-v8";
  const LEGACY_KEYS = [];
  const RECENT_MAX = 4;

  // New chats share these titles until renamed — never sticky-bind color by them
  const PLACEHOLDER_TITLE_RE = /^(new chat|new agent|untitled|agent|chat)$/i;

  // Sidebar chrome rows (same .agent-sidebar-cell DOM as chats) — never color
  const CHROME_TITLE_RE = /^(new agent|customize|automations|find with agent)$/i;

  /** @type {{ byId: Record<string,string>, titleToId: Record<string,string>, byTitle: Record<string,string>, recent: string[] }} */
  let store = loadStore();
  let saveTimer = null;

  const sticky = new WeakMap();
  const titleColorCache = new Map();
  const idColorCache = new Map();

  let lastPaneId = null;
  let lastPaneColor = null;
  let applyTimer = null;
  let applyRaf = 0;
  let pendingFull = false;

  function loadStore() {
    try {
      for (const key of [STORE_KEY, ...LEGACY_KEYS]) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        return {
          byId: parsed.byId || {},
          // Drop titleToId from older versions — those bindings were often corrupted
          // by tab/sidebar selection races. Rebuild safely from trusted pairs only.
          titleToId: key === STORE_KEY ? parsed.titleToId || {} : {},
          byTitle: parsed.byTitle || {},
          recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        };
      }
    } catch {
      /* ignore */
    }
    return { byId: {}, titleToId: {}, byTitle: {}, recent: [] };
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch {
        /* quota / private mode */
      }
    }, 200);
  }

  function usedColors() {
    const used = new Set();
    if (lastPaneColor) used.add(lastPaneColor);
    try {
      collectTopChatTabs().forEach((tab) => {
        const c = tab.style.getPropertyValue("--chat-accent") || sticky.get(tab);
        if (c) used.add(c);
      });
    } catch {
      /* collectTopChatTabs may run before definition during load — ignore */
    }
    return used;
  }

  /** Dark accent with a little hue — not gray, not neon. */
  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function hexToHsl(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d >= 1e-6) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  function hexToHue(hex) {
    const hsl = hexToHsl(hex);
    return hsl ? hsl.h : null;
  }

  /** Same hue as the chat accent, lifted for glanceable tabs + left sidebar. */
  function brightenForTab(color) {
    const hsl = hexToHsl(color);
    if (!hsl) return color;
    const s = Math.min(64, Math.max(34, hsl.s + 16));
    const l = Math.max(44, Math.min(58, hsl.l + 30));
    return hslToHex(hsl.h, s, l);
  }

  function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function minHueDistance(h, colors) {
    let min = 180;
    for (const c of colors) {
      const other = hexToHue(c);
      if (other == null) continue;
      min = Math.min(min, hueDistance(h, other));
    }
    return min;
  }

  function pickRandomColor() {
    const avoid = [...usedColors(), ...(store.recent || [])];
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 14; i++) {
      const h = Math.floor(Math.random() * 360);
      const s = 26 + Math.floor(Math.random() * 20); // 26–45% — a little color
      const l = 16 + Math.floor(Math.random() * 14); // 16–29% — dark by default
      const color = hslToHex(h, s, l);
      const score = avoid.length ? minHueDistance(h, avoid) : 180;
      if (score > bestScore) {
        bestScore = score;
        best = color;
      }
      if (score >= 48) break;
    }
    return best;
  }

  function rememberRecent(color) {
    if (!color) return;
    store.recent = [color, ...(store.recent || []).filter((c) => c !== color)].slice(0, RECENT_MAX);
  }

  function isPlaceholderTitle(title) {
    const t = normalizeTitle(title);
    return !t || PLACEHOLDER_TITLE_RE.test(t);
  }

  function isChromeTitle(title) {
    return CHROME_TITLE_RE.test(normalizeTitle(title));
  }

  /** Header actions (New Agent / Customize / …) share .agent-sidebar-cell with history. */
  function isSidebarChromeCell(cell) {
    if (!(cell instanceof Element)) return false;
    if (cell.closest(".agent-sidebar-header, .agent-sidebar-header-actions")) return true;
    // History chats always have a caption node; header actions only use .agent-sidebar-cell-text
    if (cell.querySelector(".agent-sidebar-cell-caption")) return false;
    const label = textOf(cell.querySelector(".agent-sidebar-cell-text"));
    return isChromeTitle(label);
  }

  function clearPaint(el) {
    if (!el) return;
    sticky.delete(el);
    el.style.removeProperty("--chat-accent");
    delete el.dataset.chatColored;
    delete el.dataset.chatTabActive;
    delete el.dataset.chatActiveMatched;
  }

  function normalizeTitle(title) {
    return String(title || "")
      .replace(/\s+/g, " ")
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*[·•].*$/, "")
      .replace(/\s*[+-]\d+(\s+[+-]\d+)?\s*$/, "")
      .replace(/[…]+$/g, "")
      .replace(/\.{2,}$/g, "")
      .trim();
  }

  function titlesMatch(a, b) {
    const x = normalizeTitle(a);
    const y = normalizeTitle(b);
    if (!x || !y) return false;
    if (isPlaceholderTitle(x) || isPlaceholderTitle(y)) return x === y;
    if (x === y) return true;
    const short = x.length <= y.length ? x : y;
    const long = x.length <= y.length ? y : x;
    // Avoid "New Chat…" / short-prefix collisions
    if (short.length < 12) return false;
    return long.startsWith(short);
  }

  function textOf(el) {
    if (!el) return "";
    if (el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      return normalizeTitle(el.childNodes[0].nodeValue);
    }
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll(
        ".agent-tab-timestamp, .agent-tab-timestamp-right, .agent-sidebar-cell-subtitle, .agent-sidebar-cell-trailing, .agent-sidebar-cell-actions, .compact-agent-history-react-menu-actions"
      )
      .forEach((n) => n.remove());
    return normalizeTitle(clone.textContent);
  }

  /** Editor groups for split chat panes (each has its own active tab). */
  function editorGroups() {
    const groups = [...document.querySelectorAll(".editor-group-container")];
    if (groups.length) return groups;
    // Agent tiling fallback when Monaco groups aren't present
    const tiles = [
      ...document.querySelectorAll(
        ".glass-agent-conversation-tiling__tile, .agent-panel .glass-agent-conversation-tiling .ui-tiling-panel"
      ),
    ];
    return tiles;
  }

  function focusedEditorGroup() {
    const groups = editorGroups();
    if (!groups.length) return null;
    return (
      groups.find((g) => g.classList.contains("active")) ||
      groups.find((g) => g.classList.contains("focused")) ||
      groups[0]
    );
  }

  function activeTabIn(group) {
    if (!group) return null;
    return (
      group.querySelector(".tabs-container > .tab.active") ||
      group.querySelector(".tab.active") ||
      group.querySelector('[role="tab"][aria-selected="true"]')
    );
  }

  function composerIdIn(group) {
    if (!group) return activeComposerIdGlobal();
    const el =
      group.querySelector(".composer-bar.editor[data-composer-id]") ||
      group.querySelector(".composer-bar[data-composer-id]") ||
      group.querySelector("[data-composer-id]");
    return el ? el.getAttribute("data-composer-id") : null;
  }

  function activeComposerIdGlobal() {
    const el =
      document.querySelector(".composer-bar.editor[data-composer-id]") ||
      document.querySelector(".composer-bar[data-composer-id]") ||
      document.querySelector("[data-composer-id]");
    return el ? el.getAttribute("data-composer-id") : null;
  }

  function activeComposerId() {
    const focused = focusedEditorGroup();
    return composerIdIn(focused) || activeComposerIdGlobal();
  }

  function titleFromTopTab(tab) {
    if (!tab) return null;
    const label = tab.querySelector(".tab-label, .composer-tab-label");
    const candidates = [
      label && label.getAttribute("title"),
      textOf(tab.querySelector(".label-name")),
      textOf(tab.querySelector(".monaco-icon-name-container")),
      textOf(label),
      tab.getAttribute("title"),
      // aria-label last — often includes extra UI chrome
      label && label.getAttribute("aria-label"),
      tab.getAttribute("aria-label"),
    ];
    for (const c of candidates) {
      const t = normalizeTitle(c);
      if (t && t.length > 1) return t;
    }
    return null;
  }

  function getActiveTabTitle() {
    const focused = focusedEditorGroup();
    const tab = activeTabIn(focused) || document.querySelector(".tabs-container > .tab.active");
    return tab ? titleFromTopTab(tab) : null;
  }

  function isFocusedActiveTab(tab) {
    if (!tab) return false;
    const isActive =
      tab.classList.contains("active") || tab.getAttribute("aria-selected") === "true";
    if (!isActive) return false;
    const focused = focusedEditorGroup();
    if (!focused) return true;
    // Split editor: only the focused group's active tab
    if (tab.closest(".editor-group-container")) {
      return focused.contains(tab) && activeTabIn(focused) === tab;
    }
    // Agent/sidebar tabs live outside editor groups — still follow focused chat
    return true;
  }

  function getSelectedSidebarTitle() {
    const selected = document.querySelector('.agent-sidebar-cell[data-selected="true"]');
    if (selected && !isSidebarChromeCell(selected)) {
      const title =
        textOf(selected.querySelector(".agent-sidebar-cell-caption")) ||
        textOf(selected.querySelector(".agent-sidebar-cell-text"));
      if (title && !isChromeTitle(title)) return title;
    }
    const compact = document.querySelector(
      '.compact-agent-history-react-menu-label[data-selected="true"]'
    );
    const compactTitle = textOf(compact);
    if (compactTitle && !isChromeTitle(compactTitle)) return compactTitle;
    return null;
  }

  /** Read-only color lookup. Never creates bindings. */
  function lookupColor({ id, title }) {
    const t = normalizeTitle(title);

    if (id && idColorCache.has(id)) return idColorCache.get(id);
    if (id && store.byId[id]) {
      const c = store.byId[id];
      idColorCache.set(id, c);
      return c;
    }

    // Placeholder titles ("New Chat") are shared by every fresh chat — never
    // resolve color from them or every new chat inherits the same color.
    if (!t || isPlaceholderTitle(t)) return null;

    if (t) {
      const mappedId = store.titleToId[t];
      if (mappedId && store.byId[mappedId]) {
        const c = store.byId[mappedId];
        idColorCache.set(mappedId, c);
        titleColorCache.set(t, c);
        return c;
      }
      for (const [key, mapped] of Object.entries(store.titleToId)) {
        if (titlesMatch(t, key) && store.byId[mapped]) {
          const c = store.byId[mapped];
          idColorCache.set(mapped, c);
          titleColorCache.set(t, c);
          return c;
        }
      }

      if (titleColorCache.has(t)) return titleColorCache.get(t);
      if (store.byTitle[t]) return store.byTitle[t];
      for (const [key, color] of titleColorCache) {
        if (titlesMatch(t, key)) return color;
      }
      for (const [key, color] of Object.entries(store.byTitle)) {
        if (titlesMatch(t, key)) return color;
      }
      if (OVERRIDES[t]) return OVERRIDES[t];
      for (const [key, color] of Object.entries(OVERRIDES)) {
        if (titlesMatch(t, key)) return color;
      }
    }

    return null;
  }

  /**
   * Bind title → id only if the title is not already owned by a different chat.
   * This prevents tab-switch races from remapping the wrong sidebar row.
   */
  function bindTitleSafe(t, id, color) {
    if (!t || !id || !color) return false;
    t = normalizeTitle(t);
    if (isPlaceholderTitle(t)) return false;

    const existing = store.titleToId[t];
    if (existing && existing !== id) return false;

    for (const [key, mapped] of Object.entries(store.titleToId)) {
      if (mapped !== id && titlesMatch(t, key)) return false;
    }

    let dirty = false;
    if (store.titleToId[t] !== id) {
      store.titleToId[t] = id;
      dirty = true;
    }
    store.byId[id] = color;
    idColorCache.set(id, color);
    titleColorCache.set(t, color);
    if (store.byTitle[t]) {
      delete store.byTitle[t];
      dirty = true;
    }
    if (dirty) scheduleSave();
    return true;
  }

  function assignIdColor(id, color) {
    if (!id || !color) return;
    if (store.byId[id] && store.byId[id] !== color) {
      // Never reshuffle an existing chat color
      return store.byId[id];
    }
    store.byId[id] = color;
    idColorCache.set(id, color);
    scheduleSave();
    return color;
  }

  function assignTitleColor(t, color) {
    t = normalizeTitle(t);
    if (!t || !color || isPlaceholderTitle(t)) return;
    if (store.byTitle[t] && store.byTitle[t] !== color) return store.byTitle[t];
    // Prefer id mapping if title already owned
    const mapped = store.titleToId[t];
    if (mapped && store.byId[mapped]) return store.byId[mapped];

    store.byTitle[t] = color;
    titleColorCache.set(t, color);
    scheduleSave();
    return color;
  }

  /** Lookup or create a sticky color. Does not bind title↔id (use claimPair for that). */
  function colorForChat({ id, title }) {
    const existing = lookupColor({ id, title });
    if (existing) {
      if (id) assignIdColor(id, existing);
      return existing;
    }

    const t = normalizeTitle(title);
    // Need an id, or a real (non-placeholder) title, to lock a color
    if (!id && (!t || isPlaceholderTitle(t))) return null;

    const color = pickRandomColor();
    rememberRecent(color);
    if (id) assignIdColor(id, color);
    else assignTitleColor(t, color);
    return color;
  }

  /**
   * Force title caches to follow an id's color so sidebar/tab lookups
   * cannot drift onto an orphan byTitle hue.
   */
  function reconcileTitleToIdColor(t, id, color) {
    t = normalizeTitle(t);
    if (!t || !color || isPlaceholderTitle(t)) return;
    titleColorCache.set(t, color);
    idColorCache.set(id, color);
    if (store.byTitle[t]) {
      delete store.byTitle[t];
      scheduleSave();
    }
    bindTitleSafe(t, id, color);
    // If title is owned by a different id, still keep session cache aligned
    // so inactive tabs/rows with this title paint the active chat's color
    // only when titlesMatch — caches alone don't rebind titleToId.
  }

  /**
   * Trusted claim: this title and composer id definitely belong together
   * (selected sidebar row, or active editor tab).
   * Composer id is the source of truth — title never overrides it.
   */
  function claimPair(id, title) {
    if (!id) return colorForChat({ title });
    const t = normalizeTitle(title);
    // Id wins. Never let a stale byTitle hue (teal) override byId (purple).
    let color = lookupColor({ id });
    if (!color && t && !isPlaceholderTitle(t)) color = lookupColor({ title: t });
    if (!color) {
      color = pickRandomColor();
      rememberRecent(color);
    }
    color = assignIdColor(id, color) || store.byId[id] || color;
    if (t && !isPlaceholderTitle(t)) reconcileTitleToIdColor(t, id, color);
    return color;
  }

  /** Wash for dark accents — lift toward white first so it reads on dark Cursor UI. */
  function tint(color, amount) {
    if (!color) return "transparent";
    return `color-mix(in srgb, color-mix(in srgb, ${color} 58%, white) ${amount}%, transparent)`;
  }

  function paintEl(el, color) {
    if (!el || !color) return;
    const bright = brightenForTab(color);
    if (sticky.get(el) === color && el.style.getPropertyValue("--chat-accent") === bright) return;
    sticky.set(el, color);
    el.style.setProperty("--chat-accent", bright);
    el.dataset.chatColored = "true";
  }

  function paintTopTab(tab, color) {
    if (!tab || !color) return;
    const active = tab.classList.contains("active");
    // Top tabs use a brighter sibling of the chat hue; pane/sidebar keep the dark accent
    const bright = brightenForTab(color);
    const soft = `color-mix(in srgb, ${bright} 40%, transparent)`;
    const strong = `color-mix(in srgb, ${bright} 62%, transparent)`;
    const bg = active ? strong : soft;
    if (
      sticky.get(tab) === color &&
      tab.dataset.chatTabActive === String(active) &&
      tab.style.getPropertyValue("--chat-accent") === bright
    ) {
      return;
    }

    sticky.set(tab, color);
    tab.dataset.chatColored = "true";
    tab.dataset.chatTabActive = String(active);
    tab.dataset.chatActiveMatched = active ? "1" : "0";
    tab.style.setProperty("--chat-accent", bright);
    tab.style.setProperty("--vscode-tab-activeBackground", strong);
    tab.style.setProperty("--vscode-tab-inactiveBackground", soft);
    tab.style.setProperty("--vscode-tab-selectedBackground", strong);
    tab.style.setProperty("--vscode-tab-unfocusedActiveBackground", strong);
    tab.style.setProperty("--vscode-tab-unfocusedInactiveBackground", soft);
    tab.style.setProperty("--vscode-tab-unfocusedSelectedBackground", soft);
    tab.style.setProperty("background-color", bg, "important");
    tab.style.setProperty("background", bg, "important");
    tab.style.setProperty("box-shadow", `inset 0 -2px 0 ${bright}`, "important");
  }

  function collectTopChatTabs() {
    const tabs = new Set();

    document
      .querySelectorAll(
        ".tabs-container > .tab .composer-tab-label, .tabs-container > .tab .tab-label.composer-tab-label"
      )
      .forEach((label) => {
        const tab = label.closest(".tab");
        if (tab) tabs.add(tab);
      });

    document.querySelectorAll(".tabs-container > .tab").forEach((tab) => {
      if (tabs.has(tab)) return;
      const resource = tab.getAttribute("data-resource-name") || "";
      const label = tab.querySelector(".tab-label");
      const hasComposerClass =
        label &&
        (label.classList.contains("composer-tab-label") ||
          label.className.includes("composer"));
      const looksLikeChat =
        hasComposerClass ||
        /composer|chat|aichat|agent/i.test(resource) ||
        (!resource && !!titleFromTopTab(tab));
      if (/\.[a-z0-9]{1,8}$/i.test(resource)) return;
      if (looksLikeChat || (!resource && titleFromTopTab(tab))) tabs.add(tab);
    });

    return tabs;
  }

  /**
   * Build one title→color map from open tabs + sidebar, then paint both from it.
   * This is what keeps top tabs and left rows matching.
   */
  function syncTabsAndSidebar() {
    const activeId = activeComposerId();
    const activeTabTitle = getActiveTabTitle();
    const selectedSidebarTitle = getSelectedSidebarTitle();

    // Trusted pairs only — never bind a stale sidebar title to a new composer id
    if (activeId && activeTabTitle) {
      lastPaneColor = claimPair(activeId, activeTabTitle);
      lastPaneId = activeId;
    } else if (activeId && selectedSidebarTitle) {
      // Only if sidebar title agrees with active tab (or no tab title yet)
      lastPaneColor = claimPair(activeId, selectedSidebarTitle);
      lastPaneId = activeId;
    } else if (activeId) {
      lastPaneColor = colorForChat({ id: activeId });
      lastPaneId = activeId;
    }

    /** @type {Map<string, string>} */
    const colorByTitle = new Map();

    function remember(title, color) {
      const t = normalizeTitle(title);
      if (!t || !color || isPlaceholderTitle(t)) return;
      colorByTitle.set(t, color);
      // Also index under any existing fuzzy keys we already have
      for (const key of [...colorByTitle.keys()]) {
        if (key !== t && titlesMatch(key, t)) colorByTitle.set(key, color);
      }
    }

    function colorForTitle(title) {
      const t = normalizeTitle(title);
      if (!t || isPlaceholderTitle(t)) return null;
      // Active chat surfaces must share lastPaneColor even if caption ≠ tab label.
      if (
        lastPaneColor &&
        ((selectedSidebarTitle && titlesMatch(t, selectedSidebarTitle)) ||
          (activeTabTitle && titlesMatch(t, activeTabTitle)))
      ) {
        remember(t, lastPaneColor);
        return lastPaneColor;
      }
      if (colorByTitle.has(t)) return colorByTitle.get(t);
      for (const [key, color] of colorByTitle) {
        if (titlesMatch(t, key)) return color;
      }
      const color = colorForChat({ title: t });
      if (color) remember(t, color);
      return color;
    }

    // Seed map from active chat — selected sidebar ALWAYS follows pane color.
    // Do not require titlesMatch; extraction can differ slightly and that used
    // to leave the left row on a stale byTitle hue while the tab stayed on byId.
    if (lastPaneColor) {
      if (activeTabTitle) remember(activeTabTitle, lastPaneColor);
      if (selectedSidebarTitle) remember(selectedSidebarTitle, lastPaneColor);
      if (activeId && activeTabTitle) reconcileTitleToIdColor(activeTabTitle, activeId, lastPaneColor);
      if (activeId && selectedSidebarTitle) {
        reconcileTitleToIdColor(selectedSidebarTitle, activeId, lastPaneColor);
      }
    }

    // Seed from all open tabs (establishes colors for inactive chats)
    // Only the focused group's active tab inherits lastPaneColor — other
    // split panes keep their own chat color (fixes cross-pane bleed).
    const tabs = [...collectTopChatTabs()];
    for (const tab of tabs) {
      const title = titleFromTopTab(tab);
      if (!title) continue;
      if (isFocusedActiveTab(tab) && lastPaneColor) {
        remember(title, lastPaneColor);
      } else {
        colorForTitle(title);
      }
    }

    // Seed from sidebar rows
    document.querySelectorAll(".agent-sidebar-cell").forEach((cell) => {
      if (isSidebarChromeCell(cell)) return;
      const title = textOf(cell.querySelector(".agent-sidebar-cell-caption"));
      if (title) colorForTitle(title);
    });
    document.querySelectorAll(".compact-agent-history-react-menu-label").forEach((label) => {
      const title = textOf(label);
      if (title && !isChromeTitle(title)) colorForTitle(title);
    });

    // Paint tabs from the shared map
    for (const tab of tabs) {
      const title = titleFromTopTab(tab);
      let color = null;
      if (isFocusedActiveTab(tab) && lastPaneColor) {
        color = lastPaneColor;
      } else if (title && isPlaceholderTitle(title)) {
        // Each "New Chat" tab keeps its own sticky color — never share by title
        color = sticky.get(tab);
        if (!color) {
          color = pickRandomColor();
          rememberRecent(color);
        }
      } else if (title) {
        color = colorForTitle(title);
      } else {
        color = sticky.get(tab);
      }
      if (color) paintTopTab(tab, color);
    }

    // Paint sidebar from the SAME map.
    // Selected row = active chat → always lastPaneColor (never a title-only lookup).
    document.querySelectorAll(".agent-sidebar-cell").forEach((cell) => {
      if (isSidebarChromeCell(cell)) {
        clearPaint(cell);
        return;
      }
      const title = textOf(cell.querySelector(".agent-sidebar-cell-caption"));
      const selected = cell.getAttribute("data-selected") === "true";
      let color = null;
      if (selected && lastPaneColor) {
        color = lastPaneColor;
        if (activeId && title) reconcileTitleToIdColor(title, activeId, color);
      } else if (title && isPlaceholderTitle(title)) {
        color = sticky.get(cell);
        if (!color) {
          color = pickRandomColor();
          rememberRecent(color);
        }
      } else if (title) {
        color = colorForTitle(title);
      }
      if (color) paintEl(cell, color);
      else clearPaint(cell);
    });

    document.querySelectorAll(".compact-agent-history-react-menu-label").forEach((label) => {
      const title = textOf(label);
      if (isChromeTitle(title)) {
        clearPaint(label);
        const row = label.closest("[role='menuitem'], .ui-menu__item");
        if (row) clearPaint(row);
        return;
      }
      const selected = label.getAttribute("data-selected") === "true";
      let color = null;
      if (selected && lastPaneColor) {
        color = lastPaneColor;
        if (activeId && title) reconcileTitleToIdColor(title, activeId, color);
      } else if (title && isPlaceholderTitle(title)) {
        color = sticky.get(label);
        if (!color) {
          color = pickRandomColor();
          rememberRecent(color);
        }
      } else if (title) {
        color = colorForTitle(title);
      }
      if (!color) {
        clearPaint(label);
        return;
      }
      paintEl(label, color);
      const row = label.closest("[role='menuitem'], .ui-menu__item");
      if (row) paintEl(row, color);
    });

    document
      .querySelectorAll(
        ".agent-tab, .agent-tabs-container [role='tab'], .agent-conversation-tabs [role='tab']"
      )
      .forEach((tab) => {
        const title = textOf(tab.querySelector(".agent-tab-name-text"));
        const selected =
          tab.getAttribute("aria-selected") === "true" || tab.classList.contains("active");
        let color = null;
        // Agent-side tabs: only the focused selection follows lastPaneColor
        if (selected && lastPaneColor && isFocusedActiveTab(tab)) {
          color = lastPaneColor;
        } else if (title && isPlaceholderTitle(title)) {
          color = sticky.get(tab);
          if (!color) {
            color = pickRandomColor();
            rememberRecent(color);
          }
        } else if (title) {
          color = colorForTitle(title);
        } else {
          color = sticky.get(tab);
        }
        if (color) paintEl(tab, color);
      });
  }

  const PANE_CLEAN_SELECTORS = [
    ".composer-bar.editor",
    ".composer-messages-container",
    ".composer-pane-controls-feedback",
    ".glass-agent-conversation-tiling__tile",
    ".glass-agent-conversation-tiling",
    ".glass-agent-conversation-tiling .ui-tiling-panel",
    ".agent-panel",
    ".agent-panel-followup-input",
    ".agent-panel-followup-input--conversation-overlay",
  ].join(",");

  const PANE_LINE_SELECTORS = [
    ".composer-bar.editor",
    ".glass-agent-conversation-tiling__tile",
    ".glass-agent-conversation-tiling",
    ".glass-agent-conversation-tiling .ui-tiling-panel",
  ].join(",");

  function clearLegacyPaneStyles(scope) {
    const root = scope || document;
    root.querySelectorAll(PANE_CLEAN_SELECTORS).forEach((el) => {
      el.style.removeProperty("--composer-pane-background");
      el.style.removeProperty("--glass-chat-surface-background");
      el.style.removeProperty("background");
      el.style.removeProperty("background-color");
      el.style.removeProperty("box-shadow");
    });
  }

  function paintPaneLine(scope, color) {
    if (!scope || !color) return;
    const lineColor = brightenForTab(color);
    // Set on the group so descendants inherit; also stamp pane surfaces directly.
    scope.style.setProperty("--chat-pane-line", lineColor);
    scope.dataset.chatPaneColored = "true";

    const targets = [];
    if (scope.matches && scope.matches(PANE_LINE_SELECTORS)) targets.push(scope);
    scope.querySelectorAll(PANE_LINE_SELECTORS).forEach((el) => targets.push(el));
    targets.forEach((el) => {
      el.style.setProperty("--chat-pane-line", lineColor);
      el.dataset.chatPaneColored = "true";
    });
  }

  /** Resolve color for a non-focused split pane without stealing title bindings. */
  function colorForSplitPane({ id, title, tab }) {
    if (tab && sticky.get(tab)) return sticky.get(tab);
    const existing = lookupColor({ id, title });
    if (existing) {
      if (id) assignIdColor(id, existing);
      return existing;
    }
    if (id) return colorForChat({ id });
    if (title && !isPlaceholderTitle(title)) return colorForChat({ title });
    if (tab) {
      let color = sticky.get(tab);
      if (!color) {
        color = pickRandomColor();
        rememberRecent(color);
        sticky.set(tab, color);
      }
      return color;
    }
    return null;
  }

  function colorActivePane() {
    const groups = editorGroups();
    const focused = focusedEditorGroup();
    const sidebarTitle = getSelectedSidebarTitle();

    clearLegacyPaneStyles(document);
    document.querySelectorAll("[data-chat-pane-colored]").forEach((el) => {
      el.style.removeProperty("--chat-pane-line");
      delete el.dataset.chatPaneColored;
    });

    const id = activeComposerId();
    const tabTitle = getActiveTabTitle();

    let color = null;
    if (id && tabTitle) color = claimPair(id, tabTitle);
    else if (id && sidebarTitle && tabTitle && titlesMatch(sidebarTitle, tabTitle)) {
      color = claimPair(id, sidebarTitle);
    } else if (id) color = colorForChat({ id });
    else if (tabTitle) color = colorForChat({ title: tabTitle });

    lastPaneColor = color;
    lastPaneId = id;

    const root = document.documentElement;
    if (color) {
      root.style.setProperty("--chat-active-accent", color);
      // Single pane: global line is fine. Split: each group sets --chat-pane-line.
      if (groups.length <= 1) {
        root.style.setProperty("--chat-active-line", brightenForTab(color));
      } else {
        root.style.removeProperty("--chat-active-line");
      }
    }
    root.style.removeProperty("--chat-active-tint");
    root.style.removeProperty("--glass-chat-surface-background");

    // Warm sticky on non-focused active tabs before sync paints them
    if (groups.length > 1 && focused) {
      for (const group of groups) {
        if (group === focused) continue;
        const tab = activeTabIn(group);
        if (!tab || sticky.get(tab)) continue;
        const gid = composerIdIn(group);
        const title = titleFromTopTab(tab);
        colorForSplitPane({ id: gid, title, tab });
      }
    }

    return color;
  }

  function applyFull() {
    try {
      // Resolve focused chat first, paint tabs (sets sticky), then per-pane lines
      colorActivePane();
      syncTabsAndSidebar();
      paintAllPaneLines();
    } catch (err) {
      console.warn("[cursor-chat-colors]", err);
    }
  }

  function applyPaneOnly() {
    try {
      colorActivePane();
      syncTabsAndSidebar();
      paintAllPaneLines();
    } catch (err) {
      console.warn("[cursor-chat-colors]", err);
    }
  }

  /**
   * After tabs are painted, sync each split pane's accent line to its own
   * active tab color — never the focused pane's color.
   */
  function paintAllPaneLines() {
    const groups = editorGroups();
    if (!groups.length) {
      if (!lastPaneColor) return;
      const lineColor = brightenForTab(lastPaneColor);
      document.querySelectorAll(PANE_LINE_SELECTORS).forEach((el) => {
        el.style.setProperty("--chat-pane-line", lineColor);
        el.dataset.chatPaneColored = "true";
      });
      return;
    }

    const focused = focusedEditorGroup();
    for (const group of groups) {
      const tab = activeTabIn(group);
      let color = null;
      if (group === focused && lastPaneColor) {
        color = lastPaneColor;
      } else if (tab && sticky.get(tab)) {
        color = sticky.get(tab);
      } else {
        const id = composerIdIn(group);
        const title = titleFromTopTab(tab);
        color = colorForSplitPane({ id, title, tab });
      }
      if (color) paintPaneLine(group, color);
    }
  }

  function schedule(full) {
    if (full) pendingFull = true;
    if (applyRaf) return;
    applyRaf = requestAnimationFrame(() => {
      applyRaf = 0;
      pendingFull = false;
      applyFull();
    });
  }

  function scheduleFullSoon() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => schedule(true), 32);
  }

  function observeTargets() {
    const roots = [
      document.querySelector(".agent-sidebar"),
      document.querySelector(".agent-sidebar-list"),
      document.querySelector(".agent-tabs-container"),
      document.querySelector(".agent-conversation-tabs"),
      document.querySelector(".glass-agent-conversation-tiling"),
      document.querySelector(".monaco-workbench .part.editor"),
      ...document.querySelectorAll(".tabs-container"),
    ].filter(Boolean);

    document
      .querySelectorAll(".compact-agent-history-react-menu-label")
      .forEach((el) => {
        const root = el.closest('[role="menu"], .ui-menu, aside, nav') || el.parentElement;
        if (root) roots.push(root);
      });

    const SKIP = ".composer-messages-container, .monaco-editor, .markdown-root, .aislash-editor-input";

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "characterData") continue;
        const t = m.target;
        if (!(t instanceof Element)) {
          scheduleFullSoon();
          return;
        }
        if (
          m.type === "attributes" &&
          (m.attributeName === "data-composer-id" ||
            m.attributeName === "data-selected" ||
            m.attributeName === "aria-selected" ||
            m.attributeName === "class")
        ) {
          schedule(true);
          return;
        }
        if (t.closest(SKIP)) continue;
        scheduleFullSoon();
        return;
      }
    });

    const opts = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-selected", "data-composer-id", "aria-selected", "class"],
    };

    if (roots.length) roots.forEach((r) => obs.observe(r, opts));
    else obs.observe(document.body, opts);

    const barObs = new MutationObserver(() => schedule(true));
    const seen = new WeakSet();
    const watchBars = () => {
      document.querySelectorAll(".composer-bar, [data-composer-id]").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        barObs.observe(el, {
          attributes: true,
          attributeFilter: ["data-composer-id", "data-composer-status"],
        });
      });
    };
    watchBars();
    setInterval(watchBars, 4000);
    setInterval(() => schedule(true), 4000);
  }

  function start() {
    applyFull();
    observeTargets();
    window.addEventListener("focus", () => schedule(true));
    console.info("[cursor-chat-colors] active (tab↔sidebar sync)");
  }

  if (document.body && document.body.childElementCount > 0) {
    start();
  } else {
    const boot = new MutationObserver(() => {
      if (document.body && document.body.childElementCount > 0) {
        boot.disconnect();
        start();
      }
    });
    boot.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(start, 1500);
  }
})();
