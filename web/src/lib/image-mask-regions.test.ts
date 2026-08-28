import { describe, expect, it } from "vitest";

import { extractMaskRegions, formatSeedreamRegions } from "./image-mask-regions";

function rgbaMask(width: number, height: number, points: Array<[number, number]>) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of points) data[(y * width + x) * 4 + 3] = 255;
    return data;
}

describe("mask region extraction", () => {
    it("returns no regions for an empty mask", () => {
        expect(extractMaskRegions(rgbaMask(8, 8, []), 8, 8)).toEqual([]);
    });

    it("normalizes a selected area into Seedream coordinates", () => {
        const points: Array<[number, number]> = [];
        for (let y = 2; y < 6; y += 1) {
            for (let x = 2; x < 6; x += 1) points.push([x, y]);
        }
        const regions = extractMaskRegions(rgbaMask(8, 8, points), 8, 8, { padding: 0 });

        expect(regions).toEqual([{ x1: 250, y1: 250, x2: 750, y2: 750 }]);
        expect(formatSeedreamRegions(regions)).toBe("<bbox>250 250 750 750</bbox>");
    });

    it("keeps separate disconnected regions", () => {
        const points: Array<[number, number]> = [
            [1, 1],
            [1, 2],
            [2, 1],
            [2, 2],
            [7, 7],
            [7, 8],
            [8, 7],
            [8, 8],
        ];
        const regions = extractMaskRegions(rgbaMask(10, 10, points), 10, 10, { minAreaRatio: 0, padding: 0 });
        expect(regions).toHaveLength(2);
    });

    it("keeps the largest painted region when every component is below the noise threshold", () => {
        const regions = extractMaskRegions(rgbaMask(100, 100, [[99, 99]]), 100, 100, { padding: 0 });
        expect(regions).toHaveLength(1);
        expect(regions[0].x2).toBe(999);
        expect(regions[0].y2).toBe(999);
    });

    it("collapses excessive disconnected regions into one bounding box", () => {
        const points: Array<[number, number]> = [
            [0, 0],
            [3, 0],
            [6, 0],
            [9, 0],
            [0, 9],
            [3, 9],
            [6, 9],
            [9, 9],
            [5, 5],
        ];
        const regions = extractMaskRegions(rgbaMask(10, 10, points), 10, 10, { minAreaRatio: 0, maxRegions: 8, padding: 0 });
        expect(regions).toEqual([{ x1: 0, y1: 0, x2: 999, y2: 999 }]);
    });

    it("keeps randomized coordinates within the 0-999 range", () => {
        let seed = 0x1a2b3c4d;
        const random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0x100000000;
        };

        for (let run = 0; run < 1000; run += 1) {
            const width = 2 + Math.floor(random() * 30);
            const height = 2 + Math.floor(random() * 30);
            const points: Array<[number, number]> = [];
            const count = 1 + Math.floor(random() * Math.min(40, width * height));
            for (let index = 0; index < count; index += 1) {
                points.push([Math.floor(random() * width), Math.floor(random() * height)]);
            }
            const regions = extractMaskRegions(rgbaMask(width, height, points), width, height, { minAreaRatio: 0 });
            expect(regions.length).toBeGreaterThan(0);
            for (const region of regions) {
                expect(region.x1).toBeGreaterThanOrEqual(0);
                expect(region.y1).toBeGreaterThanOrEqual(0);
                expect(region.x2).toBeLessThanOrEqual(999);
                expect(region.y2).toBeLessThanOrEqual(999);
                expect(region.x2).toBeGreaterThan(region.x1);
                expect(region.y2).toBeGreaterThan(region.y1);
            }
        }
    });
});
