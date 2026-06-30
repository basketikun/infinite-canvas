import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasProject } from "./use-canvas-store";

const storage = vi.hoisted(() => ({
    loadCanvasProjects: vi.fn(async () => []),
    replaceCanvasProjects: vi.fn(async (_projects: CanvasProject[]) => {}),
    saveCanvasProjects: vi.fn(async (_nextProjects: CanvasProject[], _previousProjects?: CanvasProject[]) => {}),
}));

vi.mock("../storage/canvas-project-storage", () => ({
    LEGACY_CANVAS_STORE_KEY: "test:canvas_store",
    loadCanvasProjects: storage.loadCanvasProjects,
    replaceCanvasProjects: storage.replaceCanvasProjects,
    saveCanvasProjects: storage.saveCanvasProjects,
}));

import { useCanvasStore } from "./use-canvas-store";

function project(id: string, updatedAt = "2026-01-01T00:00:00.000Z"): CanvasProject {
    return {
        id,
        title: id,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

describe("useCanvasStore", () => {
    beforeEach(async () => {
        await Promise.resolve();
        vi.useRealTimers();
        useCanvasStore.setState({ hydrated: true, projects: [] });
        vi.clearAllMocks();
    });

    it("writes replaced WebDAV projects to split storage before resolving", async () => {
        const projects = [project("remote-a"), project("remote-b")];

        await useCanvasStore.getState().replaceProjects(projects);

        expect(storage.replaceCanvasProjects).toHaveBeenCalledWith(projects);
        expect(useCanvasStore.getState().projects).toEqual(projects);
    });

    it("does not leave a debounced canvas save after replacing projects", async () => {
        vi.useFakeTimers();
        const projects = [project("remote-a")];

        await useCanvasStore.getState().replaceProjects(projects);
        await vi.advanceTimersByTimeAsync(450);

        expect(storage.saveCanvasProjects).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
