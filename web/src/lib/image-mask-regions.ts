export type MaskRegion = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};

type MaskRegionOptions = {
    alphaThreshold?: number;
    maxDimension?: number;
    minAreaRatio?: number;
    maxRegions?: number;
    padding?: number;
};

const DEFAULT_OPTIONS: Required<MaskRegionOptions> = {
    alphaThreshold: 1,
    maxDimension: 256,
    minAreaRatio: 0.0005,
    maxRegions: 8,
    padding: 0.01,
};

export function extractMaskRegionsFromCanvas(canvas: HTMLCanvasElement, options?: MaskRegionOptions) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return extractMaskRegions(image.data, image.width, image.height, options);
}

export function extractMaskRegions(rgba: ArrayLike<number>, width: number, height: number, options?: MaskRegionOptions): MaskRegion[] {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length < width * height * 4) return [];

    const settings = { ...DEFAULT_OPTIONS, ...options };
    const scale = Math.min(1, settings.maxDimension / Math.max(width, height));
    const gridWidth = Math.max(1, Math.ceil(width * scale));
    const gridHeight = Math.max(1, Math.ceil(height * scale));
    const occupied = new Uint8Array(gridWidth * gridHeight);

    for (let y = 0; y < height; y += 1) {
        const gridY = Math.min(gridHeight - 1, Math.floor((y / height) * gridHeight));
        for (let x = 0; x < width; x += 1) {
            if (rgba[(y * width + x) * 4 + 3] < settings.alphaThreshold) continue;
            const gridX = Math.min(gridWidth - 1, Math.floor((x / width) * gridWidth));
            occupied[gridY * gridWidth + gridX] = 1;
        }
    }

    const visited = new Uint8Array(occupied.length);
    const minimumArea = Math.max(1, Math.ceil(gridWidth * gridHeight * settings.minAreaRatio));
    const boxes: Array<{ minX: number; minY: number; maxX: number; maxY: number; area: number }> = [];

    for (let start = 0; start < occupied.length; start += 1) {
        if (!occupied[start] || visited[start]) continue;
        const queue = [start];
        visited[start] = 1;
        let cursor = 0;
        let area = 0;
        let minX = gridWidth;
        let minY = gridHeight;
        let maxX = 0;
        let maxY = 0;

        while (cursor < queue.length) {
            const index = queue[cursor++];
            const x = index % gridWidth;
            const y = Math.floor(index / gridWidth);
            area += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);

            for (const neighbor of neighbors(x, y, gridWidth, gridHeight)) {
                if (!occupied[neighbor] || visited[neighbor]) continue;
                visited[neighbor] = 1;
                queue.push(neighbor);
            }
        }

        boxes.push({ minX, minY, maxX, maxY, area });
    }

    const padding = Math.round(settings.padding * 999);
    const significantBoxes = boxes.filter((box) => box.area >= minimumArea);
    const selectedBoxes = significantBoxes.length
        ? significantBoxes
        : boxes
              .slice()
              .sort((a, b) => b.area - a.area)
              .slice(0, 1);
    const regions = selectedBoxes
        .sort((a, b) => b.area - a.area)
        .map((box) => ({
            x1: clampCoordinate(Math.floor((box.minX / gridWidth) * 1000) - padding),
            y1: clampCoordinate(Math.floor((box.minY / gridHeight) * 1000) - padding),
            x2: clampCoordinate(Math.ceil(((box.maxX + 1) / gridWidth) * 1000) + padding),
            y2: clampCoordinate(Math.ceil(((box.maxY + 1) / gridHeight) * 1000) + padding),
        }))
        .map(ensureNonEmptyRegion);
    const merged = mergeNearbyRegions(regions, 8);
    return merged.length > settings.maxRegions ? [unionRegions(merged)] : merged;
}

export function formatSeedreamRegions(regions: MaskRegion[]) {
    return regions.map((region) => `<bbox>${region.x1} ${region.y1} ${region.x2} ${region.y2}</bbox>`).join("、");
}

function neighbors(x: number, y: number, width: number, height: number) {
    const result: number[] = [];
    if (x > 0) result.push(y * width + x - 1);
    if (x + 1 < width) result.push(y * width + x + 1);
    if (y > 0) result.push((y - 1) * width + x);
    if (y + 1 < height) result.push((y + 1) * width + x);
    return result;
}

function mergeNearbyRegions(regions: MaskRegion[], gap: number) {
    const pending = [...regions];
    const merged: MaskRegion[] = [];
    while (pending.length) {
        let current = pending.shift()!;
        for (let index = pending.length - 1; index >= 0; index -= 1) {
            if (!regionsTouch(current, pending[index], gap)) continue;
            current = unionRegions([current, pending[index]]);
            pending.splice(index, 1);
        }
        merged.push(current);
    }
    return merged;
}

function regionsTouch(a: MaskRegion, b: MaskRegion, gap: number) {
    return a.x1 <= b.x2 + gap && a.x2 + gap >= b.x1 && a.y1 <= b.y2 + gap && a.y2 + gap >= b.y1;
}

function unionRegions(regions: MaskRegion[]): MaskRegion {
    return {
        x1: Math.min(...regions.map((region) => region.x1)),
        y1: Math.min(...regions.map((region) => region.y1)),
        x2: Math.max(...regions.map((region) => region.x2)),
        y2: Math.max(...regions.map((region) => region.y2)),
    };
}

function ensureNonEmptyRegion(region: MaskRegion): MaskRegion {
    return {
        ...region,
        x2: Math.max(region.x1 + 1, region.x2),
        y2: Math.max(region.y1 + 1, region.y2),
    };
}

function clampCoordinate(value: number) {
    return Math.max(0, Math.min(999, value));
}
