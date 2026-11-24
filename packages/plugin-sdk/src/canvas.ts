import type { CanvasConnection, CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasDocumentOp } from "@infinite-canvas/shared/canvas/ops/apply";
import type { StorageError } from "@infinite-canvas/shared/storage-data";
import type { ReadonlySnapshot } from "./readonly-snapshot";
import type { CapabilityCallContext } from "./runtime/contracts";

export type CanvasChangeSource = { kind: "ui" | "plugin" | "agent" | "system"; id?: string };
export type CanvasSelection = { nodeIds: readonly string[]; connectionId: string | null };
export type CanvasViewport = { x: number; y: number; k: number };
/** 当前项目内复制的独立片段；入边可引用未复制的来源节点。 */
export type CanvasClipboardFragment = { projectId: string; nodes: CanvasNodeData[]; connections: CanvasConnection[] };
export type CanvasTransactionOptions = { selection?: CanvasSelection; viewport?: CanvasViewport };
export type CanvasSnapshot = ReadonlySnapshot<{
    projectId: string;
    revision: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selection: CanvasSelection;
    viewport: CanvasViewport;
    canUndo: boolean;
    canRedo: boolean;
}>;
export type CanvasSessionEvents = {
    "document.committed": { projectId: string; revision: number; source: CanvasChangeSource; operation: "transact" | "undo" | "redo"; removedNodeIds?: readonly string[] };
    "document.saved": { projectId: string; revision: number; source: CanvasChangeSource };
    "document.saveFailed": { projectId: string; revision: number; source: CanvasChangeSource; code: StorageError["code"] };
    "selection.changed": { projectId: string; selection: CanvasSelection; source: CanvasChangeSource };
    "viewport.changed": { projectId: string; viewport: CanvasViewport; source: CanvasChangeSource };
};

/** 网页持有的项目会话；事务先完整验证，再同步发布文档与历史。 */
export interface CanvasSession {
    readonly projectId: string;
    readonly signal: AbortSignal;
    getSnapshot(): CanvasSnapshot;
    subscribe(listener: () => void): () => void;
    on<K extends keyof CanvasSessionEvents>(event: K, handler: (payload: CanvasSessionEvents[K]) => void | Promise<void>): () => void;
    transact(ops: CanvasDocumentOp[], options: CanvasTransactionOptions & { source: CanvasChangeSource }): CanvasSnapshot;
    undo(source: CanvasChangeSource): CanvasSnapshot;
    redo(source: CanvasChangeSource): CanvasSnapshot;
    setSelection(selection: CanvasSelection, source: CanvasChangeSource): void;
    setViewport(viewport: CanvasViewport, source: CanvasChangeSource): void;
    flush(): Promise<void>;
}

export type CanvasSessionCapability = {
    snapshot(input: void, context: CapabilityCallContext): CanvasSnapshot;
    transact(input: CanvasTransactionOptions & { ops: CanvasDocumentOp[] }, context: CapabilityCallContext): Promise<CanvasSnapshot>;
    undo(input: void, context: CapabilityCallContext): CanvasSnapshot;
    redo(input: void, context: CapabilityCallContext): CanvasSnapshot;
    select(input: CanvasSelection, context: CapabilityCallContext): void;
    viewport(input: CanvasViewport, context: CapabilityCallContext): void;
    flush(input: void, context: CapabilityCallContext): Promise<void>;
};
