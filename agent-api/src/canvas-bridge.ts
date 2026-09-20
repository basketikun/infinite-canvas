import crypto from "node:crypto";

import { AppError } from "./errors.js";
import type { JsonObject, RequestContext } from "./types.js";

type Snapshot = {
    ctx: RequestContext;
    clientId: string;
    revision: number;
    value: JsonObject;
};

type PendingMutation = {
    ctx: RequestContext;
    resolve: (value: JsonObject) => void;
    reject: (error: Error) => void;
};

export class CanvasBridge {
    private readonly snapshots = new Map<string, Snapshot>();
    private readonly pending = new Map<string, PendingMutation>();

    publishSnapshot(ctx: RequestContext, clientId: string, revision: number, value: JsonObject) {
        const current = this.snapshots.get(ctx.canvasWorkspaceId);
        if (!current || revision >= current.revision) this.snapshots.set(ctx.canvasWorkspaceId, { ctx, clientId, revision, value: structuredClone(value) });
    }

    readSnapshot(ctx: RequestContext) {
        const snapshot = this.snapshots.get(ctx.canvasWorkspaceId);
        if (!snapshot || !sameScope(snapshot.ctx, ctx)) throw new AppError("当前项目没有在线画布快照", 409, "canvas_not_connected");
        return { revision: snapshot.revision, snapshot: structuredClone(snapshot.value) };
    }

    requestMutation(ctx: RequestContext, signal: AbortSignal) {
        this.readSnapshot(ctx);
        const callId = crypto.randomUUID();
        const result = new Promise<JsonObject>((resolve, reject) => {
            this.pending.set(callId, { ctx, resolve, reject });
            signal.addEventListener("abort", () => {
                if (!this.pending.delete(callId)) return;
                reject(new AppError("运行已停止", 409, "run_aborted"));
            }, { once: true });
        });
        return { callId, result };
    }

    completeMutation(ctx: RequestContext, callId: string, result: JsonObject) {
        const mutation = this.pending.get(callId);
        if (!mutation || !sameScope(mutation.ctx, ctx)) throw new AppError("找不到画布工具调用", 404, "canvas_tool_call_not_found");
        this.pending.delete(callId);
        mutation.resolve(structuredClone(result));
    }
}

function sameScope(left: RequestContext, right: RequestContext) {
    return left.userId === right.userId && left.projectId === right.projectId && left.canvasWorkspaceId === right.canvasWorkspaceId;
}
