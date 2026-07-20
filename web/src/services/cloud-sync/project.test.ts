import { expect, test } from "bun:test";
import { collectProjectStorageKeys, createProjectSnapshot } from "./project";

test("画布快照保留节点、连线和会话，并收集媒体键", () => {
    const project = { id: "p1", title: "画布", nodes: [{ id: "n1", metadata: { storageKey: "image:one" } }], connections: [{ id: "c1" }], chatSessions: [{ id: "s1", attachments: [{ storageKey: "video:two" }] }], activeChatId: "s1", backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, createdAt: "a", updatedAt: "b" } as never;
    expect(createProjectSnapshot(project)).toEqual(project);
    expect(collectProjectStorageKeys(project)).toEqual(["image:one", "video:two"]);
});
