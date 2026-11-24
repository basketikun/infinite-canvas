import { uploadMediaFile, type UploadedFile } from "@workbench/services/file-storage";
import { ModelExecutionError } from "@infinite-canvas/shared/model-http";
import { nanoid } from "nanoid";
import { z } from "zod";
import { applyOps, canvasDocumentOpSchema, type CanvasDocumentOp } from "@infinite-canvas/shared/canvas/ops/apply";
import type { CanvasGraph } from "@infinite-canvas/shared/canvas/schema/canvas";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import type { CanvasChangeSource, CanvasSelection, CanvasSnapshot, CanvasViewport, CanvasSessionEvents, CanvasTransactionOptions, CanvasSession as PublicCanvasSession } from "@infinite-canvas/plugin-sdk";
import type { CanvasProject, CanvasSaveReceipt, CanvasStore } from "@workbench/stores/canvas/use-canvas-store";

export type CanvasSessionSnapshot = CanvasGraph & { projectId: string; revision: number; selection: { nodeIds: string[]; connectionId: string | null }; viewport: CanvasViewport; canUndo: boolean; canRedo: boolean };
type History = { past: CanvasGraph[]; future: CanvasGraph[] };
type TransactionOptions = CanvasTransactionOptions & { source: CanvasChangeSource };
type SessionOptions = { project: Pick<CanvasProject, "id" | "nodes" | "connections" | "viewport">; store: Pick<CanvasStore, "openProject" | "updateProject" | "flush" | "subscribeSaves">; signal?: AbortSignal };
const selectionSchema = z.object({ nodeIds: z.array(z.string()), connectionId: z.string().nullable() }).strict();
const viewportSchema = z.object({ x: z.number().finite(), y: z.number().finite(), k: z.number().finite().positive() }).strict();

/** 网页的实时图权威；存储只接收已提交快照，预览与图历史分开。 */
export class CanvasSession implements PublicCanvasSession {
    readonly projectId: string;
    readonly signal: AbortSignal;
    private id = nanoid();
    private controller = new AbortController();
    private document: CanvasGraph;
    private snapshot: CanvasSessionSnapshot;
    private history = readonlySnapshot({ past: [], future: [] }) as History;
    private listeners = new Set<() => void>();
    private events = new Map<keyof CanvasSessionEvents, Set<(payload: never) => void | Promise<void>>>();
    private notifications: (() => void)[] = [];
    private notifying = false;
    private preview?: { graph: CanvasGraph };
    private viewportTimer?: ReturnType<typeof setTimeout>;
    private savedRevision = 0;
    private unsubscribeSaves: () => void;
    private closing?: Promise<void>;
    private removeAbort?: () => void;

    constructor(private options: SessionOptions) {
        this.projectId = options.project.id;
        this.signal = this.controller.signal;
        this.document = readonlySnapshot(applyOps({ nodes: [], connections: [] }, [{ type: "replace_graph", graph: { nodes: options.project.nodes, connections: options.project.connections } }])) as CanvasGraph;
        this.snapshot = readonlySnapshot({ ...this.document, projectId: this.projectId, revision: 0, selection: { nodeIds: [], connectionId: null }, viewport: viewportSchema.parse(options.project.viewport), canUndo: false, canRedo: false }) as CanvasSessionSnapshot;
        this.unsubscribeSaves = options.store.subscribeSaves((receipt) => this.saved(receipt));
        if (options.signal) {
            const close = () => { void this.close().catch((error) => console.error("画布退出保存失败", error)); };
            options.signal.addEventListener("abort", close, { once: true });
            this.removeAbort = () => options.signal!.removeEventListener("abort", close);
            if (options.signal.aborted) close();
        }
    }

    private assertActive() {
        if (this.signal.aborted || !this.options.store.openProject(this.projectId)) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    }

    getSnapshot = () => { this.assertActive(); return this.snapshot; };

    async commitMediaResult(source: { input: Blob | string } | { external: UploadedFile }, signal: AbortSignal, apply: (file: UploadedFile) => boolean, options?: { onAccepted?: () => void }) {
        const file = "external" in source ? source.external : await uploadMediaFile(source.input, "file", signal);
        signal.throwIfAborted();
        const revision = this.snapshot.revision;
        // 结果已入图后，发布通知抛错也算受理。
        try { if (!apply(file)) throw new ModelExecutionError("MODEL_TASK_CONFLICT"); }
        finally { if (this.snapshot.revision !== revision) options?.onAccepted?.(); }
    }

    subscribe = (listener: () => void) => {
        this.assertActive();
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    on<K extends keyof CanvasSessionEvents>(event: K, handler: (payload: CanvasSessionEvents[K]) => void | Promise<void>) {
        this.assertActive();
        const listeners = this.events.get(event) ?? new Set();
        listeners.add(handler as (payload: never) => void | Promise<void>);
        this.events.set(event, listeners);
        return () => { listeners.delete(handler as (payload: never) => void | Promise<void>); };
    }

    private emit<K extends keyof CanvasSessionEvents>(event: K, payload: CanvasSessionEvents[K]) {
        const snapshot = readonlySnapshot(payload);
        for (const listener of this.events.get(event) ?? []) {
            if (this.signal.aborted) break;
            try { void Promise.resolve(listener(snapshot as never)).catch((error) => console.error("画布事件处理失败", error)); }
            catch (error) { console.error("画布事件处理失败", error); }
        }
    }

    private publish() {
        for (const listener of this.listeners) {
            if (this.signal.aborted) break;
            try { listener(); }
            catch (error) { console.error("画布订阅处理失败", error); }
        }
    }

    private announce(notification: () => void) {
        this.notifications.push(notification);
        if (this.notifying) return;
        this.notifying = true;
        try { while (this.notifications.length && !this.signal.aborted) this.notifications.shift()!(); }
        finally { this.notifying = false; }
    }

    private selected(graph: CanvasGraph, selection?: CanvasSelection) {
        const requested = selection ? selectionSchema.parse(selection) : this.snapshot.selection;
        const nodes = new Set(graph.nodes.map((node) => node.id));
        const connection = requested.connectionId === null || graph.connections.some((edge) => edge.id === requested.connectionId);
        if (selection && (requested.nodeIds.some((id) => !nodes.has(id)) || !connection)) throw new Error("NODE_NOT_FOUND");
        const nodeIds = [...new Set(requested.nodeIds)].filter((id) => nodes.has(id));
        const connectionId = connection ? requested.connectionId : null;
        return nodeIds.length === this.snapshot.selection.nodeIds.length && nodeIds.every((id, index) => id === this.snapshot.selection.nodeIds[index]) && connectionId === this.snapshot.selection.connectionId ? this.snapshot.selection : { nodeIds, connectionId };
    }

    private commit(graph: CanvasGraph, options: TransactionOptions, history = true, removedNodeIds?: readonly string[]) {
        this.assertActive();
        const before = this.snapshot;
        const changed = graph.nodes !== this.document.nodes || graph.connections !== this.document.connections;
        const visualGraph = !changed && this.preview ? this.preview.graph : graph;
        const selection = this.selected(visualGraph, options.selection);
        const candidateViewport = options.viewport ? viewportSchema.parse(options.viewport) : before.viewport;
        const viewport = candidateViewport.x === before.viewport.x && candidateViewport.y === before.viewport.y && candidateViewport.k === before.viewport.k ? before.viewport : candidateViewport;
        if (!changed && selection === before.selection && viewport === before.viewport) return before;
        const source = readonlySnapshot({ ...options.source });
        const nextHistory = changed ? { past: history ? [...this.history.past.slice(-49), this.document] : this.history.past, future: [] } : this.history;
        const document = readonlySnapshot(graph) as CanvasGraph;
        const snapshot = readonlySnapshot({ ...visualGraph, projectId: this.projectId, revision: before.revision + Number(changed), selection, viewport, canUndo: nextHistory.past.length > 0, canRedo: nextHistory.future.length > 0 }) as CanvasSessionSnapshot;
        if (changed) this.preview = undefined;
        this.document = document;
        this.history = readonlySnapshot(nextHistory) as History;
        this.snapshot = snapshot;
        if (changed) this.options.store.updateProject(this.projectId, document, { sessionId: this.id, revision: snapshot.revision, source });
        if (viewport !== before.viewport) this.scheduleViewport();
        this.announce(() => {
            this.publish();
            if (changed) this.emit("document.committed", { projectId: this.projectId, revision: snapshot.revision, source, operation: "transact", ...(removedNodeIds && { removedNodeIds }) });
            if (selection !== before.selection) this.emit("selection.changed", { projectId: this.projectId, selection: snapshot.selection, source });
            if (viewport !== before.viewport) this.emit("viewport.changed", { projectId: this.projectId, viewport: snapshot.viewport, source });
        });
        return snapshot;
    }

    private prepare(ops: CanvasDocumentOp[]) {
        this.assertActive();
        const operations = z.array(canvasDocumentOpSchema).parse(ops);
        const graph = applyOps(this.document, operations);
        const removed = new Set<string>();
        for (const op of operations) {
            if (op.type === "delete_node") {
                for (const id of op.ids) removed.add(id);
            } else if (op.type === "replace_graph") {
                const nextIds = new Set(op.graph.nodes.map((node) => node.id));
                for (const node of this.document.nodes) if (!nextIds.has(node.id)) removed.add(node.id);
            }
        }
        return { graph, removed: removed.size ? [...removed] : undefined };
    }

    /** 宿主手势和已自行接收素材的内置命令同步提交。 */
    transact(ops: CanvasDocumentOp[], options: TransactionOptions) {
        const { graph, removed } = this.prepare(ops);
        return this.commit(graph, options, true, removed);
    }

    async transactWithMedia(ops: CanvasDocumentOp[], options: TransactionOptions, assertCurrent: () => void) {
        assertCurrent();
        const { graph, removed } = this.prepare(ops);
        return this.commit(graph, options, true, removed);
    }

    /** 宿主媒体结果、排序等完整更新仍经过同一纯文档操作。 */
    updateDocument(updater: (graph: CanvasGraph) => CanvasGraph, options: TransactionOptions & { history?: boolean }) {
        this.assertActive();
        const graph = applyOps(this.document, [{ type: "replace_graph", graph: updater(this.document) }]);
        return this.commit(graph, options, options.history !== false);
    }

    /** 仅宿主手势可持有；被其他事务替换后不能提交旧草稿。 */
    beginPreview() {
        this.assertActive();
        if (this.preview) throw new PluginError("PLUGIN_OPERATION_FAILED");
        const preview = { graph: this.document };
        this.preview = preview;
        const active = () => { this.assertActive(); if (this.preview !== preview) throw new PluginError("PLUGIN_INACTIVE"); };
        return {
            update: (updater: (graph: CanvasGraph) => CanvasGraph) => {
                active();
                const graph = applyOps(preview.graph, [{ type: "replace_graph", graph: updater(preview.graph) }]);
                preview.graph = readonlySnapshot(graph) as CanvasGraph;
                this.snapshot = readonlySnapshot({ ...this.snapshot, ...preview.graph }) as CanvasSessionSnapshot;
                this.announce(() => this.publish());
            },
            commit: (source: CanvasChangeSource) => { active(); const result = this.commit(preview.graph, { source }); this.preview = undefined; return result; },
            cancel: () => {
                active();
                this.preview = undefined;
                this.snapshot = readonlySnapshot({ ...this.snapshot, ...this.document }) as CanvasSessionSnapshot;
                this.announce(() => this.publish());
            },
        };
    }

    getHistory() { return this.history; }

    private restore(direction: "past" | "future", source: CanvasChangeSource) {
        this.assertActive();
        const historyGraph = this.history[direction].at(-1);
        if (!historyGraph) return this.snapshot;
        const target = readonlySnapshot(historyGraph) as CanvasGraph;
        const next = direction === "past" ? { past: this.history.past.slice(0, -1), future: [...this.history.future, this.document] } : { past: [...this.history.past.slice(-49), this.document], future: this.history.future.slice(0, -1) };
        this.history = next;
        const before = this.snapshot;
        this.preview = undefined;
        this.document = target;
        this.history = readonlySnapshot(next) as History;
        this.snapshot = readonlySnapshot({ ...before, ...target, revision: before.revision + 1, selection: { nodeIds: [], connectionId: null }, canUndo: next.past.length > 0, canRedo: next.future.length > 0 }) as CanvasSessionSnapshot;
        const snapshot = this.snapshot;
        const origin = readonlySnapshot({ ...source });
        this.options.store.updateProject(this.projectId, target, { sessionId: this.id, revision: this.snapshot.revision, source: origin });
        this.announce(() => {
            this.publish();
            this.emit("document.committed", { projectId: this.projectId, revision: snapshot.revision, source: origin, operation: direction === "past" ? "undo" : "redo" });
            if (before.selection.nodeIds.length || before.selection.connectionId !== null) this.emit("selection.changed", { projectId: this.projectId, selection: snapshot.selection, source: origin });
        });
        return snapshot;
    }

    undo(source: CanvasChangeSource) { return this.restore("past", source); }
    redo(source: CanvasChangeSource) { return this.restore("future", source); }
    setSelection(selection: CanvasSelection, source: CanvasChangeSource) { this.commit(this.document, { source, selection }); }
    setViewport(viewport: CanvasViewport, source: CanvasChangeSource) { this.commit(this.document, { source, viewport }); }

    private scheduleViewport() {
        clearTimeout(this.viewportTimer);
        this.viewportTimer = setTimeout(() => { this.persistViewport(); }, 500);
    }

    private persistViewport() {
        if (this.viewportTimer === undefined) return;
        clearTimeout(this.viewportTimer);
        this.viewportTimer = undefined;
        this.options.store.updateProject(this.projectId, { viewport: this.snapshot.viewport });
    }

    private saved(receipt: CanvasSaveReceipt) {
        if (receipt.projectId !== this.projectId) return;
        if (this.signal.aborted) return;
        if (receipt.commit?.sessionId !== this.id) return;
        const { revision, source } = receipt.commit;
        if (receipt.status === "failed") this.announce(() => this.emit("document.saveFailed", { projectId: this.projectId, revision, source, code: receipt.code }));
        else if (revision > this.savedRevision) {
            this.savedRevision = revision;
            this.announce(() => this.emit("document.saved", { projectId: this.projectId, revision, source }));
        }
    }

    async flush() {
        this.assertActive();
        this.persistViewport();
        await this.options.store.flush(this.projectId);
        this.assertActive();
    }

    close() {
        if (this.closing) return this.closing;
        this.persistViewport();
        this.controller.abort(new PluginError("PLUGIN_PROJECT_CHANGED"));
        this.preview = undefined;
        this.removeAbort?.();
        this.listeners.clear();
        this.events.clear();
        this.notifications = [];
        return this.closing = this.options.store.flush(this.projectId).then(() => { this.unsubscribeSaves(); }).catch((error) => { this.closing = undefined; throw error; });
    }
}
