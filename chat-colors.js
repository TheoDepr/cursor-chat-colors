/**
 * Cursor per-chat colors — stable edition
 *
 * Colors are locked to composer id (preferred) or first-seen title.
 * Auto-renames and streaming message updates must NOT change the color.
 *
 * After editing: ./enable-chat-colors.sh then Cmd+Q restart.
 */
(function () {
  if (window.__cursorChatColorsInstalled) return;
  window.__cursorChatColorsInstalled = true;

  // Exact title → color (applied once, then sticky on that composer id)
  const OVERRIDES = {
    // "My chat title": "#e85d04",
  };

  const STORE_KEY = "cursor-chat-colors-v2";
  const sticky = new WeakMap(); // element → color (session)

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* quota / private mode */
    }
  }

  function hashHue(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 360;
  }

  function makeColor(seed) {
    return `hsl(${hashHue(seed)} 62% 46%)`;
  }

  function normalizeTitle(title) {
    return String(title || "")
      .replace(/\s+/g, " ")
      .replace(/^\(\d+\)\s*/, "") // "(1) Cursor color plugin"
      .replace(/\s*[·•].*$/, "") // drop "· 4 Files" style suffixes
      .replace(/\s*[+-]\d+(\s+[+-]\d+)?\s*$/, "")
      .trim();
  }

  function textOf(el) {
    if (!el) return "";
    // Prefer direct text, not deep subtree (avoids timestamps / badges)
    if (el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      return normalizeTitle(el.childNodes[0].nodeValue);
    }
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      ".agent-tab-timestamp, .agent-tab-timestamp-right, .agent-sidebar-cell-subtitle, .agent-sidebar-cell-trailing, .agent-sidebar-cell-actions, .compact-agent-history-react-menu-actions"
    ).forEach((n) => n.remove());
    return normalizeTitle(clone.textContent);
  }

  /** Stable color for a chat. Never changes once assigned to a composer id. */
  function colorForChat({ id, title }) {
    const store = loadStore();
    store.byId = store.byId || {};
    store.titleToId = store.titleToId || {};
    store.byTitle = store.byTitle || {};

    const t = normalizeTitle(title);

    if (id && store.byId[id]) {
      if (t) store.titleToId[t] = id;
      saveStore(store);
      return store.byId[id];
    }

    if (t && OVERRIDES[t]) {
      const c = OVERRIDES[t];
      if (id) {
        store.byId[id] = c;
        store.titleToId[t] = id;
        saveStore(store);
      } else {
        store.byTitle[t] = c;
        saveStore(store);
      }
      return c;
    }

    if (t && store.titleToId[t] && store.byId[store.titleToId[t]]) {
      return store.byId[store.titleToId[t]];
    }

    if (t && store.byTitle[t]) {
      if (id) {
        store.byId[id] = store.byTitle[t];
        store.titleToId[t] = id;
        delete store.byTitle[t];
        saveStore(store);
        return store.byId[id];
      }
      return store.byTitle[t];
    }

    const seed = id || t;
    if (!seed) return null;
    const color = makeColor(seed);

    if (id) {
      store.byId[id] = color;
      if (t) store.titleToId[t] = id;
    } else if (t) {
      store.byTitle[t] = color;
    }
    saveStore(store);
    return color;
  }

  function tint(color, amount) {
    if (!color) return "transparent";
    return `color-mix(in srgb, ${color} ${amount}%, transparent)`;
  }

  function paintEl(el, color) {
    if (!el || !color) return;
    const prev = sticky.get(el);
    if (prev === color && el.style.getPropertyValue("--chat-accent") === color) return;
    sticky.set(el, color);
    el.style.setProperty("--chat-accent", color);
    el.dataset.chatColored = "true";
  }

  /** Force top tab paint — Cursor tab CSS beats variables alone. */
  function paintTopTab(tab, color) {
    if (!tab || !color) return;
    sticky.set(tab, color);
    tab.dataset.chatColored = "true";
    tab.style.setProperty("--chat-accent", color);
    const soft = tint(color, 28);
    const strong = tint(color, 48);
    // Hook into VS Code tab tokens used by workbench CSS
    tab.style.setProperty("--vscode-tab-activeBackground", strong);
    tab.style.setProperty("--vscode-tab-inactiveBackground", soft);
    tab.style.setProperty("--vscode-tab-selectedBackground", strong);
    tab.style.setProperty("--vscode-tab-unfocusedActiveBackground", strong);
    tab.style.setProperty("--vscode-tab-unfocusedInactiveBackground", soft);
    tab.style.setProperty("--vscode-tab-unfocusedSelectedBackground", soft);
    // Belt-and-suspenders: inline !important beats theme rules
    const bg = tab.classList.contains("active") ? strong : soft;
    tab.style.setProperty("background-color", bg, "important");
    tab.style.setProperty("background", bg, "important");
    tab.style.setProperty("box-shadow", `inset 0 -2px 0 ${color}`, "important");
  }

  function titleFromTopTab(tab) {
    const label = tab.querySelector(".tab-label, .composer-tab-label");
    const candidates = [
      tab.getAttribute("aria-label"),
      tab.getAttribute("title"),
      label && label.getAttribute("title"),
      label && label.getAttribute("aria-label"),
      textOf(tab.querySelector(".label-name")),
      textOf(tab.querySelector(".monaco-icon-name-container")),
      textOf(label),
    ];
    for (const c of candidates) {
      const t = normalizeTitle(c);
      if (t && t.length > 1) return t;
    }
    return null;
  }

  function colorTopChatTabs() {
    const tabs = new Set();

    document
      .querySelectorAll(
        ".tabs-container > .tab .composer-tab-label, .tabs-container > .tab .tab-label.composer-tab-label"
      )
      .forEach((label) => {
        const tab = label.closest(".tab");
        if (tab) tabs.add(tab);
      });

    // Broader: any editor tab that isn't a normal file (no data-resource-name path with extension)
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
      // Skip obvious file tabs: foo.tsx etc
      if (/\.[a-z0-9]{1,8}$/i.test(resource)) return;
      if (looksLikeChat || (!resource && titleFromTopTab(tab))) tabs.add(tab);
    });

    tabs.forEach((tab) => {
      if (sticky.has(tab)) {
        paintTopTab(tab, sticky.get(tab));
        return;
      }
      const title = titleFromTopTab(tab);
      if (!title) return;
      const color = colorForChat({ title });
      if (color) paintTopTab(tab, color);
    });
  }

  function activeComposerId() {
    const el =
      document.querySelector(".composer-bar[data-composer-id]") ||
      document.querySelector("[data-composer-id]");
    return el ? el.getAttribute("data-composer-id") : null;
  }

  function getActiveTitle() {
    const selectors = [
      '.agent-sidebar-cell[data-selected="true"] .agent-sidebar-cell-caption',
      '.compact-agent-history-react-menu-label[data-selected="true"]',
      ".glass-agent-conversation-tiling__header-title",
      '.agent-tab[aria-selected="true"] .agent-tab-name-text',
    ];
    for (const sel of selectors) {
      const t = textOf(document.querySelector(sel));
      if (t) return t;
    }
    return null;
  }

  function colorSidebarCells() {
    document.querySelectorAll(".agent-sidebar-cell").forEach((cell) => {
      // Keep existing sticky color even if title auto-renames
      if (sticky.has(cell)) {
        paintEl(cell, sticky.get(cell));
        return;
      }
      const title = textOf(cell.querySelector(".agent-sidebar-cell-caption"));
      const color = colorForChat({ title });
      if (color) paintEl(cell, color);
    });
  }

  function colorAgentsHistory() {
    document
      .querySelectorAll(".compact-agent-history-react-menu-label")
      .forEach((label) => {
        if (sticky.has(label)) {
          paintEl(label, sticky.get(label));
          return;
        }
        const title = textOf(label);
        const color = colorForChat({ title });
        if (!color) return;
        paintEl(label, color);
        const row = label.closest("[role='menuitem'], .ui-menu__item");
        if (row) paintEl(row, color);
      });
  }

  function colorAgentTabs() {
    document
      .querySelectorAll(
        ".agent-tab, .agent-tabs-container [role='tab'], .agent-conversation-tabs [role='tab']"
      )
      .forEach((tab) => {
        if (sticky.has(tab)) {
          paintEl(tab, sticky.get(tab));
          return;
        }
        const nameEl = tab.querySelector(".agent-tab-name-text");
        if (!nameEl) return; // never hash whole tab (timestamps change)
        const color = colorForChat({ title: textOf(nameEl) });
        if (color) paintEl(tab, color);
      });
  }

  let lastPaneId = null;
  let lastPaneColor = null;

  function colorActivePane() {
    const id = activeComposerId();
    const title = getActiveTitle();
    const color = colorForChat({ id, title });
    if (!color) return;

    const root = document.documentElement;
    if (color !== lastPaneColor || id !== lastPaneId) {
      lastPaneColor = color;
      lastPaneId = id;
      root.style.setProperty("--chat-active-accent", color);
      root.style.setProperty("--chat-active-tint", tint(color, 22));
    }

    // Re-apply to panes in case Cursor remounted them (color itself stays put)
    document
      .querySelectorAll(
        [
          ".part.auxiliarybar",
          ".agent-panel",
          ".composer-bar",
          ".composer-bar.editor",
          ".composer-messages-container",
          ".glass-agent-conversation-tiling__tile",
          ".glass-agent-conversation-tiling",
          ".agent-sidebar",
        ].join(",")
      )
      .forEach((el) => {
        el.style.setProperty("--composer-pane-background", tint(color, 22));
      });
  }

  function apply() {
    try {
      colorSidebarCells();
      colorAgentsHistory();
      colorAgentTabs();
      colorTopChatTabs();
      colorActivePane();
    } catch (err) {
      console.warn("[cursor-chat-colors]", err);
    }
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(apply, 250);
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
      ...document.querySelectorAll(".compact-agent-history-search-input"),
    ].filter(Boolean);

    // Observe history menu parents if present
    document
      .querySelectorAll(".compact-agent-history-react-menu-label")
      .forEach((el) => {
        const root = el.closest('[role="menu"], .ui-menu, aside, nav') || el.parentElement;
        if (root) roots.push(root);
      });

    const obs = new MutationObserver((mutations) => {
      // Ignore pure message-stream text churn
      for (const m of mutations) {
        if (m.type === "characterData") continue;
        const t = m.target;
        if (!(t instanceof Element)) {
          schedule();
          return;
        }
        if (
          t.closest(
            ".composer-messages-container, .monaco-editor, .markdown-root, .aislash-editor-input"
          )
        ) {
          continue;
        }
        schedule();
        return;
      }
    });

    const opts = { childList: true, subtree: true, attributes: true, attributeFilter: ["data-selected", "data-composer-id", "aria-selected", "class"] };

    if (roots.length) {
      roots.forEach((r) => obs.observe(r, opts));
    } else {
      // Fallback until UI mounts — then narrow
      obs.observe(document.body, opts);
    }

    // Also watch composer-bar for id changes (chat switch)
    const barObs = new MutationObserver(schedule);
    const watchBars = () => {
      document.querySelectorAll(".composer-bar, [data-composer-id]").forEach((el) => {
        barObs.observe(el, { attributes: true, attributeFilter: ["data-composer-id", "data-composer-status"] });
      });
    };
    watchBars();
    setInterval(watchBars, 3000);

    // Periodic light refresh for newly mounted history rows (no title rehash if sticky)
    setInterval(apply, 2000);
  }

  function start() {
    apply();
    observeTargets();
    window.addEventListener("focus", schedule);
    console.info("[cursor-chat-colors] active (stable)");
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
    setTimeout(start, 2500);
  }
})();
