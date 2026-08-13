import { beforeAll, describe, expect, test } from "bun:test";

import type { AppSyncTestDomainManifest, AppSyncTestDomainOptions, AppSyncTestFile } from "../app-sync";
import type { AppSyncTrashDomainKey, AppSyncTrashEntry } from "../app-sync-trash";
import type { WebdavSyncConfig } from "../../stores/use-config-store";

type AppSyncModule = typeof import("../app-sync");
type AppSyncTrashModule = typeof import("../app-sync-trash");
type WebdavSyncModule = typeof import("../webdav-sync");

let appSync: AppSyncModule;
let appSyncTrash: AppSyncTrashModule;
let webdavSync: WebdavSyncModule;

beforeAll(async () => {
    const values = new Map<string, string>();
    const storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    appSync = await import("../app-sync");
    appSyncTrash = await import("../app-sync-trash");
    webdavSync = await import("../webdav-sync");
});

type TestItem = {
    id: string;
    updatedAt: string;
    title?: string;
    storageKey?: string;
};

type TestData = {
    items: TestItem[];
};

const options = {
    key: "canvas",
    emptyData: { items: [] },
    getItems: (data: TestData) => data.items,
    makeData: (items: TestItem[]) => ({ items }),
    timeKey: "updatedAt",
} satisfies AppSyncTestDomainOptions<TestData, TestItem>;

function config(overrides: Partial<WebdavSyncConfig>): WebdavSyncConfig {
    return {
        url: "https://dav.example.com/base/",
        username: "alice",
        password: "secret",
        directory: "infinite-canvas",
        lastSyncedAt: "",
        ...overrides,
    };
}

function file(storageKey: string, path: string): AppSyncTestFile {
    return { storageKey, path, mimeType: "image/png", bytes: 12 };
}

function manifest(data: TestData, extra: Partial<AppSyncTestDomainManifest<TestData, TestItem>> = {}): AppSyncTestDomainManifest<TestData, TestItem> {
    return {
        app: "infinite-canvas",
        version: 2,
        domain: "canvas",
        exportedAt: "2026-01-01T00:00:00.000Z",
        data,
        trash: [],
        files: [],
        pendingDeletes: [],
        ...extra,
    };
}

function trash(id: string, deletedAt: string, title = id): AppSyncTrashEntry<TestItem> {
    return { id, deletedAt, item: { id, title, updatedAt: "2026-01-01T00:00:00.000Z" } };
}

function withTimeout<T>(promise: Promise<T>, ms = 1000) {
    return Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("timed out waiting for local trash queue")), ms);
        }),
    ]);
}

describe("app sync target fingerprint", () => {
    test("isolates targets and treats blank urls as no target", () => {
        expect(appSyncTrash.getAppSyncTargetFingerprint(config({ url: "   " }))).toBeNull();

        const canonical = appSyncTrash.getAppSyncTargetFingerprint(config({ url: "https://dav.example.com/base////", directory: "/infinite-canvas/", username: " alice " }));
        expect(canonical).toBe(appSyncTrash.getAppSyncTargetFingerprint(config({ url: "https://dav.example.com/base", directory: "infinite-canvas", username: "alice" })));
        expect(canonical).not.toBe(appSyncTrash.getAppSyncTargetFingerprint(config({ directory: "other" })));
        expect(canonical).not.toBe(appSyncTrash.getAppSyncTargetFingerprint(config({ username: "bob" })));
    });
});

describe("app sync manifest normalization", () => {
    test("normalizes v1 manifests to v2 without trash or pending deletes", () => {
        const normalized = appSync.__appSyncTest.normalizeDomainManifest("canvas", options.emptyData, {
            app: "infinite-canvas",
            version: 1,
            domain: "canvas",
            exportedAt: "2026-01-01T00:00:00.000Z",
            data: { items: [{ id: "live", updatedAt: "2026-01-02T00:00:00.000Z" }] },
            trash: [trash("old", "2026-01-03T00:00:00.000Z")],
            files: [file("image:live", "canvas/files/live.png")],
            pendingDeletes: [file("image:old", "canvas/files/old.png")],
        });

        expect(normalized.version).toBe(2);
        expect(normalized.trash).toEqual([]);
        expect(normalized.pendingDeletes).toEqual([]);
        expect(normalized.files).toEqual([file("image:live", "canvas/files/live.png")]);
    });

    test("rejects invalid, cross-domain, and dot-segment file paths", () => {
        const invalidPaths = ["", "assets/files/live.png", "canvas/files/..", "canvas/files/.", "canvas/files/../live.png", "canvas/files/nested/live.png", "canvas/files/live\\.png"];

        invalidPaths.forEach((path) => {
            expect(() => appSync.__appSyncTest.validateManifestFiles("canvas", [file("image:live", path)])).toThrow();
        });
    });
});

describe("app sync domain merge", () => {
    test("lets tombstones beat older live items and newer restored items beat tombstones", () => {
        const merged = appSync.__appSyncTest.mergeDomainState(
            { items: [{ id: "restored", updatedAt: "2026-01-05T00:00:00.000Z" }] },
            [trash("deleted", "2026-01-04T00:00:00.000Z")],
            manifest(
                { items: [{ id: "deleted", updatedAt: "2026-01-03T00:00:00.000Z" }] },
                { trash: [trash("restored", "2026-01-02T00:00:00.000Z")] },
            ),
            { liveIds: ["deleted", "restored"], trashIds: ["restored"], updatedAt: "2026-01-01T00:00:00.000Z" },
            options,
        );

        expect(merged.data.items.map((item) => item.id)).toEqual(["restored"]);
        expect(merged.trash.map((entry) => entry.id)).toEqual(["deleted"]);
    });
});

describe("app sync clear planning", () => {
    test("keeps restored remote live items newer than local tombstones while clearing older matches", () => {
        const clearPlan = appSync.__appSyncTest.planClearDomainState(
            manifest(
                {
                    items: [
                        { id: "keep", updatedAt: "2026-01-05T00:00:00.000Z", storageKey: "image:keep" },
                        { id: "deleted", updatedAt: "2026-01-02T00:00:00.000Z", storageKey: "image:deleted" },
                        { id: "restored", updatedAt: "2026-01-06T00:00:00.000Z", storageKey: "image:restored" },
                    ],
                },
                {
                    files: [file("image:keep", "canvas/files/keep.png"), file("image:deleted", "canvas/files/deleted.png"), file("image:restored", "canvas/files/restored.png"), file("image:orphan", "canvas/files/orphan.png")],
                    pendingDeletes: [file("image:pending", "canvas/files/pending.png"), file("image:keep", "canvas/files/keep.png")],
                },
            ),
            [trash("deleted", "2026-01-04T00:00:00.000Z"), trash("restored", "2026-01-04T00:00:00.000Z")],
            options,
        );

        expect(clearPlan.liveIds).toEqual(["keep", "restored"]);
        expect(clearPlan.activeFiles.map((item) => item.path)).toEqual(["canvas/files/keep.png", "canvas/files/restored.png"]);
        expect(clearPlan.deleteCandidates.map((item) => item.path).sort()).toEqual(["canvas/files/deleted.png", "canvas/files/orphan.png", "canvas/files/pending.png"]);
    });
});

describe("webdav delete directory validation", () => {
    test("rejects unsafe delete directories and accepts normal nested directories", () => {
        ["", "../other", "safe/../other", "safe//other", "safe\\other"].forEach((directory) => {
            expect(webdavSync.__webdavSyncTest.isSafeWebdavDirectory(directory)).toBe(false);
        });
        expect(webdavSync.__webdavSyncTest.isSafeWebdavDirectory("infinite-canvas/sub")).toBe(true);
    });
});

describe("local trash compare and merge", () => {
    test("preserves a concurrent newer tombstone during replace", () => {
        const observed = [trash("asset", "2026-01-02T00:00:00.000Z", "observed")];
        const current = [trash("asset", "2026-01-04T00:00:00.000Z", "concurrent")];
        const replacement = [trash("other", "2026-01-03T00:00:00.000Z", "replacement")];

        const merged = appSyncTrash.__appSyncTrashTest.mergeReplacementTrashEntries(replacement, observed, current);

        expect(Array.from(merged.keys()).sort()).toEqual(["asset", "other"]);
        expect(merged.get("asset")?.deletedAt).toBe("2026-01-04T00:00:00.000Z");
        expect(merged.get("asset")?.item.title).toBe("concurrent");
    });

    test("queues same-id append after replace so newer tombstone survives", async () => {
        const target = appSyncTrash.getAppSyncTargetFingerprint(config({ directory: "queue-race" }));
        if (!target) throw new Error("missing test target");
        await appSyncTrash.removeLocalAppSyncTrash(target, "canvas", ["race"]);

        const replace = appSyncTrash.replaceLocalAppSyncTrash(target, "canvas", [trash("race", "2026-01-02T00:00:00.000Z", "replace")], []);
        const append = appSyncTrash.appendAppSyncTrashEntry(target, "canvas", { id: "race", title: "append", updatedAt: "2026-01-04T00:00:00.000Z" }, "2026-01-04T00:00:00.000Z");
        await Promise.all([replace, append]);

        const entries = await appSyncTrash.listLocalAppSyncTrash<TestItem>(target, "canvas");
        expect(entries.find((entry) => entry.id === "race")?.deletedAt).toBe("2026-01-04T00:00:00.000Z");
        expect(entries.find((entry) => entry.id === "race")?.item.title).toBe("append");
        await appSyncTrash.removeLocalAppSyncTrash(target, "canvas", ["race"]);
    });

    test("resolves lists after queued append replace and remove across domains", async () => {
        const target = appSyncTrash.getAppSyncTargetFingerprint(config({ directory: "queue-list" }));
        if (!target) throw new Error("missing test target");
        const domains: AppSyncTrashDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
        await Promise.all(domains.map((domain) => appSyncTrash.removeLocalAppSyncTrash(target, domain, ["queued", "remove-only"])));

        const replace = appSyncTrash.replaceLocalAppSyncTrash(target, "canvas", [trash("queued", "2026-01-02T00:00:00.000Z", "replace")], []);
        const append = appSyncTrash.appendAppSyncTrashEntry(target, "canvas", { id: "queued", title: "append", updatedAt: "2026-01-04T00:00:00.000Z" }, "2026-01-04T00:00:00.000Z");
        const assetAppend = appSyncTrash.appendAppSyncTrashEntry(target, "assets", { id: "queued", title: "asset", updatedAt: "2026-01-03T00:00:00.000Z" }, "2026-01-03T00:00:00.000Z");
        const imageReplace = appSyncTrash.replaceLocalAppSyncTrash(target, "image-workbench", [trash("queued", "2026-01-02T00:00:00.000Z", "image")], []);
        const videoRemove = appSyncTrash.removeLocalAppSyncTrash(target, "video-workbench", ["remove-only"]);
        await Promise.all([replace, append, assetAppend, imageReplace, videoRemove]);

        const lists = await withTimeout(Promise.all(domains.map((domain) => appSyncTrash.listLocalAppSyncTrash<TestItem>(target, domain))));
        expect(lists[0].find((entry) => entry.id === "queued")?.item.title).toBe("append");
        expect(lists[1].find((entry) => entry.id === "queued")?.item.title).toBe("asset");
        expect(lists[2].find((entry) => entry.id === "queued")?.item.title).toBe("image");
        expect(lists[3]).toEqual([]);
        await Promise.all(domains.map((domain) => appSyncTrash.removeLocalAppSyncTrash(target, domain, ["queued", "remove-only"])));
    });
});
