import { useLayoutEffect, useState } from "react";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { workspaceBinding } from "@workbench/lib/plugins/registry";

export function usePluginViewScope(viewId: string, projectId?: string, parentSignal?: AbortSignal) {
    const [binding, setBinding] = useState<ScopeBinding | null>(null);
    useLayoutEffect(() => {
        const controller = new AbortController();
        const close = () => controller.abort();
        parentSignal?.addEventListener("abort", close, { once: true });
        if (parentSignal?.aborted) close();
        setBinding({ ...workspaceBinding, kind: "view", viewId, projectId, signal: controller.signal });
        return () => { parentSignal?.removeEventListener("abort", close); controller.abort(); };
    }, [viewId, projectId, parentSignal]);
    return binding?.viewId === viewId && binding.projectId === projectId && !binding.signal.aborted && !parentSignal?.aborted ? binding : null;
}
