import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";

export const formats = { html: "HTML", markdown: "Markdown", svg: "SVG" } as const;
export type Format = keyof typeof formats;
export const formatOf = (node: ReadonlyCanvasNode) => (node.metadata?.format ?? "markdown") as Format;
