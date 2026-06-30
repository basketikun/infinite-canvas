import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasProject } from "../stores/use-canvas-store";

const entries = new Map<string, string>();

vi.mock("@/lib/localforage-storage", () => ({
    localForageStorage: {
        getItem: vi.fn(async (key: string) => entries.get(key) || null),
        removeItem: vi.fn(async (key: string) => {
            entries.delete(key);
        }),
        setItem: vi.fn(async (key: string, value: string) => {
            entries.set(key, value);
        }),
    },
}));

import { CANVAS_PROJECT_INDEX_KEY, CANVAS_PROJECT_KEY_PREFIX, LEGACY_CANVAS_STORE_KEY, loadCanvasProject, loadCanvasProjectIndex, loadCanvasProjects, saveCanvasProject, saveCanvasProjectIndex } from "./canvas-project-storage";

function project(id: string, title = id): CanvasProject {
    return {
        id,
        title,
        createdAt: `2026-01-0${id.length}T00:00:00.000Z`,
        updatedAt: `2026-01-0${id.length}T01:00:00.000Z`,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

describe("canvas project storage", () => {
    beforeEach(() => {
        entries.clear();
    });

    it("saves and loads a project fragment by id", async () => {
        const source = project("a", "Alpha");

        await saveCanvasProject(source);

        expect(entries.has(`${CANVAS_PROJECT_KEY_PREFIX}a`)).toBe(true);
        await expect(loadCanvasProject("a")).resolves.toEqual(source);
    });

    it("preserves project index order", async () => {
        const index = [
            { id: "b", title: "Beta", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T01:00:00.000Z" },
            { id: "a", title: "Alpha", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T01:00:00.000Z" },
        ];

        await saveCanvasProjectIndex(index);

        await expect(loadCanvasProjectIndex()).resolves.toEqual(index);
    });

    it("migrates legacy persisted projects into fragments while keeping the legacy key", async () => {
        const projects = [project("a", "Alpha"), project("b", "Beta")];
        entries.set(LEGACY_CANVAS_STORE_KEY, JSON.stringify({ state: { projects }, version: 0 }));

        await expect(loadCanvasProjects()).resolves.toEqual(projects);

        expect(entries.has(LEGACY_CANVAS_STORE_KEY)).toBe(true);
        expect(entries.has(CANVAS_PROJECT_INDEX_KEY)).toBe(true);
        expect(entries.has(`${CANVAS_PROJECT_KEY_PREFIX}a`)).toBe(true);
        expect(entries.has(`${CANVAS_PROJECT_KEY_PREFIX}b`)).toBe(true);
    });

    it("does not restore legacy projects after a split index is saved empty", async () => {
        entries.set(LEGACY_CANVAS_STORE_KEY, JSON.stringify({ state: { projects: [project("a", "Alpha")] }, version: 0 }));
        await saveCanvasProjectIndex([]);

        await expect(loadCanvasProjects()).resolves.toEqual([]);

        expect(entries.has(LEGACY_CANVAS_STORE_KEY)).toBe(true);
    });
});
