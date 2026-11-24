import type { CanvasSideTabView, CanvasSnapshot, PluginCanvas, PluginContext } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { workspaceBinding } from "@workbench/lib/plugins/registry";
import { bindCanvasScope, runPluginCallback } from "@workbench/lib/plugins/runtime";
import { focusViewportForNode } from "./canvas-node-geometry";
import type { CanvasSession } from "./canvas-session";

export type CanvasViewSnapshot = Readonly<{ tool: "select" | "pan"; miniMapOpen: boolean }>;

export type CanvasViewController = {
    readonly scope: ScopeBinding;
    getSnapshot(): CanvasViewSnapshot;
    subscribe(listener: () => void): () => void;
    setTool(tool: "select" | "pan"): void;
    setMiniMap(open: boolean): void;
    getCenter(): Position;
    focusNode(nodeId: string, callerSignal?: AbortSignal, canvas?: PluginCanvas): Promise<void>;
    setZoom(scale: number, canvas: PluginCanvas): CanvasSnapshot;
    resetViewport(canvas: PluginCanvas): CanvasSnapshot;
    bind(ctx: PluginContext, contributionId: string): CanvasSideTabView;
    dispose(): void;
};

function measureFocusFrame(container: HTMLElement, nodeId: string) {
    const nodeRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.getBoundingClientRect();
    const panelRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] [data-node-panel]`)?.getBoundingClientRect();
    const toolbarRect = document.querySelector<HTMLElement>(`[data-node-toolbar="${nodeId}"]`)?.getBoundingClientRect();
    const dockRect = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")?.getBoundingClientRect();
    const below = nodeRect && panelRect ? panelRect.bottom - nodeRect.bottom : 0;
    const above = nodeRect && toolbarRect ? nodeRect.top - toolbarRect.top : 0;
    return { above, below, bottomInset: dockRect && below > 0 ? Math.max(0, container.getBoundingClientRect().bottom - dockRect.top) : 0 };
}

export function createCanvasView(session: CanvasSession, container: { readonly current: HTMLElement | null }, onHoverNode: (nodeId: string | null) => void, onFocus: () => void): CanvasViewController {
    session.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([session.signal, controller.signal]);
    const scope: ScopeBinding = bindCanvasScope(Object.freeze({ ...workspaceBinding, kind: "project", projectId: session.projectId, signal }), session.signal);
    let snapshot: CanvasViewSnapshot = Object.freeze({ tool: "pan", miniMapOpen: false });
    const listeners = new Set<() => void>();
    let hover: { owner: object; nodeId: string } | null = null;
    let animation: { nodeId: string; controller: AbortController } | null = null;

    function getContainer() {
        signal.throwIfAborted();
        if (!container.current) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        return container.current;
    }

    function getCenter() {
        const rect = getContainer().getBoundingClientRect();
        const viewport = session.getSnapshot().viewport;
        return { x: (rect.width / 2 - viewport.x) / viewport.k, y: (rect.height / 2 - viewport.y) / viewport.k };
    }

    function clearHover() {
        if (!hover) return;
        hover = null;
        onHoverNode(null);
    }

    function publish() {
        for (const listener of listeners) {
            if (signal.aborted) break;
            try { listener(); }
            catch (error) { console.error("[canvas] view subscriber", error); }
        }
    }

    async function focusNode(nodeId: string, callerSignal = signal, canvas?: PluginCanvas) {
        callerSignal.throwIfAborted();
        if (canvas && canvas.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const element = getContainer();
        const graph = canvas ? canvas.getSnapshot() : session.getSnapshot();
        const node = graph.nodes.find((item) => item.id === nodeId);
        if (!node) throw new PluginError("PLUGIN_NOT_FOUND");
        const rect = element.getBoundingClientRect();
        const target = focusViewportForNode(node, rect, measureFocusFrame(element, nodeId));
        animation?.controller.abort(new PluginError("PLUGIN_INACTIVE"));
        const current = { nodeId, controller: new AbortController() };
        animation = current;
        const operationSignal = AbortSignal.any([signal, callerSignal, current.controller.signal, ...(canvas ? [canvas.signal] : [])]);
        return new Promise<void>((resolve, reject) => {
            let frame: number | null = null;
            let startTime: number | null = null;
            let finished = false;
            const finish = (error?: unknown) => {
                if (finished) return;
                finished = true;
                if (frame !== null) cancelAnimationFrame(frame);
                operationSignal.removeEventListener("abort", abort);
                if (animation === current) animation = null;
                if (error === undefined) resolve();
                else reject(error);
            };
            const abort = () => finish(operationSignal.reason);
            operationSignal.addEventListener("abort", abort, { once: true });
            const check = () => {
                operationSignal.throwIfAborted();
                if (!session.getSnapshot().nodes.some((item) => item.id === nodeId)) throw new PluginError("PLUGIN_NOT_FOUND");
            };
            const start = { ...graph.viewport };
            const step = (now: number) => {
                frame = null;
                try {
                    check();
                    if (startTime === null) startTime = now;
                    const progress = Math.min((now - startTime) / 450, 1);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    const viewport = { x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased, k: start.k + (target.k - start.k) * eased };
                    if (canvas) canvas.setViewport(viewport);
                    else session.setViewport(viewport, { kind: "ui" });
                    check();
                    if (progress < 1) frame = requestAnimationFrame(step);
                    else finish();
                } catch (error) { finish(error); }
            };
            try {
                check();
                clearHover();
                check();
                if (canvas) canvas.setSelection({ nodeIds: [nodeId], connectionId: null });
                else session.setSelection({ nodeIds: [nodeId], connectionId: null }, { kind: "ui" });
                check();
                onFocus();
                check();
                frame = requestAnimationFrame(step);
            } catch (error) { finish(error); }
        });
    }

    const unsubscribe = session.subscribe(() => {
        const nodes = session.getSnapshot().nodes;
        if (hover && !nodes.some((node) => node.id === hover!.nodeId)) clearHover();
        if (animation && !nodes.some((node) => node.id === animation!.nodeId)) animation.controller.abort(new PluginError("PLUGIN_NOT_FOUND"));
    });
    signal.addEventListener("abort", () => { unsubscribe(); listeners.clear(); clearHover(); }, { once: true });

    return {
        scope,
        getSnapshot() {
            signal.throwIfAborted();
            session.getSnapshot();
            return snapshot;
        },
        subscribe(listener) {
            signal.throwIfAborted();
            session.getSnapshot();
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        setTool(tool) {
            signal.throwIfAborted();
            session.getSnapshot();
            if (snapshot.tool === tool) return;
            snapshot = Object.freeze({ ...snapshot, tool });
            publish();
        },
        setMiniMap(open) {
            signal.throwIfAborted();
            session.getSnapshot();
            if (snapshot.miniMapOpen === open) return;
            snapshot = Object.freeze({ ...snapshot, miniMapOpen: open });
            publish();
        },
        getCenter,
        focusNode,
        setZoom(scale, canvas) {
            if (canvas.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            const rect = getContainer().getBoundingClientRect();
            const viewport = canvas.getSnapshot().viewport;
            const k = Math.min(Math.max(scale, 0.05), 5);
            canvas.setViewport({ x: rect.width / 2 - ((rect.width / 2 - viewport.x) / viewport.k) * k, y: rect.height / 2 - ((rect.height / 2 - viewport.y) / viewport.k) * k, k });
            const result = canvas.getSnapshot();
            signal.throwIfAborted();
            onFocus();
            return result;
        },
        resetViewport(canvas) {
            if (canvas.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            const rect = getContainer().getBoundingClientRect();
            canvas.setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            const result = canvas.getSnapshot();
            signal.throwIfAborted();
            onFocus();
            return result;
        },
        bind(ctx, contributionId) {
            signal.throwIfAborted();
            if (ctx.scope.kind !== "view" || ctx.scope.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            const canvas = ctx.canvas();
            if (canvas.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            const boundSignal = AbortSignal.any([signal, ctx.scope.signal, canvas.signal]);
            boundSignal.throwIfAborted();
            const owner = {};
            boundSignal.addEventListener("abort", () => { if (hover?.owner === owner) clearHover(); }, { once: true });
            return Object.freeze({
                getCenter: () => runPluginCallback(ctx, contributionId, "view.getCenter", () => {
                    boundSignal.throwIfAborted();
                    return getCenter();
                }),
                focusNode: async (nodeId: string) => runPluginCallback(ctx, contributionId, "view.focusNode", () => {
                    boundSignal.throwIfAborted();
                    return focusNode(nodeId, boundSignal, canvas);
                }),
                setHoverNode: (nodeId: string | null) => runPluginCallback(ctx, contributionId, "view.setHoverNode", () => {
                    boundSignal.throwIfAborted();
                    if (nodeId === null) {
                        if (hover?.owner === owner) clearHover();
                        return;
                    }
                    if (!canvas.getNodes().some((node) => node.id === nodeId)) throw new PluginError("PLUGIN_NOT_FOUND");
                    hover = { owner, nodeId };
                    onHoverNode(nodeId);
                }),
            });
        },
        dispose() { controller.abort(new PluginError("PLUGIN_SCOPE_CLOSED")); },
    };
}
