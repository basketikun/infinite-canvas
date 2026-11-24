import type { ModelAdapter } from "./types";

export let models: ModelAdapter;

export function initializeModels(adapter: ModelAdapter) {
    if (models) throw new Error("MODELS_ALREADY_INITIALIZED");
    models = adapter;
}
