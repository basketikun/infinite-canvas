import { describe, expect, test } from "bun:test";

import { clampPageIndex, historyFocusCount, resolveActiveIndex, resolveIndexAfterDeletion, toGalleryItems, withVirtualCurrentPage, type GalleryItem } from "../node-gallery";
import type { CanvasNodeHistoryItem, CanvasNodeImage, CanvasNodeStatus } from "../../../types/canvas";

function image(id: string, status: CanvasNodeStatus, content: string): CanvasNodeImage {
    return {
        id,
        status,
        content,
        storageKey: `image:${id}`,
        naturalWidth: 1024,
        naturalHeight: 1024,
        bytes: 2048,
        mimeType: "image/png",
    };
}

function history(id: string, content: string, extras: Partial<CanvasNodeHistoryItem> = {}): CanvasNodeHistoryItem {
    return {
        id,
        content,
        storageKey: `history:${id}`,
        naturalWidth: 800,
        naturalHeight: 600,
        bytes: 1024,
        mimeType: "image/jpeg",
        durationMs: 1234,
        ...extras,
    };
}

function item(id: string, source: GalleryItem["source"], status: CanvasNodeStatus, content: string): GalleryItem {
    return { id, source, status, content };
}

describe("toGalleryItems", () => {
    test("Given images with mixed status and history entries When mapped Then preserves image status and treats history as successful content", () => {
        // Given
        const images = [image("img-loading", "loading", ""), image("img-success", "success", "data:image/png;base64,ok"), image("img-error", "error", "")];
        const historyEntries = [history("h-1", "data:image/png;base64,h1"), history("h-2", "data:image/png;base64,h2")];

        // When
        const items = toGalleryItems(images, historyEntries);

        // Then
        expect(items.length).toBe(5);
        expect(items[0]).toEqual({
            id: "img-loading",
            source: "image",
            status: "loading",
            content: "",
            storageKey: "image:img-loading",
            naturalWidth: 1024,
            naturalHeight: 1024,
            bytes: 2048,
            mimeType: "image/png",
        });
        expect(items[1].id).toBe("img-success");
        expect(items[1].source).toBe("image");
        expect(items[1].status).toBe("success");
        expect(items[1].content).toBe("data:image/png;base64,ok");
        expect(items[2].id).toBe("img-error");
        expect(items[2].source).toBe("image");
        expect(items[2].status).toBe("error");
        expect(items[3]).toEqual({
            id: "h-1",
            source: "history",
            status: "success",
            content: "data:image/png;base64,h1",
            storageKey: "history:h-1",
            naturalWidth: 800,
            naturalHeight: 600,
            bytes: 1024,
            mimeType: "image/jpeg",
            durationMs: 1234,
        });
        expect(items[4].source).toBe("history");
        expect(items[4].status).toBe("success");
    });

    test("Given only images without history When mapped Then only image items are returned", () => {
        // Given
        const images = [image("img-1", "loading", "")];

        // When
        const items = toGalleryItems(images, []);

        // Then
        expect(items.length).toBe(1);
        expect(items[0].source).toBe("image");
        expect(items[0].status).toBe("loading");
    });

    test("Given only history without images When mapped Then every entry is marked successful", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1")];

        // When
        const items = toGalleryItems([], historyEntries);

        // Then
        expect(items.length).toBe(1);
        expect(items[0].source).toBe("history");
        expect(items[0].status).toBe("success");
        expect(items[0].content).toBe("data:image/png;base64,h1");
    });

    test("Given empty inputs When mapped Then returns an empty list and does not throw", () => {
        // Given / When / Then
        expect(toGalleryItems([], [])).toEqual([]);
        expect(toGalleryItems()).toEqual([]);
        expect(toGalleryItems(undefined, undefined)).toEqual([]);
    });

    test("Given history entry without durationMs When mapped Then the duration field is undefined but other metadata is preserved", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1", { durationMs: undefined })];

        // When
        const items = toGalleryItems([], historyEntries);

        // Then
        expect(items.length).toBe(1);
        expect(items[0].durationMs).toBe(undefined);
        expect(items[0].storageKey).toBe("history:h-1");
        expect(items[0].mimeType).toBe("image/jpeg");
    });
});

describe("resolveActiveIndex", () => {
    const items: GalleryItem[] = [item("a", "image", "success", "a"), item("b", "image", "success", "b"), item("c", "history", "success", "c")];

    test("Given a primary id that exists in the list When resolved Then returns its index", () => {
        // Given / When / Then
        expect(resolveActiveIndex("b", items)).toBe(1);
        expect(resolveActiveIndex("c", items)).toBe(2);
    });

    test("Given a primary id that is missing from the list When resolved Then falls back to the first index", () => {
        // Given / When / Then
        expect(resolveActiveIndex("missing", items)).toBe(0);
    });

    test("Given an undefined primary id When resolved Then falls back to the first index", () => {
        // Given / When / Then
        expect(resolveActiveIndex(undefined, items)).toBe(0);
    });

    test("Given a single-item list When resolved Then returns 0 regardless of whether the primary id matches", () => {
        // Given
        const single = [item("solo", "image", "success", "x")];

        // When / Then
        expect(resolveActiveIndex("solo", single)).toBe(0);
        expect(resolveActiveIndex("other", single)).toBe(0);
        expect(resolveActiveIndex(undefined, single)).toBe(0);
    });

    test("Given an empty list When resolved Then returns -1 even when a primary id is supplied", () => {
        // Given / When / Then
        expect(resolveActiveIndex(undefined, [])).toBe(-1);
        expect(resolveActiveIndex("anything", [])).toBe(-1);
    });
});

describe("resolveIndexAfterDeletion", () => {
    test("Given the last item removed from a multi-item list When resolved Then falls back to the previous index", () => {
        // Given
        const items = [item("a", "image", "success", "a"), item("b", "image", "success", "b")];

        // When
        const next = resolveIndexAfterDeletion(items, 1);

        // Then
        expect(next).toBe(items.length - 1);
    });

    test("Given a middle item removed When resolved Then the next item slides into the same slot", () => {
        // Given
        const items = [item("a", "image", "success", "a"), item("b", "image", "success", "b"), item("c", "image", "success", "c")];

        // When
        const next = resolveIndexAfterDeletion(items, 1);

        // Then
        expect(next).toBe(1);
    });

    test("Given the first item removed When resolved Then the next item slides into slot 0", () => {
        // Given
        const items = [item("b", "image", "success", "b"), item("c", "image", "success", "c")];

        // When
        const next = resolveIndexAfterDeletion(items, 0);

        // Then
        expect(next).toBe(0);
    });

    test("Given an empty list When resolved Then returns -1 regardless of removedIndex", () => {
        // Given / When / Then
        expect(resolveIndexAfterDeletion([], 0)).toBe(-1);
        expect(resolveIndexAfterDeletion([], 5)).toBe(-1);
        expect(resolveIndexAfterDeletion([], -3)).toBe(-1);
    });

    test("Given a single-item list When resolved Then returns 0 because the surviving item owns the only slot", () => {
        // Given
        const items = [item("solo", "image", "success", "x")];

        // When / Then
        expect(resolveIndexAfterDeletion(items, 0)).toBe(0);
    });

    test("Given an out-of-range removedIndex When resolved Then clamps to the nearest valid index", () => {
        // Given
        const items = [item("a", "image", "success", "a"), item("b", "image", "success", "b")];

        // When / Then
        expect(resolveIndexAfterDeletion(items, 99)).toBe(items.length - 1);
        expect(resolveIndexAfterDeletion(items, -5)).toBe(0);
    });
});

describe("clampPageIndex", () => {
    test("Given an index within the range When clamped Then returns the same index", () => {
        // Given / When / Then
        expect(clampPageIndex(0, 5)).toBe(0);
        expect(clampPageIndex(2, 5)).toBe(2);
        expect(clampPageIndex(4, 5)).toBe(4);
    });

    test("Given a negative index When clamped Then returns 0", () => {
        // Given / When / Then
        expect(clampPageIndex(-1, 5)).toBe(0);
        expect(clampPageIndex(-100, 5)).toBe(0);
    });

    test("Given an index past the end When clamped Then returns the last valid index", () => {
        // Given / When / Then
        expect(clampPageIndex(10, 5)).toBe(4);
        expect(clampPageIndex(5, 5)).toBe(4);
    });

    test("Given an empty list When clamped Then returns 0 regardless of the input index", () => {
        // Given / When / Then
        expect(clampPageIndex(0, 0)).toBe(0);
        expect(clampPageIndex(5, 0)).toBe(0);
        expect(clampPageIndex(-1, 0)).toBe(0);
    });

    test("Given a single-item list When clamped Then every index collapses to 0", () => {
        // Given / When / Then
        expect(clampPageIndex(0, 1)).toBe(0);
        expect(clampPageIndex(5, 1)).toBe(0);
        expect(clampPageIndex(-5, 1)).toBe(0);
    });

    test("Given a non-integer index When clamped Then truncates to the nearest valid index", () => {
        // Given / When / Then
        expect(clampPageIndex(2.7, 5)).toBe(2);
        expect(clampPageIndex(4.9, 5)).toBe(4);
    });
});

describe("withVirtualCurrentPage", () => {
    test("Given primaryHistoryId absent and current content exists When built Then appends a virtual page and marks it active", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1"), history("h-2", "data:image/png;base64,h2")];

        // When
        const { items, activeId } = withVirtualCurrentPage(historyEntries, undefined, "current draft", "virtual");

        // Then
        expect(items.length).toBe(3);
        expect(items[2].id).toBe("virtual");
        expect(items[2].source).toBe("history");
        expect(items[2].status).toBe("success");
        expect(items[2].content).toBe("current draft");
        expect(activeId).toBe("virtual");
    });

    test("Given primaryHistoryId present in history When built Then no virtual page is added and activeId is the primary", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1"), history("h-2", "data:image/png;base64,h2")];

        // When
        const { items, activeId } = withVirtualCurrentPage(historyEntries, "h-1", "current draft", "virtual");

        // Then
        expect(items.length).toBe(2);
        expect(items.some((item) => item.id === "virtual")).toBe(false);
        expect(activeId).toBe("h-1");
    });

    test("Given primaryHistoryId set but not in history and current content exists When built Then appends virtual page and marks it active", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1")];

        // When
        const { items, activeId } = withVirtualCurrentPage(historyEntries, "missing-id", "current draft", "virtual");

        // Then
        expect(items.length).toBe(2);
        expect(items[1].id).toBe("virtual");
        expect(activeId).toBe("virtual");
    });

    test("Given no current content When built Then no virtual page is added and activeId is the primary", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1")];

        // When
        const { items, activeId } = withVirtualCurrentPage(historyEntries, undefined, undefined, "virtual");

        // Then
        expect(items.length).toBe(1);
        expect(activeId).toBe(undefined);
    });

    test("Given empty history and current content When built Then a single virtual page is returned as active", () => {
        // Given / When
        const { items, activeId } = withVirtualCurrentPage([], undefined, "current draft", "virtual");

        // Then
        expect(items.length).toBe(1);
        expect(items[0].id).toBe("virtual");
        expect(activeId).toBe("virtual");
    });

    test("Given primaryHistoryId absent and currentContent is empty string When built Then appends a virtual blank draft page and marks it active", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1")];

        // When
        const { items, activeId } = withVirtualCurrentPage(historyEntries, undefined, "", "virtual");

        // Then
        expect(items.length).toBe(2);
        expect(items[1].id).toBe("virtual");
        expect(items[1].content).toBe("");
        expect(activeId).toBe("virtual");
    });

    test("Given currentContent is undefined When built Then no virtual page is added even if primary is absent", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1")];

        // When
        const { items, activeId } = withVirtualCurrentPage(historyEntries, undefined, undefined, "virtual");

        // Then
        expect(items.length).toBe(1);
        expect(items.some((item) => item.id === "virtual")).toBe(false);
        expect(activeId).toBe(undefined);
    });
});

describe("historyFocusCount", () => {
    test("Given primary absent and current content exists When counted Then includes the virtual page", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1"), history("h-2", "data:image/png;base64,h2")];

        // When / Then
        expect(historyFocusCount(historyEntries, undefined, "current draft")).toBe(3);
    });

    test("Given primary present in history When counted Then does not add a virtual page", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1"), history("h-2", "data:image/png;base64,h2")];

        // When / Then
        expect(historyFocusCount(historyEntries, "h-1", "current draft")).toBe(2);
    });

    test("Given no current content When counted Then equals history length", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1")];

        // When / Then
        expect(historyFocusCount(historyEntries, undefined, undefined)).toBe(1);
    });

    test("Given primary absent and currentContent is empty string When counted Then includes the virtual blank draft page", () => {
        // Given
        const historyEntries = [history("h-1", "data:image/png;base64,h1")];

        // When / Then
        expect(historyFocusCount(historyEntries, undefined, "")).toBe(2);
    });
});
