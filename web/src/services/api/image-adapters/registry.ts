import type { ImageAdapter } from "./types";
import { gptImage2Adapter } from "./gpt-image-2";
import { seedreamAdapter } from "./seedream";

const registry = new Map<string, ImageAdapter>();

export function registerAdapter(adapter: ImageAdapter) {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: string): ImageAdapter | undefined {
  return registry.get(id);
}

/** Resolve the correct adapter for a given model name (auto-detect). */
export function resolveAdapter(model: string): ImageAdapter {
  const lower = model.toLowerCase();
  if (lower.includes("seedream")) return seedreamAdapter;
  return gptImage2Adapter;
}

export function listAdapters(): ImageAdapter[] {
  return Array.from(registry.values());
}

// Register built-in adapters
registerAdapter(gptImage2Adapter);
registerAdapter(seedreamAdapter);
