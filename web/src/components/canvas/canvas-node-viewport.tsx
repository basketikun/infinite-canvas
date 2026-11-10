import VirtualList from "@rc-component/virtual-list";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { chunkCanvasNodeRows, type CanvasNodeRow } from "@/lib/canvas/canvas-node-list";

const LIST_ROW_HEIGHT = 56;
const LIST_ROW_GAP = 6;
const GRID_MIN_WIDTH = 88;
const GRID_GAP = 8;
const GRID_PADDING = 8;
const GRID_CAPTION_HEIGHT = 20.5;

function useViewportSize() {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
        });
        observer.observe(ref.current!);
        return () => observer.disconnect();
    }, []);
    return { ref, ...size };
}

type Props = {
    rows: CanvasNodeRow[];
    grid: boolean;
    renderItem: (row: CanvasNodeRow) => ReactNode;
    onScroll: () => void;
    empty: ReactNode;
};

export function CanvasNodeViewport({ rows, grid, renderItem, onScroll, empty }: Props) {
    const { ref, width, height } = useViewportSize();
    const columns = grid ? Math.max(1, Math.floor((width - GRID_PADDING + GRID_GAP) / (GRID_MIN_WIDTH + GRID_GAP))) : 1;
    const chunks = useMemo(() => chunkCanvasNodeRows(rows, columns), [rows, columns]);
    const tileWidth = (width - GRID_PADDING - (columns - 1) * GRID_GAP) / columns;
    const itemHeight = grid ? tileWidth + GRID_CAPTION_HEIGHT + GRID_GAP : LIST_ROW_HEIGHT + LIST_ROW_GAP;
    return (
        <div ref={ref} className="min-h-0 flex-1 overflow-hidden px-2 pb-3" data-canvas-node-viewport>
            {!rows.length ? empty : height > 0 && width > 0 ? (
                <VirtualList key={String(grid)} data={chunks} height={height} itemHeight={itemHeight}
                    itemKey={(row) => row[0].node.id} onScroll={onScroll}>
                    {(row) => (
                        <div className={grid ? "grid gap-x-2 px-1 pb-2" : "pb-1.5"}
                            style={grid ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
                            {row.map(renderItem)}
                        </div>
                    )}
                </VirtualList>
            ) : null}
        </div>
    );
}
