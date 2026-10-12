import { create } from "zustand";
import { createJSONStorage, persist, type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasWorkflowTemplate } from "@/types/canvas-workflow-template";

type WorkflowTemplateStore = {
    hydrated: boolean;
    templates: CanvasWorkflowTemplate[];
    saveTemplate: (template: CanvasWorkflowTemplate) => void;
    deleteTemplate: (id: string) => void;
};

export const useCanvasWorkflowTemplateStore = create<WorkflowTemplateStore>()(
    persist(
        (set) => ({
            hydrated: false,
            templates: [],
            saveTemplate: (template) => set((state) => ({ templates: [template, ...state.templates.filter((item) => item.id !== template.id)] })),
            deleteTemplate: (id) => {
                set((state) => ({ templates: state.templates.filter((item) => item.id !== id) }));
                void import("@/stores/use-asset-store").then(({ useAssetStore }) => useAssetStore.getState().cleanupImages());
            },
        }),
        {
            name: "infinite-canvas:workflow_templates",
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ templates: state.templates }) as StorageValue<WorkflowTemplateStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasWorkflowTemplateStore.setState({ hydrated: true });
                void import("@/stores/use-asset-store").then(({ useAssetStore }) => useAssetStore.getState().cleanupImages());
            },
        },
    ),
);
