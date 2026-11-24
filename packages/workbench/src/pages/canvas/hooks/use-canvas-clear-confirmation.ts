import { useLayoutEffect, useState } from "react";
import { canvasClear } from "@infinite-canvas/plugin-sdk/builtin";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { bindHostActions } from "@workbench/lib/canvas/host-actions";

export type CanvasClearConfirmationRecord = {
    scope: ScopeBinding;
    pending: boolean;
    confirm: () => Promise<void>;
    close: () => void;
};

export function registerCanvasClearConfirmation(session: CanvasSession, onChange: (record: CanvasClearConfirmationRecord | null) => void) {
    let current: CanvasClearConfirmationRecord | null = null;
    const dispose = bindHostActions(session, {
        canvasOpenClearConfirmation: (_, context) => {
            context.signal.throwIfAborted();
            if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            current?.close();
            const controller = new AbortController();
            const scope = Object.freeze({ ...context.scope, signal: AbortSignal.any([context.signal, session.signal, controller.signal]) });
            scope.signal.throwIfAborted();
            const record: CanvasClearConfirmationRecord = {
                scope,
                pending: false,
                confirm: async () => {
                    if (current !== record || scope.signal.aborted) throw new PluginError("PLUGIN_INACTIVE");
                    if (record.pending) return;
                    record.pending = true;
                    onChange({ ...record });
                    try {
                        await executeCommand(canvasClear, undefined, { session, scope, signal: scope.signal });
                        if (current === record && !scope.signal.aborted) record.close();
                    } catch (error) {
                        if (current === record && !scope.signal.aborted) {
                            record.pending = false;
                            onChange({ ...record });
                        }
                        throw error;
                    }
                },
                close: () => {
                    scope.signal.removeEventListener("abort", record.close);
                    controller.abort();
                    if (current !== record) return;
                    current = null;
                    onChange(null);
                },
            };
            scope.signal.addEventListener("abort", record.close, { once: true });
            current = record;
            onChange({ ...record });
        },
    });
    return () => { dispose(); current?.close(); };
}

export function useCanvasClearConfirmation(session: CanvasSession) {
    const [record, setRecord] = useState<CanvasClearConfirmationRecord | null>(null);
    useLayoutEffect(() => registerCanvasClearConfirmation(session, setRecord), [session]);
    return record;
}
