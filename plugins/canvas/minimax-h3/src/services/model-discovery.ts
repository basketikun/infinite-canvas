import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";
export type H3ModelCatalog = { models: string[]; loras: string[] };
export function discoverH3Models(ctx: CanvasNodeContext): Promise<H3ModelCatalog> { return ctx.ai.listLocalH3Models().catch(() => ({ models: [], loras: [] })); }
export function mergeH3Options<T extends { value: string }>(builtIns: T[], discovered: string[], label = (value: string) => value.replace(/^.*[\\/]/, "")) { return [...builtIns, ...discovered.filter((value) => !builtIns.some((option) => option.value === value)).map((value) => ({ value, label: label(value) }))]; }
