import { useCallback, useMemo, useState } from "react";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";

export function useCanvasBffModelOptions() {
    const allProviders = useCanvasProviderStore((state) => state.providers);
    const providers = useMemo(() => allProviders.filter((provider) => provider.status === "active"), [allProviders]);
    const modelsByProvider = useCanvasProviderStore((state) => state.modelsByProvider);
    const selectedProviderId = useCanvasProviderStore((state) => state.selectedProviderId);
    const modelsLoadingProviderId = useCanvasProviderStore((state) => state.modelsLoadingProviderId);
    const loadProviders = useCanvasProviderStore((state) => state.load);
    const loadModels = useCanvasProviderStore((state) => state.loadModels);
    const [loadingPhase, setLoadingPhase] = useState<"idle" | "providers" | "models">("idle");
    const [error, setError] = useState<string | null>(null);
    const load = useCallback(async () => {
        setError(null);
        setLoadingPhase("providers");
        try {
            await loadProviders();
            const state = useCanvasProviderStore.getState();
            const current = state.providers.filter((provider) => provider.status === "active");
            if (!current.length) {
                if (state.error) throw new Error(state.error);
                return;
            }
            setLoadingPhase("models");
            const results = await Promise.allSettled(current.filter((provider) => !useCanvasProviderStore.getState().modelsByProvider[provider.id]).map((provider) => loadModels(provider.id)));
            const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
            if (failed) setError(failed.reason instanceof Error ? failed.reason.message : "Provider model list could not be loaded");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Canvas provider data could not be loaded");
        } finally {
            setLoadingPhase("idle");
        }
    }, [loadModels, loadProviders]);
    return { providers, modelsByProvider, selectedProviderId, providerLoading: loadingPhase === "providers", modelLoading: loadingPhase === "models" || Boolean(modelsLoadingProviderId), error, load };
}
