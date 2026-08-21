export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    /** Frame slot on a video generation node: "first" (首帧) or "last" (尾帧). Undefined for generic references. */
    slot?: "first" | "last";
};
