import type { H3Segment } from "../types";
export function VideoTimeline({ segments, selectedId, onSelect }: { segments: H3Segment[]; selectedId?: string; onSelect: (id: string) => void }) {
    return <div className="minimax-track-content">{segments.map((segment, index) => <button type="button" className={`minimax-tl-clip ${segment.id === selectedId ? "active" : ""}`} key={segment.id} onClick={() => onSelect(segment.id)} style={{ left: `${Number(segment.start || 0)}%`, width: `${Math.max(8, Number(segment.duration || 1))}%` }}>Clip {index + 1}</button>)}</div>;
}
