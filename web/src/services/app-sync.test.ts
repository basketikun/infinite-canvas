import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";

const mocks = vi.hoisted(() => {
    const project: CanvasProject = {
        id: "canvas-a",
        title: "Canvas A",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T01:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
    return {
        project,
        uploads: [] as Array<{ path: string; file: Blob; contentType?: string }>,
        useCanvasStore: {
            getState: vi.fn(() => ({ hydrated: true, projects: [project], replaceProjects: vi.fn(async () => {}) })),
            subscribe: vi.fn(),
        },
        useAssetStore: {
            getState: vi.fn(() => ({ hydrated: true, assets: [], replaceAssets: vi.fn() })),
            subscribe: vi.fn(),
        },
        logStore: {
            list: vi.fn(async () => []),
            replace: vi.fn(async () => {}),
        },
        downloadWebdavFile: vi.fn(async () => null),
        uploadWebdavFile: vi.fn(async (_config: WebdavSyncConfig, path: string, file: Blob, contentType?: string) => {
            mocks.uploads.push({ path, file, contentType });
        }),
    };
});

vi.mock("@/app/(user)/canvas/stores/use-canvas-store", () => ({
    useCanvasStore: mocks.useCanvasStore,
}));

vi.mock("@/stores/use-asset-store", () => ({
    useAssetStore: mocks.useAssetStore,
}));

vi.mock("@/services/webdav-sync", () => ({
    WEBDAV_MANIFEST_FILE_NAME: "manifest.json",
    downloadWebdavFile: mocks.downloadWebdavFile,
    uploadWebdavFile: mocks.uploadWebdavFile,
}));

vi.mock("@/services/file-storage", () => ({
    getMediaBlob: vi.fn(async () => null),
    resolveMediaUrl: vi.fn(async (_storageKey: string, fallback: string) => fallback),
    setMediaBlob: vi.fn(async () => {}),
}));

vi.mock("@/services/image-storage", () => ({
    getImageBlob: vi.fn(async () => null),
    resolveImageUrl: vi.fn(async (_storageKey: string, fallback: string) => fallback),
    setImageBlob: vi.fn(async () => {}),
}));

vi.mock("@/services/workbench/log-store", () => ({
    IMAGE_GENERATION_LOG_STORE_NAME: "image-generation-logs",
    VIDEO_GENERATION_LOG_STORE_NAME: "video-generation-logs",
    createWorkbenchLogStore: vi.fn(() => mocks.logStore),
}));

import { syncAppDataToWebdav } from "./app-sync";

const config: WebdavSyncConfig = {
    proxyMode: "direct",
    url: "https://webdav.example.test",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

describe("syncAppDataToWebdav", () => {
    beforeEach(() => {
        mocks.uploads.length = 0;
        vi.clearAllMocks();
    });

    it("keeps canvas manifest data as a projects array", async () => {
        await syncAppDataToWebdav(config);

        const upload = mocks.uploads.find((item) => item.path === "canvas/manifest.json");
        expect(upload).toBeDefined();
        const manifest = JSON.parse(await readBlobText(upload!.file)) as { data: unknown };

        expect(manifest.data).toEqual({ projects: [mocks.project] });
        expect(Object.keys(manifest.data as Record<string, unknown>)).toEqual(["projects"]);
    });
});

function readBlobText(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}
