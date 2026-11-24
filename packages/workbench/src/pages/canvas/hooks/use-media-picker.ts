import { useLayoutEffect } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { canvasImportMedia } from "@infinite-canvas/plugin-sdk/builtin";
import type { Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { bindHostActions } from "@workbench/lib/canvas/host-actions";
import { registerChangedCanvasAssets } from "@workbench/lib/canvas/register-canvas-asset";

export function registerMediaPicker(session: CanvasSession, reportError: (message: string) => void, getPosition: () => Position) {
    const active = new Set<() => void>();
    let pending: (() => void) | undefined;
    const dispose = bindHostActions(session, {
        canvasOpenMediaPicker: ({ nodeId, position = getPosition() }, context) => {
            pending?.();
            const controller = new AbortController();
            const signal = AbortSignal.any([context.signal, session.signal, controller.signal]);
            const scope = Object.freeze({ ...context.scope, signal });
            signal.throwIfAborted();
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.accept = "image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";
            input.hidden = true;
            const removeInput = () => {
                input.removeEventListener("change", select);
                input.removeEventListener("cancel", cancel);
                input.remove();
            };
            const release = () => {
                removeInput();
                unsubscribe();
                signal.removeEventListener("abort", release);
                active.delete(cancel);
                if (pending === cancel) pending = undefined;
            };
            const cancel = () => { controller.abort(new PluginError("PLUGIN_SCOPE_CLOSED")); };
            const select = () => {
                if (pending !== cancel || signal.aborted) return;
                const files = Array.from(input.files ?? []);
                if (!files.length) { cancel(); return; }
                pending = undefined;
                removeInput();
                const before = session.getSnapshot().nodes;
                void executeCommand(canvasImportMedia, { nodeId, position, files }, { scope, session }).then((snapshot) => {
                    if (!signal.aborted) registerChangedCanvasAssets(before, snapshot.nodes);
                }).catch((error) => {
                    if (!signal.aborted) {
                        console.error("[canvas] media picker import", nodeId, error);
                        reportError(getPluginErrorMessage(error));
                    }
                }).finally(release);
            };
            const unsubscribe = session.subscribe(() => {
                if (nodeId !== undefined && !session.getSnapshot().nodes.some((node) => node.id === nodeId)) controller.abort(new PluginError("PLUGIN_NOT_FOUND"));
            });
            signal.addEventListener("abort", release, { once: true });
            input.addEventListener("change", select);
            input.addEventListener("cancel", cancel);
            active.add(cancel);
            pending = cancel;
            try {
                document.body.append(input);
                input.click();
            } catch (error) {
                cancel();
                throw error;
            }
        },
    });
    return () => { dispose(); for (const cancel of active) cancel(); };
}

export function useMediaPicker(session: CanvasSession, getPosition: (() => Position) | undefined) {
    useLayoutEffect(() => {
        if (!getPosition) return;
        return registerMediaPicker(session, (text) => { toast.error(text, workbenchMessageOptions.error); }, getPosition);
    }, [session, getPosition]);
}
