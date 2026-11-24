import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PluginPanel } from "@infinite-canvas/plugin-sdk";
import type { RegisteredContribution, ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { InstalledPlugin, PluginErrorCode, PluginRuntimeStatus } from "@infinite-canvas/shared/plugins";

type OpenPluginPanel = {
    id: string;
    entry: RegisteredContribution<PluginPanel>;
    project: ScopeBinding;
    scope: PluginScope;
    binding: ScopeBinding;
    signal: AbortSignal;
    close(): void;
    canRestoreFocus(): boolean;
};

let panelSequence = 0;

export const usePluginStore = create<{
    plugins: InstalledPlugin[];
    states: Record<string, { status: PluginRuntimeStatus; error?: PluginErrorCode }>;
    revision: number;
    canvasRevision: number;
    panel: OpenPluginPanel | null;
    openPanel: (entry: RegisteredContribution<PluginPanel>, project: ScopeBinding) => OpenPluginPanel;
    layoutSelection: string | null;
}>()(persist((set, get) => ({
    plugins: [], states: {}, revision: 0, canvasRevision: 0, panel: null, layoutSelection: null,
    openPanel: (entry, project) => {
        entry.assertActive();
        project.signal.throwIfAborted();
        if (project.kind !== "project" || !project.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const scope = new PluginScope();
        const sequence = ++panelSequence;
        const owner = AbortSignal.any([project.signal, entry.signal]);
        const record: OpenPluginPanel = {
            id: entry.id, entry, project, scope, signal: scope.signal,
            binding: Object.freeze({ ...project, kind: "view", viewId: `panel:${entry.id}:${sequence}`, signal: scope.signal }),
            close() {
                if (scope.signal.aborted) return;
                owner.removeEventListener("abort", record.close);
                void scope.close().catch((error) => console.error(`[plugins] ${entry.id} panel cleanup`, error));
                if (get().panel === record) set({ panel: null });
            },
            canRestoreFocus: () => sequence === panelSequence && !get().panel && !owner.aborted,
        };
        owner.addEventListener("abort", record.close, { once: true });
        get().panel?.close();
        if (sequence === panelSequence && !scope.signal.aborted) set({ panel: record });
        else record.close();
        return record;
    },
}), {
    name: "infinite-canvas:plugin-selection",
    partialize: ({ layoutSelection }) => ({ layoutSelection }),
}));
