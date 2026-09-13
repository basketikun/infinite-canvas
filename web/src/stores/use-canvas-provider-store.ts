import { create } from "zustand";

import { CanvasBffError, canvasBff, type CanvasProvider, type ProviderCatalog } from "@/services/api/canvas-bff";

type ProviderInput = { name: string; providerType?: string; baseUrl?: string; model?: string; group?: string; channel?: string; catalogKeyId?: string; secret?: string };
type ProviderPatch = { name?: string; model?: string; group?: string; channel?: string; status?: "active" | "disabled" };
type StudioCapability = "image" | "video";

type CanvasProviderStore = {
    providers: CanvasProvider[];
    selectedProviderId: string | null;
    catalog: ProviderCatalog | null;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
    modelsByProvider: Record<string, string[]>;
    modelsLoadingProviderId: string | null;
    studioModels: Partial<Record<StudioCapability, string>>;
    load: () => Promise<void>;
    loadCatalog: () => Promise<void>;
    loadModels: (providerId: string) => Promise<string[]>;
    create: (input: ProviderInput) => Promise<CanvasProvider>;
    update: (providerId: string, input: ProviderPatch) => Promise<CanvasProvider>;
    remove: (providerId: string) => Promise<void>;
    select: (providerId: string) => void;
    setStudioModel: (capability: StudioCapability, value: string) => void;
    clear: () => void;
};

export const useCanvasProviderStore = create<CanvasProviderStore>()((set) => ({
    providers: [],
    selectedProviderId: null,
    catalog: null,
    status: "idle",
    error: null,
    modelsByProvider: {},
    modelsLoadingProviderId: null,
    studioModels: {},
    load: async () => {
        set({ status: "loading", error: null });
        try {
            const providers = await canvasBff.listProviders();
            set((state) => ({
                providers,
                selectedProviderId: providers.some((item) => item.id === state.selectedProviderId && item.status === "active") ? state.selectedProviderId : providers.find((item) => item.status === "active")?.id || null,
                status: "ready",
                error: null,
            }));
        } catch (error) {
            set({ status: "error", error: error instanceof Error ? error.message : "Provider list could not be loaded" });
        }
    },
    loadCatalog: async () => {
        set({ status: "loading", error: null });
        try {
            const catalog = await canvasBff.getProviderCatalog();
            set({ catalog, status: "ready", error: null });
        } catch (error) {
            const message = error instanceof CanvasBffError && error.status === 401 ? "Sub2API catalog session is unavailable" : error instanceof Error ? error.message : "Provider catalog could not be loaded";
            set({ status: "error", error: message });
        }
    },
    loadModels: async (providerId) => {
        set({ modelsLoadingProviderId: providerId, error: null });
        try {
            const models = await canvasBff.listProviderModels(providerId);
            set((state) => ({ modelsByProvider: { ...state.modelsByProvider, [providerId]: models }, modelsLoadingProviderId: state.modelsLoadingProviderId === providerId ? null : state.modelsLoadingProviderId }));
            return models;
        } catch (error) {
            set((state) => ({ modelsLoadingProviderId: state.modelsLoadingProviderId === providerId ? null : state.modelsLoadingProviderId, error: error instanceof Error ? error.message : "Provider model list could not be loaded" }));
            throw error;
        }
    },
    create: async (input) => {
        const provider = await canvasBff.createProvider(input);
        set((state) => ({ providers: [...state.providers.filter((item) => item.id !== provider.id), provider], selectedProviderId: state.selectedProviderId || provider.id, error: null }));
        return provider;
    },
    update: async (providerId, input) => {
        const provider = await canvasBff.updateProvider(providerId, input);
        set((state) => ({ providers: state.providers.map((item) => (item.id === provider.id ? provider : item)), error: null }));
        return provider;
    },
    remove: async (providerId) => {
        await canvasBff.deleteProvider(providerId);
        set((state) => ({ providers: state.providers.filter((item) => item.id !== providerId), selectedProviderId: state.selectedProviderId === providerId ? null : state.selectedProviderId, error: null }));
    },
    select: (providerId) => set((state) => ({ selectedProviderId: state.providers.some((item) => item.id === providerId && item.status === "active") ? providerId : state.selectedProviderId })),
    setStudioModel: (capability, value) => set((state) => ({ studioModels: { ...state.studioModels, [capability]: value } })),
    clear: () => set({ providers: [], selectedProviderId: null, catalog: null, modelsByProvider: {}, modelsLoadingProviderId: null, studioModels: {}, status: "idle", error: null }),
}));
