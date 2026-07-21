import { expect, test } from "bun:test";
import { collectProjectStorageKeys, createCloudMediaManifest, createCloudProjectPayload, createProjectSnapshot, parseCloudProjectPayload } from "./project";

test("画布快照保留节点、连线和会话，并收集媒体键", () => {
    const project = {
        id: "p1",
        title: "画布",
        nodes: [{ id: "n1", metadata: { storageKey: "image:one" } }],
        connections: [{ id: "c1" }],
        chatSessions: [{ id: "s1", attachments: [{ storageKey: "video:two" }] }],
        activeChatId: "s1",
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        createdAt: "a",
        updatedAt: "b",
    } as never;
    expect(createProjectSnapshot(project)).toEqual(project);
    expect(collectProjectStorageKeys(project)).toEqual(["image:one", "video:two"]);
});

test("云端画布负载保存媒体摘要并兼容早期裸画布快照", () => {
    const project = { id: "p1", title: "画布" } as never;
    const media = [{ storageKey: "image:one", sha256: "abc", mimeType: "image/png", bytes: 3 }];
    expect(createCloudProjectPayload(project, media)).toEqual({ project, media });
    expect(parseCloudProjectPayload({ project, media })).toEqual({ project, media });
    expect(parseCloudProjectPayload(project)).toEqual({ project, media: [] });
});

test("云端媒体清单为每个引用的本地对象计算 SHA-256", async () => {
    const project = { nodes: [{ metadata: { storageKey: "image:one" } }], chatSessions: [{ attachments: [{ storageKey: "video:two" }] }] } as never;
    const blobs = new Map([
        ["image:one", new Blob(["abc"], { type: "image/png" })],
        ["video:two", new Blob(["def"], { type: "video/mp4" })],
    ]);
    await expect(createCloudMediaManifest(project, async (key) => blobs.get(key) || null)).resolves.toEqual([
        { storageKey: "image:one", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", mimeType: "image/png", bytes: 3 },
        { storageKey: "video:two", sha256: "cb8379ac2098aa165029e3938a51da0bcecfc008fd6795f401178647f96c5b34", mimeType: "video/mp4", bytes: 3 },
    ]);
});
