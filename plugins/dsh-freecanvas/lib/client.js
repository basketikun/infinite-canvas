// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 JustinQiuck

/**
 * dsh-plugin-freecanvas browser half.
 *
 * Mounts a sidebar entry that opens DSH FreeCanvas alongside the
 * conversation. The user can switch between conversation, split, and canvas
 * layouts, and resize the split with a draggable divider. Pure DOM (no React
 * build step).
 *
 * Registration contract: every DSH client bundle must call
 * `window.__ModuleLoader__.load({ id, factory })` — the bundle script only
 * REGISTERS the factory; the shell materializes it (running `apply`) when the
 * plugin entry activates. The `id` must equal the loader entry's package name.
 *
 * Mounting: DSH's sidebar shell exposes no third-party slot, so (like the
 * task-board / aionui-panel family) the entry row is injected at DOM level.
 * Locating the sidebar is best-effort across shell skins:
 *   1. `[data-pane="sidebar"]` (stamped by the dsh-web-ui-all compat shim)
 *   2. `[class*="sidebarCol"]` (stock shell css-module class)
 *   3. the container of the New Session button (`button[class*="newSession"]`)
 * Insertion tries up to three anchor positions and verifies the row is
 * actually visible (has layout) before settling. A MutationObserver plus a
 * bounded retry timer self-heal re-renders and late-rendering shells.
 *
 * Diagnostics stay local and are written to the browser console only when
 * `window.__DSH_FREECANVAS_DEBUG__` is enabled.
 */

window.__ModuleLoader__.load({
    id: "dsh-plugin-freecanvas",
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        const CSS = `
[data-dsh-canvas-entry]{position:relative;width:100%;height:32px;flex:none;display:flex;align-items:center;box-sizing:border-box;color:var(--dsw-alias-label-secondary);white-space:nowrap}
[data-dsh-canvas-entryMain]{height:32px;min-width:0;flex:1;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;color:inherit;font:500 13px/32px system-ui,sans-serif;text-align:left;background:transparent;border:0;border-radius:8px;cursor:pointer}
[data-dsh-canvas-entryMain]:hover{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}
[data-dsh-canvas-entry][data-active] [data-dsh-canvas-entryMain]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:600}
[data-dsh-canvas-entryIcon]{flex:none;justify-content:center;align-items:center;display:inline-flex}
[data-dsh-canvas-entryLabel]{min-width:0;flex:1;text-overflow:ellipsis;overflow:hidden}
[data-dsh-canvas-layout-button]{height:28px;min-width:42px;flex:none;padding:0 7px;color:var(--dsw-alias-label-secondary);font:500 11px/28px system-ui,sans-serif;background:transparent;border:0;border-radius:7px;cursor:pointer}
[data-dsh-canvas-layout-button]:hover,[data-dsh-canvas-layout-button][aria-expanded=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-sidebar-nav-item-hover)}
[data-dsh-canvas-mode-menu]{position:fixed;z-index:1000;display:none;min-width:112px;padding:4px;background:var(--dsw-alias-bg-base);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.22)}
[data-dsh-canvas-mode-menu][data-open]{display:block}
[data-dsh-canvas-mode-button]{width:100%;height:30px;padding:0 10px;color:var(--dsw-alias-label-secondary);font:500 12px/30px system-ui,sans-serif;text-align:left;white-space:nowrap;background:transparent;border:0;border-radius:6px;cursor:pointer}
[data-dsh-canvas-mode-button]:hover,[data-dsh-canvas-mode-button]:focus-visible{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);outline:none}
[data-dsh-canvas-mode-button][data-selected]{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 13%,transparent);font-weight:650}
[data-dsh-canvas-view]{box-sizing:border-box;position:absolute;inset:0;z-index:60;background:var(--dsw-alias-bg-base);display:none}
[data-dsh-canvas-view] iframe{width:100%;height:100%;border:0;background:#fff}
[data-dsh-canvas-splitter]{position:relative;z-index:65;display:none;min-width:10px;height:100%;cursor:col-resize;touch-action:none}
[data-dsh-canvas-splitter]::after{content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);transform:translateX(-50%);transition:width .15s,background .15s}
[data-dsh-canvas-splitter]:hover::after,[data-dsh-canvas-splitter][data-dragging]::after{width:3px;background:var(--dsw-alias-accent-primary,var(--dsw-alias-label-primary))}
html[data-dsh-canvas-active][data-dsh-canvas-mode=split] [data-pane=conversation]{display:grid!important;grid-template-columns:minmax(240px,var(--dsh-canvas-conversation-width,42%)) 10px minmax(280px,1fr);grid-template-rows:minmax(0,1fr);align-items:stretch;overflow:hidden}
html[data-dsh-canvas-active][data-dsh-canvas-mode=split] [data-pane=conversation]>:not([data-slot=conversation]):not([data-dsh-canvas-view]):not([data-dsh-canvas-splitter]){display:none!important}
html[data-dsh-canvas-active][data-dsh-canvas-mode=split] [data-pane=conversation]>[data-slot=conversation]{display:block!important;grid-column:1;grid-row:1;min-width:0;min-height:0;overflow:hidden}
html[data-dsh-canvas-active][data-dsh-canvas-mode=split] [data-pane=conversation]>[data-slot=conversation]>*{width:100%;height:100%;min-width:0;min-height:0}
html[data-dsh-canvas-active][data-dsh-canvas-mode=split] [data-dsh-canvas-splitter]{display:block;grid-column:2;grid-row:1}
html[data-dsh-canvas-active][data-dsh-canvas-mode=split] [data-dsh-canvas-view]{position:relative;inset:auto;display:block;grid-column:3;grid-row:1;min-width:0;min-height:0}
html[data-dsh-canvas-active][data-dsh-canvas-mode=canvas] [data-pane=conversation]>:not([data-dsh-canvas-view]){display:none!important}
html[data-dsh-canvas-active][data-dsh-canvas-mode=canvas] [data-dsh-canvas-view]{display:block}
`;

        const MODE_KEY = "dsh-canvas:view-mode";
        const SPLIT_KEY = "dsh-canvas:conversation-width";
        const DEFAULT_MODE = "split";
        const DEFAULT_SPLIT = 42;
        const VALID_MODES = ["split", "canvas"];
        const MODE_LABELS = { conversation: "会话", split: "分屏", canvas: "画布" };

        let disposed = false;

        /** Keep optional diagnostics local to the current browser session. */
        function diag(payload) {
            try {
                if (window.__DSH_FREECANVAS_DEBUG__) console.debug("[dsh-freecanvas]", payload);
            } catch (_) { /* best-effort */ }
        }

        function elInfo(el) {
            if (!el) return null;
            return { tag: el.tagName, cls: String(el.className || "").slice(0, 120), dp: el.getAttribute ? el.getAttribute("data-pane") : null };
        }

        function rectOf(el) {
            try {
                const r = el.getBoundingClientRect();
                return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
            } catch (_) {
                return null;
            }
        }

        /** Log lifecycle status only when local debug mode is enabled. */
        function showStatus(text) {
            diag({ stage: "status", message: text });
        }

        function injectStyle() {
            if (document.querySelector("style[data-dsh-canvas-style]")) return;
            const style = document.createElement("style");
            style.textContent = CSS;
            style.setAttribute("data-dsh-canvas-style", "");
            document.head.appendChild(style);
        }

        /** Locate the sidebar UI root across shells/skins, or null while not yet mounted. */
        function sidebarRoot() {
            const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
            if (column) {
                // Current shells wrap the sidebar UI: column > wrapper > root(logoRow owner).
                // Prefer the element that owns the logo row — the real sidebar UI root —
                // falling back to the column's first child for legacy shells.
                const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement;
                return logoOwner ?? column.firstElementChild ?? column;
            }
            // Fallback: walk up from the New Session button — every shell keeps it.
            const btn = document.querySelector('button[class*="newSession"], button[class*="newSessionButton"]');
            if (btn) {
                const row = btn.closest('[class*="logoRow"]');
                const base = row?.parentElement ?? btn.parentElement;
                let el = base;
                for (let i = 0; i < 6 && el; i++) {
                    if (el.getAttribute && (el.getAttribute("data-pane") === "sidebar" || /sidebar/i.test(String(el.className)))) return el;
                    el = el.parentElement;
                }
                return base ?? btn;
            }
            return null;
        }

        function centerColumn() {
            return document.querySelector('[data-pane="conversation"], [class*="centerCol"]');
        }

        function canvasUrl() {
            return location.origin + "/dsh-freecanvas/";
        }

        async function prepareCanvasAgent() {
            try {
                const response = await fetch(location.origin + "/canvas-agent-bootstrap", { cache: "no-store" });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.url || !data.token) throw new Error(data.error || "Canvas Agent bootstrap unavailable");
                const parsed = new URL(String(data.url));
                if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("Canvas Agent URL is not loopback");
                localStorage.setItem("canvas-agent-url", String(data.url).replace(/\/$/, ""));
                localStorage.setItem("canvas-agent-token", String(data.token));
                diag({ stage: "agent-bootstrap", ok: true, url: String(data.url), tokenPresent: true });
                return true;
            } catch (error) {
                diag({ stage: "agent-bootstrap", ok: false, error: String(error && error.message || error).slice(0, 180) });
                return false;
            }
        }

        function createView() {
            const existing = document.querySelector("[data-dsh-canvas-view]");
            if (existing) return existing;
            const column = centerColumn();
            const view = document.createElement("div");
            view.setAttribute("data-dsh-canvas-view", "");
            const frame = document.createElement("iframe");
            frame.setAttribute("data-canvas-no-zoom", "");
            frame.setAttribute("allow", "clipboard-read; clipboard-write");
            frame.addEventListener("load", () => diag({ stage: "iframe-load", src: frame.src, rect: rectOf(frame) }));
            frame.addEventListener("error", () => diag({ stage: "iframe-error", src: frame.src }));
            // 早期错误捕获：导航前 contentWindow 是同源 about:blank 窗口，
            // 挂上的监听会跨导航保留，能抓到画布模块加载/执行阶段的报错。
            try {
                const w = frame.contentWindow;
                w.addEventListener("error", (e) => diag({
                    stage: "frame-early-error",
                    msg: String(e.message || e).slice(0, 200),
                    src: String(e.filename || "").slice(0, 130),
                    line: e.lineno
                }), true);
                w.addEventListener("unhandledrejection", (e) => diag({
                    stage: "frame-early-rejection",
                    msg: String((e.reason && e.reason.message) || e.reason).slice(0, 200)
                }));
            } catch (_) { /* best-effort */ }
            view.appendChild(frame);
            (column ?? document.body).appendChild(view);
            // The iframe is served from the DSH origin, so these namespaced
            // localStorage values are shared with it. Bootstrap first to avoid
            // putting the local connection token in the iframe URL or logs.
            void prepareCanvasAgent().finally(() => {
                if (!disposed && frame.isConnected) frame.src = canvasUrl();
            });
            return view;
        }

        function readMode() {
            try {
                const value = localStorage.getItem(MODE_KEY);
                return VALID_MODES.includes(value) ? value : DEFAULT_MODE;
            } catch (_) {
                return DEFAULT_MODE;
            }
        }

        function readSplit() {
            try {
                const value = Number(localStorage.getItem(SPLIT_KEY));
                return Number.isFinite(value) && value >= 20 && value <= 80 ? value : DEFAULT_SPLIT;
            } catch (_) {
                return DEFAULT_SPLIT;
            }
        }

        function writePreference(key, value) {
            try { localStorage.setItem(key, String(value)); } catch (_) { /* best-effort */ }
        }

        function applySplit(value, persist) {
            const column = centerColumn();
            if (!column) return DEFAULT_SPLIT;
            const width = column.getBoundingClientRect().width;
            const minConversation = Math.min(260, Math.max(200, width * 0.34));
            const minCanvas = Math.min(300, Math.max(240, width * 0.38));
            const minPercent = width > 0 ? minConversation / width * 100 : 25;
            const maxPercent = width > 0 ? (width - minCanvas - 10) / width * 100 : 70;
            const safeMax = Math.max(minPercent, maxPercent);
            const next = Math.min(safeMax, Math.max(minPercent, Number(value) || DEFAULT_SPLIT));
            column.style.setProperty("--dsh-canvas-conversation-width", next.toFixed(2) + "%");
            if (persist) writePreference(SPLIT_KEY, next.toFixed(2));
            return next;
        }

        function updateModeControls(mode, active) {
            document.querySelectorAll("[data-dsh-canvas-mode-button]").forEach((button) => {
                const buttonMode = button.getAttribute("data-mode");
                const selected = buttonMode === (active ? mode : "conversation");
                button.toggleAttribute("data-selected", selected);
                button.setAttribute("aria-checked", selected ? "true" : "false");
            });
            const trigger = document.querySelector("[data-dsh-canvas-layout-button]");
            const label = MODE_LABELS[active ? mode : "conversation"];
            if (trigger && trigger.textContent !== label) trigger.textContent = label;
        }

        function createLayoutUi() {
            const column = centerColumn();
            if (!column) return null;

            let splitter = document.querySelector("[data-dsh-canvas-splitter]");
            if (!splitter) {
                splitter = document.createElement("div");
                splitter.setAttribute("data-dsh-canvas-splitter", "");
                splitter.setAttribute("role", "separator");
                splitter.setAttribute("aria-label", "调整会话与画布宽度");
                splitter.setAttribute("aria-orientation", "vertical");
                splitter.tabIndex = 0;
                const updateFromPointer = (event, persist) => {
                    const rect = column.getBoundingClientRect();
                    if (rect.width <= 0) return;
                    const percent = (event.clientX - rect.left) / rect.width * 100;
                    applySplit(percent, persist);
                };
                splitter.addEventListener("pointerdown", (event) => {
                    event.preventDefault();
                    splitter.toggleAttribute("data-dragging", true);
                    splitter.setPointerCapture?.(event.pointerId);
                    const previousCursor = document.body.style.cursor;
                    const previousSelect = document.body.style.userSelect;
                    document.body.style.cursor = "col-resize";
                    document.body.style.userSelect = "none";
                    const move = (moveEvent) => updateFromPointer(moveEvent, false);
                    const up = (upEvent) => {
                        updateFromPointer(upEvent, true);
                        splitter.toggleAttribute("data-dragging", false);
                        document.body.style.cursor = previousCursor;
                        document.body.style.userSelect = previousSelect;
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                        window.removeEventListener("pointercancel", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                    window.addEventListener("pointercancel", up);
                });
                splitter.addEventListener("keydown", (event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const current = parseFloat(column.style.getPropertyValue("--dsh-canvas-conversation-width")) || readSplit();
                    applySplit(current + (event.key === "ArrowLeft" ? -2 : 2), true);
                });
                column.appendChild(splitter);
            }
            return { splitter };
        }

        function isVisible(el) {
            try {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && el.offsetParent !== null;
            } catch (_) {
                return true; // unknown → assume visible
            }
        }

        /** Walk `el` up until it is a direct child of `root` (or null). */
        function directChildOf(root, el) {
            if (!el) return null;
            let e = el;
            while (e && e.parentElement && e.parentElement !== root) e = e.parentElement;
            return e && e.parentElement === root ? e : null;
        }

        /**
         * Insert the entry row into the sidebar UI root. Anchor elements are
         * normalized to direct children of `root` before insertBefore, so the
         * DOM call can never throw NotFoundError on deep shell wrappers. Tries
         * up to 3 anchor positions, verifying the row is visible at each stop.
         * @returns {object} { mounted, anchor, visible }
         */
        function placeEntry(root, entry) {
            const anchors = [];
            const logoRow = root.querySelector('[class*="logoRow"]');
            anchors.push({ name: "logoRow", el: directChildOf(root, logoRow) ?? logoRow });
            anchors.push({ name: "newSession-btn", el: root.querySelector('button[class*="newSession"], button[class*="newSessionButton"]') ?? null });
            anchors.push({ name: "firstChild", el: root.firstElementChild ?? null });

            for (const a of anchors) {
                const ref = directChildOf(root, a.el);
                if (!ref) continue;
                try {
                    root.insertBefore(entry, ref.nextSibling ?? ref);
                } catch (_) {
                    continue;
                }
                entry.__lastAnchor = a.name;
                if (isVisible(entry)) return { mounted: true, anchor: a.name, visible: true };
                entry.remove();
            }
            // Last resort: append at the end of the sidebar UI root.
            root.appendChild(entry);
            entry.__lastAnchor = "append";
            return { mounted: true, anchor: "append", visible: isVisible(entry) };
        }

        let entryCleanup;

        function mountSidebarEntry(toggle, selectMode) {
            const root = sidebarRoot();
            if (!root || root.querySelector("[data-dsh-canvas-entry]")) return null;
            if (entryCleanup) entryCleanup();

            const entry = document.createElement("div");
            entry.setAttribute("data-dsh-canvas-entry", "");
            entry.setAttribute("role", "group");
            entry.setAttribute("aria-label", "DSH FreeCanvas");

            const mainButton = document.createElement("button");
            mainButton.setAttribute("type", "button");
            mainButton.setAttribute("data-dsh-canvas-entryMain", "");
            mainButton.setAttribute("title", "打开或关闭 DSH FreeCanvas");
            mainButton.setAttribute("aria-pressed", "false");
            const icon = document.createElement("span");
            icon.setAttribute("data-dsh-canvas-entryIcon", "");
            icon.textContent = "🎨";
            const label = document.createElement("span");
            label.setAttribute("data-dsh-canvas-entryLabel", "");
            label.textContent = "DSH FreeCanvas";
            mainButton.appendChild(icon);
            mainButton.appendChild(label);
            mainButton.addEventListener("click", toggle);

            const layoutButton = document.createElement("button");
            layoutButton.setAttribute("type", "button");
            layoutButton.setAttribute("data-dsh-canvas-layout-button", "");
            layoutButton.setAttribute("aria-label", "选择画布显示模式");
            layoutButton.setAttribute("aria-haspopup", "menu");
            layoutButton.setAttribute("aria-expanded", "false");
            layoutButton.setAttribute("aria-controls", "dsh-freecanvas-layout-menu");
            layoutButton.textContent = MODE_LABELS.conversation;

            const menu = document.createElement("div");
            menu.id = "dsh-freecanvas-layout-menu";
            menu.setAttribute("data-dsh-canvas-mode-menu", "");
            menu.setAttribute("role", "menu");
            menu.setAttribute("aria-label", "画布显示模式");
            const menuButtons = Object.entries(MODE_LABELS).map(([buttonMode, text]) => {
                const button = document.createElement("button");
                button.setAttribute("type", "button");
                button.setAttribute("data-dsh-canvas-mode-button", "");
                button.setAttribute("data-mode", buttonMode);
                button.setAttribute("role", "menuitemradio");
                button.setAttribute("aria-checked", "false");
                button.tabIndex = -1;
                button.textContent = text;
                menu.appendChild(button);
                return button;
            });

            const positionMenu = () => {
                const rect = layoutButton.getBoundingClientRect();
                const width = menu.offsetWidth;
                const height = menu.offsetHeight;
                let left = rect.right + 6;
                if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 6);
                const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - height - 8));
                menu.style.left = Math.round(left) + "px";
                menu.style.top = Math.round(top) + "px";
            };
            const closeMenu = (restoreFocus = false) => {
                menu.removeAttribute("data-open");
                layoutButton.setAttribute("aria-expanded", "false");
                if (restoreFocus) layoutButton.focus();
            };
            const openMenu = () => {
                menu.setAttribute("data-open", "");
                layoutButton.setAttribute("aria-expanded", "true");
                positionMenu();
                (menuButtons.find((button) => button.getAttribute("aria-checked") === "true") ?? menuButtons[0])?.focus();
            };
            const onLayoutClick = (event) => {
                event.stopPropagation();
                if (menu.hasAttribute("data-open")) closeMenu();
                else openMenu();
            };
            const onLayoutKeyDown = (event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                openMenu();
            };
            const onMenuKeyDown = (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    closeMenu(true);
                    return;
                }
                if (event.key === "Tab") {
                    closeMenu();
                    return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const current = menuButtons.indexOf(document.activeElement);
                const next = event.key === "Home"
                    ? 0
                    : event.key === "End"
                        ? menuButtons.length - 1
                        : (current + (event.key === "ArrowDown" ? 1 : -1) + menuButtons.length) % menuButtons.length;
                menuButtons[next]?.focus();
            };
            const onOutsidePointer = (event) => {
                if (!entry.contains(event.target) && !menu.contains(event.target)) closeMenu();
            };
            const closeOnViewportChange = () => closeMenu();

            menuButtons.forEach((button) => button.addEventListener("click", () => {
                selectMode(button.getAttribute("data-mode"));
                closeMenu(true);
            }));
            layoutButton.addEventListener("click", onLayoutClick);
            layoutButton.addEventListener("keydown", onLayoutKeyDown);
            menu.addEventListener("keydown", onMenuKeyDown);
            document.addEventListener("pointerdown", onOutsidePointer);
            window.addEventListener("resize", closeOnViewportChange);
            window.addEventListener("scroll", closeOnViewportChange, true);
            window.addEventListener("blur", closeOnViewportChange);

            entry.appendChild(mainButton);
            entry.appendChild(layoutButton);
            document.body.appendChild(menu);
            entryCleanup = () => {
                document.removeEventListener("pointerdown", onOutsidePointer);
                window.removeEventListener("resize", closeOnViewportChange);
                window.removeEventListener("scroll", closeOnViewportChange, true);
                window.removeEventListener("blur", closeOnViewportChange);
                menu.remove();
                entryCleanup = null;
            };
            entry.__dispose = entryCleanup;

            const result = placeEntry(root, entry);
            if (!result.visible) diag({ stage: "placed-but-invisible", root: elInfo(root), result });
            return entry;
        }

        let observer;
        let retryTimer;

        function dispose() {
            if (disposed) return;
            disposed = true;
            if (observer) observer.disconnect();
            if (retryTimer) clearInterval(retryTimer);
            if (entryCleanup) entryCleanup();
            document.querySelectorAll("[data-dsh-canvas-entry],[data-dsh-canvas-mode-menu],[data-dsh-canvas-view],[data-dsh-canvas-splitter],[data-dsh-canvas-style]").forEach((node) => node.remove());
            document.documentElement.removeAttribute("data-dsh-canvas-active");
            document.documentElement.removeAttribute("data-dsh-canvas-mode");
            document.documentElement.removeAttribute("data-dsh-canvas-mounted");
            centerColumn()?.style.removeProperty("--dsh-canvas-conversation-width");
        }

        function boot() {
            if (disposed) return;
            injectStyle();
            let active = false;
            let mode = readMode();

            const updateEntryState = () => {
                const entry = document.querySelector("[data-dsh-canvas-entry]");
                if (!entry) return;
                entry.toggleAttribute("data-active", active);
                entry.querySelector("[data-dsh-canvas-entryMain]")?.setAttribute("aria-pressed", active ? "true" : "false");
            };

            const applyLayoutState = (stage) => {
                document.documentElement.toggleAttribute("data-dsh-canvas-active", active);
                if (active) document.documentElement.setAttribute("data-dsh-canvas-mode", mode);
                else document.documentElement.removeAttribute("data-dsh-canvas-mode");
                createLayoutUi();
                applySplit(readSplit(), false);
                updateModeControls(mode, active);
                const view = createView();
                if (view) view.toggleAttribute("data-open", active);
                updateEntryState();
                try {
                    const frame = view && view.querySelector("iframe");
                    let cross = null;
                    if (frame) {
                        try {
                            cross = frame.contentDocument ? "same-origin" : "no-document";
                        } catch (_) {
                            cross = "cross-origin";
                        }
                    }
                    diag({
                        stage,
                        active,
                        mode,
                        viewOpen: view ? view.getAttribute("data-open") : null,
                        viewRect: view ? rectOf(view) : null,
                        iframeSrc: frame ? frame.src : null,
                        iframeComplete: frame ? frame.complete : null,
                        iframeCrossOrigin: cross
                    });
                } catch (_) { /* best-effort */ }
            };

            const setMode = (nextMode, persist) => {
                mode = VALID_MODES.includes(nextMode) ? nextMode : DEFAULT_MODE;
                if (persist) writePreference(MODE_KEY, mode);
                active = true;
                applyLayoutState("layout-mode");
            };

            const selectMode = (nextMode) => {
                if (nextMode === "conversation") {
                    active = false;
                    applyLayoutState("layout-mode");
                    return;
                }
                setMode(nextMode, true);
            };

            const toggle = () => {
                active = !active;
                applyLayoutState("toggle");
            };

            /** Idempotent mount; returns true once the entry row is in the DOM. */
            const mount = () => {
                try {
                    if (document.querySelector("[data-dsh-canvas-entry]")) {
                        createView();
                        createLayoutUi();
                        applySplit(readSplit(), false);
                        updateModeControls(mode, active);
                        updateEntryState();
                        return true;
                    }
                    const entry = mountSidebarEntry(toggle, selectMode);
                    if (entry) {
                        createView();
                        createLayoutUi();
                        applySplit(readSplit(), false);
                        updateModeControls(mode, active);
                        updateEntryState();
                        document.documentElement.setAttribute("data-dsh-canvas-mounted", "1");
                        showStatus("🎨 画布插件已激活，侧边栏入口已挂载" + (isVisible(entry) ? "" : "（但不可见！）"));
                        diag({
                            stage: "mounted",
                            root: elInfo(sidebarRoot()),
                            anchor: entry.__lastAnchor,
                            entryVisible: isVisible(entry),
                            centerCol: !!centerColumn(),
                            title: String(document.title)
                        });
                        return true;
                    }
                    return false;
                } catch (err) {
                    diag({ stage: "mount-error", message: err && err.message, root: elInfo(sidebarRoot()) });
                    return false;
                }
            };

            observer = new MutationObserver(() => mount());
            observer.observe(document.body, { childList: true, subtree: true });

            if (!mount()) {
                let tries = 0;
                showStatus("🎨 画布插件已激活，等待侧边栏渲染…");
                retryTimer = setInterval(() => {
                    if (mount() || ++tries > 10) {
                        clearInterval(retryTimer);
                        if (!document.querySelector("[data-dsh-canvas-entry]")) {
                            showStatus("⚠️ 画布插件已激活，但 10 秒内未找到侧边栏容器");
                            diag({
                                stage: "not-found",
                                direct: elInfo(document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')),
                                newSessionBtn: !!document.querySelector('button[class*="newSession"], button[class*="newSessionButton"]'),
                                htmlSnippet: String(document.body ? document.body.innerHTML : "").slice(0, 400),
                                title: String(document.title)
                            });
                        }
                    }
                }, 1000);
            }

            window.__DSH_FREECANVAS_DISPOSE__ = dispose;
        }

        const apply = (_ctx) => {
            disposed = false;
            try {
                diag({ stage: "applied", href: String(location.href).slice(0, 80), title: String(document.title) });
                boot();
            } catch (err) {
                showStatus("⚠️ 画布插件 apply 异常: " + (err && err.message));
                diag({ stage: "apply-error", message: err && err.message });
                throw err;
            }
            return dispose;
        };

        exports.apply = apply;
        return module.exports;
    }
});
