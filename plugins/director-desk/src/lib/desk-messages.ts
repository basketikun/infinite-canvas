import type { DirectorProject } from "../studio/editor/schema/directorProject";
import type { LayoutResult } from "../api/camera-layouts";

export type LayoutAction = { action: "summary" } | { action: "apply-layout"; result: LayoutResult };
export type LayoutRequest = (action: LayoutAction, signal: AbortSignal) => Promise<unknown>;

export type Scene = { project: DirectorProject; keys: string[] };
export type Attachment = { key: string; file: Blob };
export type DeskAction =
    | { action: "load" }
    | { action: "save"; scene: Scene; added: Attachment[] }
    | { action: "background" }
    | { action: "captures"; items: { file: Blob; name: string }[] }
    | { action: "recording"; file: Blob; name: string }
    | { action: "close" };
