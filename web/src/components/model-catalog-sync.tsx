"use client";

import { useEffect } from "react";

import { fetchModelCatalog } from "@/services/model-catalog";
import { applyModelCatalog, useConfigStore } from "@/stores/use-config-store";

export function ModelCatalogSync() {
    const setConfig = useConfigStore((state) => state.setConfig);

    useEffect(() => {
        const controller = new AbortController();
        void fetchModelCatalog(controller.signal)
            .then((catalog) => {
                if (controller.signal.aborted) return;
                setConfig(applyModelCatalog(useConfigStore.getState().config, catalog));
            })
            .catch((error) => {
                if (!controller.signal.aborted) console.error("Canvas model catalog sync failed", error instanceof Error ? error.message : "unknown error");
            });
        return () => controller.abort();
    }, [setConfig]);

    return null;
}
