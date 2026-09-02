import { useEffect, useMemo, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext, CanvasNodePanelProps } from "@infinite-canvas/plugin-sdk";
import type { H3Ref, H3Segment } from "../types";
import { characterSwapLora, defaultH3Model, defaultPrompt, h3LoraOptions, h3ModelOptions } from "../constants";
import { compatibleH3Settings, normalizeH3Model, sameRef } from "../services/h3-compatibility";
import { ClipSettings } from "./ClipSettings";
import { compactSegmentStarts, segmentsFor } from "../hooks/useH3Segments";
const buttonStyle = (ctx: CanvasNodeContext, active = false) => ({
    border: `1px solid ${active ? ctx.theme.toolbar.activeText : ctx.theme.node.stroke}`,
    borderRadius: 8,
    background: active ? ctx.theme.toolbar.activeBg : ctx.theme.toolbar.panel,
    color: active ? ctx.theme.toolbar.activeText : ctx.theme.node.text,
    padding: "6px 9px",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
});

function readRefs(ctx: CanvasNodeContext): H3Ref[] {
    const currentNode = ctx.getNode(ctx.node.id) || ctx.node;
    const connected = ctx.getUpstream().flatMap((node) => {
        const media = node.metadata || {};
        const url = String(media.content || media.url || media.localUrl || media.sourceUrl || "").trim();
        if (!url) return [];
        const mime = String(node.metadata?.mimeType || "");
        const type = mime.startsWith("video/") || node.type === "video" ? "video" : mime.startsWith("audio/") || node.type === "audio" ? "audio" : "image";
        return [{ url, type: type as H3Ref["type"], name: node.title || type, storageKey: String(media.storageKey || "") || undefined }];
    });
    const characterAssets = currentNode.metadata?.h3CharacterAssets;
    const characterRefs = Array.isArray(characterAssets) ? characterAssets.flatMap((asset) => {
        if (!asset || typeof asset !== "object") return [];
        const item = asset as Record<string, unknown>;
        const role = String(item.name || item.characterName || "角色");
        const images = Array.isArray(item.images) ? item.images : [];
        return images.flatMap((image) => {
            if (!image || typeof image !== "object") return [];
            const ref = image as Record<string, unknown>;
            const url = String(ref.url || ref.dataUrl || ref.localUrl || ref.originalLocalUrl || ref.sourceUrl || ref.path || "").trim();
            return url ? [{ url, type: "image" as const, name: `${role} · ${String(ref.name || "角色参考图")}`, storageKey: String(ref.storageKey || "") || undefined }] : [];
        });
    }) : [];
    const legacy = currentNode.metadata?.h3Refs;
    const legacyRefs = legacy && typeof legacy === "object" ? Object.entries(legacy as Record<string, unknown>).flatMap(([kind, values]) => Array.isArray(values) ? values.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const url = String(item.url || item.dataUrl || item.localUrl || item.originalLocalUrl || item.sourceUrl || item.path || "").trim();
        if (!url) return [];
        const type = kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
        return [{ url, type: type as H3Ref["type"], name: String(item.name || `${kind}-ref`), storageKey: String(item.storageKey || "") || undefined }];
    }) : []) : [];
    return [...connected, ...characterRefs, ...legacyRefs].filter((item, index, all) => all.findIndex((other) => sameRef(other, item)) === index);
}

function normalizeDroppedRef(event: React.DragEvent<HTMLElement>): H3Ref | null {
    const encoded = event.dataTransfer.getData("application/x-infinite-canvas-ref");
    const fallback = event.dataTransfer.getData("text/uri-list").split(/\r?\n/).find((line) => line && !line.startsWith("#")) || event.dataTransfer.getData("text/plain");
    if (!encoded && !fallback) return null;
    let value: Record<string, unknown> = {};
    try { value = JSON.parse(encoded || fallback) as Record<string, unknown>; } catch { value = { url: fallback }; }
    const url = String(value.url || value.dataUrl || value.localUrl || value.originalLocalUrl || value.sourceUrl || value.path || "").trim();
    if (!url) return null;
    const kind = String(value.kind || value.type || "image").toLowerCase();
    return { url, name: String(value.name || url.split(/[\\/]/).pop() || "Ref"), type: kind.startsWith("video") ? "video" : kind.startsWith("audio") ? "audio" : "image", storageKey: String(value.storageKey || "") || undefined };
}

function patchSelectedSegment(ctx: CanvasNodeContext, metadata: Record<string, unknown>, patch: Partial<H3Segment>) {
    const segments = segmentsFor(metadata);
    const selectedId = String(metadata.selectedSegmentId || segments[0]?.id || "");
    ctx.updateMetadata({ selectedSegmentId: selectedId, segments: segments.map((segment) => segment.id === selectedId ? { ...segment, ...patch } : segment) });
}


function replaceSelectedWithSourceSplits(ctx: CanvasNodeContext, metadata: Record<string, unknown>) {
    const segments = segmentsFor(metadata);
    const selectedIndex = Math.max(0, segments.findIndex((segment) => segment.id === String(metadata.selectedSegmentId || segments[0]?.id || "")));
    const source = ctx.getUpstream().find((node) => String(node.type).toLowerCase().includes("video") || String(node.metadata?.mimeType || "").startsWith("video/"));
    const sourceParts = Array.isArray(source?.metadata?.segments) ? source.metadata.segments : Array.isArray(source?.metadata?.sourceSegments) ? source.metadata.sourceSegments : [];
    if (!sourceParts.length) return;
    const template = segments[selectedIndex];
    const sourceUrl = String(source?.metadata?.content || source?.metadata?.url || "");
    const existing = refsForSegment(template);
    const character = existing.find((ref) => ref.type === "image");
    const replacements = sourceParts.filter((part) => part && typeof part === "object").map((part, index) => {
        const item = part as Record<string, unknown>;
        const url = String(item.url || item.content || item.sourceUrl || "");
        if (!url) return null;
        const duration = Math.max(0.5, Number(item.duration || Number(item.end || 0) - Number(item.start || 0) || template.duration || 6));
        const video: H3Ref = { url, name: String(item.name || `Video 1 · ${index + 1}`), type: "video" };
        return { ...template, id: `${template.id}-split-${index + 1}`, duration, start: 0, taskMode: "rv2v", result: "", status: "idle", refItems: [video, ...(character ? [character] : [])], refs: { image: character ? [character] : [], video: [video], audio: [] } } as H3Segment;
    }).filter((item): item is H3Segment => Boolean(item));
    if (!replacements.length) return;
    const next = compactSegmentStarts([...segments.slice(0, selectedIndex), ...replacements, ...segments.slice(selectedIndex + 1)]);
    ctx.updateMetadata({ segments: next, selectedSegmentId: replacements[0].id, minimaxSegmented: true, minimaxSourceVideoUrl: sourceUrl, content: "", status: "idle" });
}

function H3ContentClassic({ ctx }: CanvasNodeContentProps) {
    const metadata = ctx.node.metadata || {};
    const segments = segmentsFor(metadata);
    const selected = segments.find((item) => item.id === String(metadata.selectedSegmentId || "")) || segments[0];
    const upstream = readRefs(ctx);
    const refs = selected && refsForSegment(selected).length ? refsForSegment(selected) : upstream;
    const total = Math.max(1, segments.reduce((sum, item) => sum + Number(item.duration || 0), 0));
    const selectedVideo = refs.find((item) => item.type === "video");
    const selectedImage = refs.find((item) => item.type === "image");
    const preview = resultUrl(selected?.result) || selectedVideo?.url || String(metadata.content || upstream.find((item) => item.type === "video")?.url || selectedImage?.url || "");
    const selectedIndex = Math.max(0, segments.findIndex((item) => item.id === selected?.id));
    const characterAssets = Array.isArray(metadata.h3CharacterAssets) ? metadata.h3CharacterAssets as Array<Record<string, unknown>> : [];
    const field = { width: "100%", boxSizing: "border-box", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, background: ctx.theme.node.panel, color: ctx.theme.node.text, padding: "7px 8px", fontSize: 11 } as const;
    const box = { border: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel, borderRadius: 7 } as const;
    // Keep the old classic node's persisted size; do not resize the user's node on every render.
    const patchRefs = (next: H3Ref[]) => { if (!selected) return; ctx.updateMetadata({ segments: segments.map((item) => item.id === selected.id ? { ...item, refItems: next, refs: { image: next.filter((ref) => ref.type === "image"), video: next.filter((ref) => ref.type === "video"), audio: next.filter((ref) => ref.type === "audio") } } : item) }); };
    const tile = (ref: H3Ref, compact = false, removable = false) => <div key={ref.url} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-infinite-canvas-ref", JSON.stringify(ref)); event.dataTransfer.setData("text/plain", JSON.stringify(ref)); }} style={{ position: "relative", flex: compact ? "0 0 82px" : "0 0 118px", height: compact ? 58 : 64, overflow: "hidden", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, background: ctx.theme.node.fill, cursor: "grab" }}>{ref.type === "video" ? <video src={ref.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : ref.type === "image" ? <img src={ref.url} alt={ref.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ padding: 8, fontSize: 10 }}>♫ {ref.name}</span>}<span style={{ position: "absolute", left: 3, bottom: 3, padding: "2px 4px", borderRadius: 3, background: "#111c", color: "#fff", fontSize: 9 }}>{ref.type === "image" ? "Image" : ref.type === "video" ? "Video" : "Audio"}</span>{removable ? <button type="button" aria-label={`移除 ${ref.name}`} onClick={(event) => { event.stopPropagation(); patchRefs(refs.filter((item) => item.url !== ref.url)); }} style={{ position: "absolute", top: 2, right: 2, border: 0, borderRadius: 4, background: "#111c", color: "#fff", cursor: "pointer" }}>×</button> : null}</div>;
    return <div data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: "42px 1fr", overflow: "hidden", color: ctx.theme.node.text, background: ctx.theme.node.fill }}>
        <header style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 12px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, fontWeight: 900 }}><span>▣</span><span>MiniMax H3</span><small style={{ color: ctx.theme.node.muted }}>{Number(metadata.playhead || 0).toFixed(1)}s / {total.toFixed(1)}s</small><span style={{ marginLeft: "auto", color: ctx.theme.node.muted, fontSize: 10 }}>{metadata.status === "loading" ? "生成中" : ""}</span><button type="button" onClick={() => ctx.openPanel()} style={{ ...buttonStyle(ctx), padding: "5px 8px" }}>↗</button></header>
        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", gap: 8, padding: 8 }}>
            <aside style={{ ...box, minHeight: 0, display: "grid", gridTemplateRows: "30px minmax(0,1fr) 30px minmax(0,.7fr)", overflow: "hidden" }}><b style={{ padding: 8, fontSize: 11, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}>▤ Assets</b><div style={{ padding: 7, display: "flex", flexDirection: "column", gap: 7, overflow: "auto" }}>{characterAssets.map((asset, index) => <div key={`character-${index}`} style={{ ...box, padding: 4 }}><b style={{ display: "block", fontSize: 9, marginBottom: 3 }}>{String(asset.name || asset.characterName || "Character")}</b><div style={{ display: "flex", gap: 3, overflow: "hidden" }}>{(Array.isArray(asset.images) ? asset.images : []).slice(0, 4).map((image) => { const item = image && typeof image === "object" ? image as Record<string, unknown> : {}; const url = String(item.url || item.dataUrl || item.localUrl || item.sourceUrl || ""); return url ? <img key={url} src={url} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 3 }} /> : null; })}</div></div>)}{upstream.map((ref) => tile(ref, true))}{!upstream.length && !characterAssets.length ? <span style={{ color: ctx.theme.node.placeholder, fontSize: 10 }}>连接素材</span> : null}</div><b style={{ padding: 8, fontSize: 11, borderTop: `1px solid ${ctx.theme.node.stroke}`, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}>▱ Output</b><div style={{ padding: 7, display: "flex", flexWrap: "wrap", alignContent: "start", gap: 6, overflow: "auto" }}>{segments.flatMap((item) => item.results || []).map((ref) => tile(ref, true))}</div></aside>
            <main style={{ minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "minmax(250px,1fr) 150px minmax(270px,.8fr)", gap: 8 }}>
                <section style={{ ...box, minHeight: 0, display: "grid", placeItems: "center", overflow: "hidden" }}>{preview ? (selected?.result || refs.some((ref) => ref.type === "video") ? <video src={preview} controls muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <img src={preview} alt="H3 reference" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />) : <span style={{ color: ctx.theme.node.placeholder, fontSize: 12 }}>生成中 · 输入参考</span>}</section>
                <section style={{ ...box, minWidth: 0, overflow: "hidden", display: "grid", gridTemplateRows: "28px 1fr 1fr" }}><div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px", color: ctx.theme.node.muted, fontSize: 10, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}><button type="button" onClick={() => ctx.updateMetadata({ playhead: Number(metadata.playhead || 0) >= total ? 0 : total })} style={{ ...buttonStyle(ctx), padding: "2px 6px" }}>▶</button>{[0,.25,.5,.75,1].map((ratio) => <span key={ratio} style={{ flex: 1 }}>{(total * ratio).toFixed(0)}s</span>)}</div><div style={{ display: "flex", gap: 4, padding: 5, overflowX: "auto" }}>{segments.map((segment, index) => <div key={segment.id} onClick={() => ctx.updateMetadata({ selectedSegmentId: segment.id, playhead: Number(segment.start || 0) })} style={{ flex: `0 0 ${Math.max(150, Number(segment.duration || 1) / total * 100)}px`, border: `1px solid ${segment.id === selected?.id ? ctx.theme.toolbar.activeText : ctx.theme.node.stroke}`, borderRadius: 5, background: segment.id === selected?.id ? ctx.theme.toolbar.activeBg : ctx.theme.node.fill, display: "grid", gridTemplateColumns: "22px 1fr 30px 22px", alignItems: "center", gap: 3, padding: 4, cursor: "pointer" }}><span>〰</span><b style={{ textAlign: "center", fontSize: 10 }}>Clip {index + 1}<br /><small>{Number(segment.start || 0).toFixed(0)}s - {(Number(segment.start || 0) + Number(segment.duration || 0)).toFixed(0)}s</small></b><span style={{ fontSize: 10 }}>⌕{refsForSegment(segment).length}</span><button type="button" disabled={segments.length <= 1} onClick={(event) => { event.stopPropagation(); const next = segments.filter((item) => item.id !== segment.id); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: next[Math.max(0, index - 1)]?.id }); }} style={{ border: 0, background: "transparent", color: ctx.theme.node.muted }}>×</button></div>)}<button type="button" onClick={() => { const next = compactSegmentStarts([...segments, { id: `segment-${Date.now()}`, prompt: defaultPrompt, duration: 5, status: "idle" }]); ctx.updateMetadata({ segments: next, selectedSegmentId: next[next.length - 1].id }); }} style={{ ...buttonStyle(ctx), minWidth: 38 }}>＋</button></div><div style={{ display: "grid", gridTemplateColumns: "48px 1fr", alignItems: "center", gap: 6, padding: "4px 8px", borderTop: `1px solid ${ctx.theme.node.stroke}`, overflow: "hidden" }}><b style={{ color: ctx.theme.node.muted, fontSize: 10 }}>Refs</b><div style={{ display: "flex", gap: 5, overflowX: "auto" }}>{refs.map((ref) => tile(ref, true, true))}</div></div></section>
                <section style={{ ...box, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 245px", gap: 8, padding: 8, overflow: "auto" }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const ref = normalizeDroppedRef(event); if (ref && !refs.some((item) => item.url === ref.url)) patchRefs([...refs, ref]); }}><div style={{ minWidth: 0, display: "grid", gridTemplateRows: "26px 1fr auto", gap: 5 }}><b style={{ color: ctx.theme.node.muted, fontSize: 11 }}>⌘ Prompt <button type="button" onClick={() => ctx.openPanel()} style={{ ...buttonStyle(ctx), padding: "3px 8px", marginLeft: 8 }}>增强提示词</button></b><textarea value={String(selected?.prompt || "")} onChange={(event) => patchSelectedSegment(ctx, metadata, { prompt: event.target.value })} style={{ ...field, minHeight: 130, resize: "vertical", lineHeight: 1.45 }} /><div style={{ color: ctx.theme.node.muted, fontSize: 10 }}>多参考 · 模板 · 定义 · 摘要 · 保留 · 分辨 · 声音 · 配乐</div></div><div style={{ display: "flex", flexDirection: "column", gap: 6 }}><b style={{ color: ctx.theme.node.muted, fontSize: 11 }}>☷ Clip settings</b><label style={{ fontSize: 10 }}>Task mode<select value={String(selected?.taskMode || "r2v")} onChange={(event) => patchSelectedSegment(ctx, metadata, { taskMode: event.target.value })} style={field}><option value="r2v">参考主体</option><option value="rv2v">视频编辑</option><option value="t2v">文生视频</option></select></label><label style={{ fontSize: 10 }}>Duration<input type="number" value={Number(selected?.duration || 5)} onChange={(event) => patchSelectedSegment(ctx, metadata, { duration: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>Aspect ratio<select value={String(selected?.aspectRatio || "16:9 (Widescreen)")} onChange={(event) => patchSelectedSegment(ctx, metadata, { aspectRatio: event.target.value })} style={field}><option>16:9 (Widescreen)</option><option>9:16 (Portrait Widescreen)</option><option>1:1 (Square)</option><option>4:3 (Standard)</option></select></label><label style={{ fontSize: 10 }}>Steps<input type="number" value={Number(selected?.videoSteps || 20)} onChange={(event) => patchSelectedSegment(ctx, metadata, { videoSteps: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>Global MP<input type="number" step="0.1" min="0.1" max="2" value={Number(metadata.minimaxGlobalMegapixels || metadata.megapixels || 1)} onChange={(event) => ctx.updateMetadata({ minimaxGlobalMegapixels: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>Global steps<input type="number" min="1" max="60" value={Number(metadata.minimaxGlobalVideoSteps || metadata.videoSteps || 6)} onChange={(event) => ctx.updateMetadata({ minimaxGlobalVideoSteps: Number(event.target.value) })} style={field} /></label><Toggle ctx={ctx} label="Motion Context" value={selected?.motionContextEnabled !== false} onChange={(value) => patchSelectedSegment(ctx, metadata, { motionContextEnabled: value })} /><Toggle ctx={ctx} label="Global TE" value={metadata.minimaxGlobalTeAccel !== false} onChange={(value) => ctx.updateMetadata({ minimaxGlobalTeAccel: value })} /><button type="button" onClick={() => { ctx.openPanel(); setTimeout(() => ctx.emit("minimax-h3:run", { nodeId: ctx.node.id }), 0); }} style={{ ...buttonStyle(ctx, true), marginTop: "auto" }}>Generate clip</button><button type="button" onClick={() => { ctx.openPanel(); setTimeout(() => ctx.emit("minimax-h3:run-all", { nodeId: ctx.node.id }), 0); }} style={{ ...buttonStyle(ctx), marginTop: 0 }}>一键运行全部 Clip</button></div></section>
            </main>
        </div>
    </div>;
}

function H3ContentReplica({ ctx }: CanvasNodeContentProps) {
    const metadata = ctx.node.metadata || {};
    const segments = segmentsFor(metadata);
    const selected = segments.find((item) => item.id === String(metadata.selectedSegmentId || "")) || segments[0];
    const selectedIndex = Math.max(0, segments.findIndex((item) => item.id === selected?.id));
    const upstream = readRefs(ctx);
    const refs = selected && refsForSegment(selected).length ? refsForSegment(selected) : upstream;
    const total = Math.max(1, segments.reduce((sum, item) => sum + Number(item.duration || 0), 0));
    const preview = String(selected?.result || metadata.content || upstream.find((item) => item.type === "video")?.url || "");
    const playhead = Math.max(0, Math.min(total, Number(metadata.playhead || 0)));
    const frame = { border: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel, borderRadius: 7 } as const;
    const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, background: ctx.theme.node.panel, color: ctx.theme.node.text, padding: "6px 8px", fontSize: 11 } as const;
    // Keep the old classic node's persisted size; do not resize the user's node on every render.
    const patchSelected = (patch: Partial<H3Segment>) => { if (selected) ctx.updateMetadata({ segments: segments.map((item) => item.id === selected.id ? { ...item, ...patch } : item) }); };
    const patchRefs = (next: H3Ref[]) => patchSelected({ refItems: next, refs: { image: next.filter((item) => item.type === "image"), video: next.filter((item) => item.type === "video"), audio: next.filter((item) => item.type === "audio") } });
    const media = (ref: H3Ref, compact = false, removable = false) => <div key={ref.url} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-infinite-canvas-ref", JSON.stringify(ref)); event.dataTransfer.setData("text/plain", JSON.stringify(ref)); }} style={{ position: "relative", flex: compact ? "0 0 82px" : "0 0 118px", height: compact ? 58 : 64, overflow: "hidden", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, background: ctx.theme.node.fill, cursor: "grab" }}>{ref.type === "video" ? <video src={ref.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : ref.type === "image" ? <img src={ref.url} alt={ref.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ padding: 8, fontSize: 10 }}>♫ {ref.name}</span>}<span style={{ position: "absolute", left: 3, bottom: 3, padding: "2px 4px", borderRadius: 3, background: "#111c", color: "#fff", fontSize: 9 }}>{ref.type === "image" ? "Image" : ref.type === "video" ? "Video" : "Audio"}</span>{removable ? <button type="button" onClick={(event) => { event.stopPropagation(); patchRefs(refs.filter((item) => item.url !== ref.url)); }} style={{ position: "absolute", top: 2, right: 2, border: 0, borderRadius: 4, background: "#111c", color: "#fff" }}>×</button> : null}</div>;
    const laneClip = (segment: H3Segment, index: number, kind: "video" | "motion") => <div key={`${kind}-${segment.id}`} onClick={() => ctx.updateMetadata({ selectedSegmentId: segment.id, playhead: Number(segment.start || 0) })} style={{ position: "absolute", left: `${Number(segment.start || 0) / total * 100}%`, width: `${Math.max(5, Number(segment.duration || 1) / total * 100)}%`, top: 6, bottom: 6, minWidth: 60, overflow: "hidden", borderRadius: 5, border: `1px solid ${segment.id === selected?.id ? "#ef4444" : ctx.theme.node.stroke}`, background: segment.id === selected?.id ? ctx.theme.toolbar.activeBg : ctx.theme.node.fill, color: ctx.theme.node.text, cursor: "pointer", display: "grid", gridTemplateColumns: kind === "video" ? "24px 1fr 28px 22px" : "22px 1fr", alignItems: "center", gap: 3, padding: 3, boxSizing: "border-box" }}>{kind === "video" ? <span>〰</span> : <span>〰</span>}<b style={{ textAlign: "center", fontSize: 10 }}>Clip {index + 1}<br /><small>{Number(segment.start || 0).toFixed(0)}s - {(Number(segment.start || 0) + Number(segment.duration || 0)).toFixed(0)}s</small></b>{kind === "video" ? <span style={{ fontSize: 10 }}>⌕{refsForSegment(segment).length}</span> : null}{kind === "video" ? <button type="button" disabled={segments.length <= 1} onClick={(event) => { event.stopPropagation(); const next = segments.filter((item) => item.id !== segment.id); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: next[Math.max(0, index - 1)]?.id }); }} style={{ border: 0, background: "transparent", color: ctx.theme.node.muted }}>×</button> : null}</div>;
    return <div data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} style={{ width: "100%", height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "42px 1fr", overflow: "hidden", color: ctx.theme.node.text, background: ctx.theme.node.fill }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, fontWeight: 900, fontSize: 13 }}><span>▣</span><span>MiniMax H3</span><small style={{ color: ctx.theme.node.muted }}>{playhead.toFixed(1)}s / {total.toFixed(1)}s</small><span style={{ marginLeft: "auto", color: metadata.status === "error" ? "#ef4444" : ctx.theme.node.muted, fontSize: 10 }}>{metadata.status === "loading" ? "生成中" : metadata.status === "success" ? "已完成" : metadata.status === "error" ? "失败" : ""}</span><button type="button" onClick={() => ctx.openPanel()} style={{ ...buttonStyle(ctx), padding: "5px 8px" }}>↗</button></header>
        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", gap: 8, padding: 8 }}>
            <aside style={{ ...frame, minHeight: 0, display: "grid", gridTemplateRows: "30px minmax(0,1fr) 30px minmax(0,.75fr)", overflow: "hidden" }}><b style={{ padding: "8px", fontSize: 11, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}>▤ Assets</b><div style={{ padding: 7, display: "flex", flexDirection: "column", gap: 7, overflow: "auto" }}>{upstream.map((ref) => media(ref, true))}{!upstream.length ? <span style={{ color: ctx.theme.node.placeholder, fontSize: 10 }}>连接素材</span> : null}</div><b style={{ padding: "8px", fontSize: 11, borderTop: `1px solid ${ctx.theme.node.stroke}`, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}>▱ Output</b><div style={{ padding: 7, display: "flex", flexWrap: "wrap", alignContent: "start", gap: 6, overflow: "auto" }}>{segments.flatMap((item) => item.results || []).map((ref) => media(ref, true))}</div></aside>
            <main style={{ minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "minmax(250px,1fr) 190px minmax(280px,.8fr)", gap: 8 }}>
                <section style={{ ...frame, minHeight: 0, display: "grid", placeItems: "center", overflow: "hidden", background: ctx.theme.node.fill }}>{preview ? (selected?.result || refs.some((ref) => ref.type === "video") ? <video src={preview} controls muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <img src={preview} alt="H3 reference" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />) : <span style={{ color: ctx.theme.node.placeholder, fontSize: 12 }}>生成中 · 输入参考</span>}</section>
                <section style={{ ...frame, minWidth: 0, minHeight: 0, display: "grid", gridTemplateColumns: "52px minmax(0,1fr) 48px", gridTemplateRows: "28px 74px 36px 48px", overflow: "hidden", position: "relative" }}><div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 9, padding: "0 8px", color: ctx.theme.node.muted, fontSize: 10, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}><button type="button" onClick={() => ctx.updateMetadata({ playhead: playhead >= total ? 0 : total })} style={{ ...buttonStyle(ctx), padding: "2px 6px" }}>▶</button>{[0,.25,.5,.5+.25,1].map((ratio, index) => <span key={`${ratio}-${index}`} style={{ flex: 1 }}>{(total * ratio).toFixed(0)}s</span>)}</div><div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: ctx.theme.node.muted, fontSize: 10, fontWeight: 900, borderRight: `1px solid ${ctx.theme.node.stroke}` }}>Video</div><div style={{ position: "relative", minWidth: 0, overflow: "auto", background: ctx.theme.node.fill }}>{segments.map((segment, index) => laneClip(segment, index, "video"))}</div><button type="button" onClick={() => { const next = compactSegmentStarts([...segments, { id: `segment-${Date.now()}`, prompt: defaultPrompt, duration: 5, status: "idle" }]); ctx.updateMetadata({ segments: next, selectedSegmentId: next[next.length - 1].id }); }} style={{ border: 0, borderLeft: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel, color: ctx.theme.node.text }}>＋</button><div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: ctx.theme.node.muted, fontSize: 10, fontWeight: 900, borderTop: `1px solid ${ctx.theme.node.stroke}`, borderRight: `1px solid ${ctx.theme.node.stroke}` }}>Motion</div><div style={{ position: "relative", minWidth: 0, borderTop: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.fill }}>{segments.map((segment, index) => laneClip(segment, index, "motion"))}</div><div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, borderLeft: `1px solid ${ctx.theme.node.stroke}` }} /><div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: ctx.theme.node.muted, fontSize: 10, fontWeight: 900, borderTop: `1px solid ${ctx.theme.node.stroke}`, borderRight: `1px solid ${ctx.theme.node.stroke}` }}>Refs</div><div style={{ minWidth: 0, borderTop: `1px solid ${ctx.theme.node.stroke}`, overflowX: "auto", display: "flex", gap: 5, alignItems: "center", padding: "0 5px", background: ctx.theme.node.fill }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const ref = normalizeDroppedRef(event); if (ref && !refs.some((item) => item.url === ref.url)) patchRefs([...refs, ref]); }}>{refs.map((ref) => media(ref, true, true))}</div><div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, borderLeft: `1px solid ${ctx.theme.node.stroke}` }} /></section>
                <section style={{ ...frame, minHeight: 0, display: "grid", gridTemplateRows: "34px 1fr", overflow: "hidden" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel }}><div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: ctx.theme.node.text }} /><b>Clip {selectedIndex + 1}</b><span style={{ color: ctx.theme.node.muted }}>{Number(selected?.start || 0).toFixed(0)}s - {(Number(selected?.start || 0) + Number(selected?.duration || 0)).toFixed(0)}s</span></div><div style={{ display: "flex", gap: 5, color: ctx.theme.node.muted, fontSize: 10 }}><span>⌘ {refs.filter((ref) => ref.type === "image").length}</span><span>▣ {refs.filter((ref) => ref.type === "video").length}</span><span>♫ {refs.filter((ref) => ref.type === "audio").length}</span></div></div><div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 264px", overflow: "hidden" }}><div style={{ minWidth: 0, display: "grid", gridTemplateRows: "24px minmax(0,1fr) auto", gap: 5, padding: "6px 9px 8px", borderRight: `1px solid ${ctx.theme.node.stroke}` }}><b style={{ color: ctx.theme.node.muted, fontSize: 10 }}>⌘ Prompt <button type="button" onClick={() => ctx.openPanel()} style={{ ...buttonStyle(ctx), padding: "2px 7px", marginLeft: 8 }}>增强提示词</button></b><textarea value={String(selected?.prompt || "")} onChange={(event) => patchSelected({ prompt: event.target.value })} style={{ ...input, minHeight: 100, resize: "none", lineHeight: 1.45 }} /><div style={{ color: ctx.theme.node.muted, fontSize: 9 }}>多参考　模板　定义　摘要　保留　分辨　声音　配乐</div></div><div style={{ minWidth: 0, overflow: "auto", padding: "5px 8px 7px", display: "flex", flexDirection: "column", gap: 5 }}><b style={{ color: ctx.theme.node.muted, fontSize: 10 }}>☷ Clip settings</b><label style={{ fontSize: 9 }}>Task mode<select value={String(selected?.taskMode || "r2v")} onChange={(event) => patchSelected({ taskMode: event.target.value })} style={input}><option value="r2v">参考主体</option><option value="rv2v">视频编辑</option><option value="t2v">文生视频</option></select></label><label style={{ fontSize: 9 }}>Duration<input type="number" value={Number(selected?.duration || 5)} onChange={(event) => patchSelected({ duration: Number(event.target.value) })} style={input} /></label><label style={{ fontSize: 9 }}>Megapixels<input type="number" step="0.1" value={Number(selected?.megapixels || metadata.megapixels || 1)} onChange={(event) => patchSelected({ megapixels: Number(event.target.value) })} style={input} /></label><label style={{ fontSize: 9 }}>Aspect ratio<select value={String(selected?.aspectRatio || "16:9 (Widescreen)")} onChange={(event) => patchSelected({ aspectRatio: event.target.value })} style={input}><option>16:9 (Widescreen)</option><option>9:16 (Portrait Widescreen)</option><option>1:1 (Square)</option><option>4:3 (Standard)</option></select></label><Toggle ctx={ctx} label="Motion Context" value={selected?.motionContextEnabled !== false} onChange={(value) => patchSelected({ motionContextEnabled: value, tailFrameEnabled: value })} /><button type="button" onClick={() => { ctx.openPanel(); setTimeout(() => ctx.emit("minimax-h3:run", { nodeId: ctx.node.id }), 0); }} style={{ ...buttonStyle(ctx, true), marginTop: "auto" }}>Generate clip</button></div></div></section>
            </main>
        </div>
    </div>;
}

function H3ContentFinal({ ctx }: CanvasNodeContentProps) {
    const metadata = ctx.node.metadata || {};
    const segments = segmentsFor(metadata);
    const selected = segments.find((item) => item.id === String(metadata.selectedSegmentId || "")) || segments[0];
    const selectedIndex = Math.max(0, segments.findIndex((item) => item.id === selected?.id));
    const upstream = readRefs(ctx);
    const refs = selected && refsForSegment(selected).length ? refsForSegment(selected) : upstream;
    const total = Math.max(1, segments.reduce((sum, item) => sum + Number(item.duration || 0), 0));
    const playhead = Math.max(0, Math.min(total, Number(metadata.playhead || 0)));
    const preview = String(selected?.result || metadata.content || upstream.find((item) => item.type === "video")?.url || "");
    const box = { border: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel, borderRadius: 7 } as const;
    const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, background: ctx.theme.node.panel, color: ctx.theme.node.text, padding: "6px 8px", fontSize: 11 } as const;
    // Keep the old classic node's persisted size; do not resize the user's node on every render.
    const patchSelected = (patch: Partial<H3Segment>) => { if (selected) ctx.updateMetadata({ segments: segments.map((item) => item.id === selected.id ? { ...item, ...patch } : item) }); };
    const patchRefs = (next: H3Ref[]) => patchSelected({ refItems: next, refs: { image: next.filter((item) => item.type === "image"), video: next.filter((item) => item.type === "video"), audio: next.filter((item) => item.type === "audio") } });
    const media = (ref: H3Ref, compact = false, removable = false) => <div key={ref.url} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-infinite-canvas-ref", JSON.stringify(ref)); event.dataTransfer.setData("text/plain", JSON.stringify(ref)); }} style={{ position: "relative", flex: compact ? "0 0 82px" : "0 0 118px", height: compact ? 58 : 64, overflow: "hidden", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, background: ctx.theme.node.fill, cursor: "grab" }}>{ref.type === "video" ? <video src={ref.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : ref.type === "image" ? <img src={ref.url} alt={ref.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ padding: 8, fontSize: 10 }}>♫ {ref.name}</span>}<span style={{ position: "absolute", left: 3, bottom: 3, padding: "2px 4px", borderRadius: 3, background: "#111c", color: "#fff", fontSize: 9 }}>{ref.type === "image" ? "Image" : ref.type === "video" ? "Video" : "Audio"}</span>{removable ? <button type="button" onClick={(event) => { event.stopPropagation(); patchRefs(refs.filter((item) => item.url !== ref.url)); }} style={{ position: "absolute", top: 2, right: 2, border: 0, borderRadius: 4, background: "#111c", color: "#fff" }}>×</button> : null}</div>;
    const moveClip = (event: React.DragEvent<HTMLDivElement>, targetId: string) => { event.preventDefault(); const sourceId = event.dataTransfer.getData("application/x-infinite-canvas-clip"); if (!sourceId || sourceId === targetId) return; const from = segments.findIndex((item) => item.id === sourceId); const to = segments.findIndex((item) => item.id === targetId); if (from < 0 || to < 0) return; const next = [...segments]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: sourceId }); };
    const clip = (segment: H3Segment, index: number) => <div key={segment.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-infinite-canvas-clip", segment.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveClip(event, segment.id)} onClick={() => ctx.updateMetadata({ selectedSegmentId: segment.id, playhead: Number(segment.start || 0) })} style={{ position: "absolute", left: `${Number(segment.start || 0) / total * 100}%`, width: `${Math.max(5, Number(segment.duration || 1) / total * 100)}%`, top: 7, bottom: 7, minWidth: 70, overflow: "hidden", border: `1px solid ${segment.id === selected?.id ? "#ef4444" : ctx.theme.node.stroke}`, borderRadius: 5, background: segment.id === selected?.id ? ctx.theme.toolbar.activeBg : ctx.theme.node.fill, cursor: "grab", display: "grid", gridTemplateColumns: "22px 1fr 30px 22px", alignItems: "center", gap: 3, padding: 3, boxSizing: "border-box" }}><span>〰</span><b style={{ textAlign: "center", fontSize: 10 }}>Clip {index + 1}<br /><small>{Number(segment.start || 0).toFixed(0)}s - {(Number(segment.start || 0) + Number(segment.duration || 0)).toFixed(0)}s</small></b><span style={{ fontSize: 10 }}>⌘{refsForSegment(segment).length}</span><button type="button" disabled={segments.length <= 1} onClick={(event) => { event.stopPropagation(); const next = segments.filter((item) => item.id !== segment.id); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: next[Math.max(0, index - 1)]?.id }); }} style={{ border: 0, background: "transparent", color: ctx.theme.node.muted }}>×</button></div>;
    const addSegment = () => { const next = compactSegmentStarts([...segments, { id: `segment-${Date.now()}`, prompt: defaultPrompt, duration: 5, status: "idle" }]); ctx.updateMetadata({ segments: next, selectedSegmentId: next[next.length - 1].id }); };
    const run = (all = false) => requestH3Run(ctx, all);
    return <div data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} style={{ width: "100%", height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "42px 1fr", overflow: "hidden", color: ctx.theme.node.text, background: ctx.theme.node.fill }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, fontWeight: 900, fontSize: 13 }}><span>▣</span><span>MiniMax H3</span><small style={{ color: ctx.theme.node.muted }}>{playhead.toFixed(1)}s / {total.toFixed(1)}s</small><span style={{ marginLeft: "auto", color: metadata.status === "error" ? "#ef4444" : ctx.theme.node.muted, fontSize: 10 }}>{metadata.status === "loading" ? "生成中" : metadata.status === "success" ? "已完成" : metadata.status === "error" ? "失败" : ""}</span><button type="button" disabled={!preview} title="下载当前结果" style={{ ...buttonStyle(ctx), padding: "5px 8px" }} onClick={() => preview && window.open(preview, "_blank")}>⇩</button><button type="button" onClick={() => ctx.openPanel()} style={{ ...buttonStyle(ctx), padding: "5px 8px" }}>↗</button></header>
        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", gap: 8, padding: 8 }}>
            <aside style={{ ...box, minHeight: 0, display: "grid", gridTemplateRows: "30px minmax(0,1fr) 30px minmax(0,.75fr)", overflow: "hidden" }}><b style={{ padding: 8, fontSize: 11, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}>▤ Assets</b><div style={{ padding: 7, display: "flex", flexDirection: "column", gap: 7, overflow: "auto" }}>{upstream.map((ref) => media(ref, true))}{!upstream.length ? <span style={{ color: ctx.theme.node.placeholder, fontSize: 10 }}>连接素材</span> : null}</div><b style={{ padding: 8, fontSize: 11, borderTop: `1px solid ${ctx.theme.node.stroke}`, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}>▱ Output</b><div style={{ padding: 7, display: "flex", flexWrap: "wrap", alignContent: "start", gap: 6, overflow: "auto" }}>{segments.flatMap((item) => item.results || []).map((ref) => media(ref, true))}</div></aside>
            <main style={{ minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "minmax(250px,1fr) 190px minmax(300px,.8fr)", gap: 8 }}>
                <section style={{ ...box, minHeight: 0, display: "grid", placeItems: "center", overflow: "hidden", background: ctx.theme.node.fill }}>{preview ? (selected?.result || refs.some((ref) => ref.type === "video") ? <video src={preview} controls muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <img src={preview} alt="H3 reference" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />) : <span style={{ color: ctx.theme.node.placeholder, fontSize: 12 }}>生成中 · 输入参考</span>}</section>
                <section style={{ ...box, minWidth: 0, minHeight: 0, display: "grid", gridTemplateColumns: "52px minmax(0,1fr) 48px", gridTemplateRows: "28px 74px 36px 48px", overflow: "hidden" }}><div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 9, padding: "0 8px", color: ctx.theme.node.muted, fontSize: 10, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}><button type="button" onClick={() => ctx.updateMetadata({ playhead: playhead >= total ? 0 : total })} style={{ ...buttonStyle(ctx), padding: "2px 6px" }}>▶</button>{[0,.25,.5,.75,1].map((ratio) => <span key={ratio} style={{ flex: 1 }}>{(total * ratio).toFixed(0)}s</span>)}</div><div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: ctx.theme.node.muted, fontSize: 10, fontWeight: 900, borderRight: `1px solid ${ctx.theme.node.stroke}` }}>Video</div><div style={{ position: "relative", minWidth: 0, overflow: "hidden", background: ctx.theme.node.fill }}>{segments.map(clip)}</div><button type="button" onClick={addSegment} style={{ border: 0, borderLeft: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel, color: ctx.theme.node.text }}>＋</button><div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: ctx.theme.node.muted, fontSize: 10, fontWeight: 900, borderTop: `1px solid ${ctx.theme.node.stroke}`, borderRight: `1px solid ${ctx.theme.node.stroke}` }}>Motion</div><div style={{ position: "relative", borderTop: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.fill }}>{segments.map((segment, index) => <div key={segment.id} style={{ position: "absolute", left: `${Number(segment.start || 0) / total * 100}%`, width: `${Math.max(5, Number(segment.duration || 1) / total * 100)}%`, top: 11, bottom: 11, borderRadius: 4, border: `1px solid ${ctx.theme.node.stroke}`, background: segment.motionContextEnabled === false ? ctx.theme.node.fill : ctx.theme.toolbar.activeBg }} />)}</div><div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, borderLeft: `1px solid ${ctx.theme.node.stroke}` }} /><div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: ctx.theme.node.muted, fontSize: 10, fontWeight: 900, borderTop: `1px solid ${ctx.theme.node.stroke}`, borderRight: `1px solid ${ctx.theme.node.stroke}` }}>Refs</div><div style={{ minWidth: 0, borderTop: `1px solid ${ctx.theme.node.stroke}`, overflowX: "auto", display: "flex", gap: 5, alignItems: "center", padding: "0 5px", background: ctx.theme.node.fill }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const ref = normalizeDroppedRef(event); if (ref && !refs.some((item) => item.url === ref.url)) patchRefs([...refs, ref]); }}>{refs.map((ref) => media(ref, true, true))}</div><div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, borderLeft: `1px solid ${ctx.theme.node.stroke}` }} /></section>
                <section style={{ ...box, minHeight: 0, display: "grid", gridTemplateRows: "34px 78px 1fr 34px", overflow: "hidden" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel }}><div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: ctx.theme.node.text }} /><b>Clip {selectedIndex + 1}</b><span style={{ color: ctx.theme.node.muted }}>{Number(selected?.start || 0).toFixed(0)}s - {(Number(selected?.start || 0) + Number(selected?.duration || 0)).toFixed(0)}s</span></div><span style={{ color: ctx.theme.node.muted, fontSize: 10 }}>{refs.filter((ref) => ref.type === "image").length} refs</span></div><div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 9px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, overflowX: "auto" }}><b style={{ color: ctx.theme.node.muted, fontSize: 10, flex: "0 0 38px" }}>⌘ Refs</b>{refs.map((ref) => media(ref, true, true))}</div><div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 264px", overflow: "hidden" }}><div style={{ minWidth: 0, display: "grid", gridTemplateRows: "24px minmax(0,1fr) auto", gap: 5, padding: "6px 9px 8px", borderRight: `1px solid ${ctx.theme.node.stroke}` }}><b style={{ color: ctx.theme.node.muted, fontSize: 10 }}>⌘ Prompt <button type="button" onClick={() => ctx.openPanel()} style={{ ...buttonStyle(ctx), padding: "2px 7px", marginLeft: 8 }}>增强提示词</button></b><textarea value={String(selected?.prompt || "")} onChange={(event) => patchSelected({ prompt: event.target.value })} style={{ ...input, minHeight: 100, resize: "none", lineHeight: 1.45 }} /><div style={{ color: ctx.theme.node.muted, fontSize: 9 }}>多参考　模板　定义　摘要　保留　分辨　声音　配乐</div></div><div style={{ minWidth: 0, overflow: "auto", padding: "5px 8px 7px", display: "flex", flexDirection: "column", gap: 5 }}><b style={{ color: ctx.theme.node.muted, fontSize: 10 }}>☷ Clip settings</b><label style={{ fontSize: 9 }}>Task mode<select value={String(selected?.taskMode || "r2v")} onChange={(event) => patchSelected({ taskMode: event.target.value })} style={input}><option value="r2v">参考主体</option><option value="rv2v">视频编辑</option><option value="t2v">文生视频</option></select></label><label style={{ fontSize: 9 }}>Duration<input type="number" value={Number(selected?.duration || 5)} onChange={(event) => patchSelected({ duration: Number(event.target.value) })} style={input} /></label><label style={{ fontSize: 9 }}>Megapixels<input type="number" step="0.1" value={Number(selected?.megapixels || metadata.megapixels || 1)} onChange={(event) => patchSelected({ megapixels: Number(event.target.value) })} style={input} /></label><label style={{ fontSize: 9 }}>Aspect ratio<select value={String(selected?.aspectRatio || "16:9 (Widescreen)")} onChange={(event) => patchSelected({ aspectRatio: event.target.value })} style={input}><option>16:9 (Widescreen)</option><option>9:16 (Portrait Widescreen)</option><option>1:1 (Square)</option><option>4:3 (Standard)</option></select></label><Toggle ctx={ctx} label="Motion Context" value={selected?.motionContextEnabled !== false} onChange={(value) => patchSelected({ motionContextEnabled: value, tailFrameEnabled: value })} /><button type="button" onClick={() => run(false)} style={{ ...buttonStyle(ctx, true), marginTop: "auto" }}>Generate clip</button></div></div><div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 9px", borderTop: `1px solid ${ctx.theme.node.stroke}`, color: ctx.theme.node.muted, fontSize: 9 }}><span>全局 MP {String(metadata.minimaxGlobalMegapixels || metadata.megapixels || 1)}</span><span>全局 Steps {String(metadata.minimaxGlobalVideoSteps || metadata.videoSteps || 8)}</span><Toggle ctx={ctx} label="Global LoRA" value={metadata.minimaxGlobalLoraEnabled !== false} onChange={(value) => ctx.updateMetadata({ minimaxGlobalLoraEnabled: value })} /><Toggle ctx={ctx} label="Global TE" value={metadata.minimaxGlobalTeAccel === true} onChange={(value) => ctx.updateMetadata({ minimaxGlobalTeAccel: value })} /><button type="button" onClick={() => run(true)} style={{ ...buttonStyle(ctx, true), marginLeft: "auto", padding: "4px 8px" }}>☷ 一键运行全部 Clip</button></div></section>
            </main>
        </div>
    </div>;
}

function H3Content({ ctx }: CanvasNodeContentProps) {
    const content = String(ctx.node.metadata?.content || "");
    const upstream = readRefs(ctx);
    const metadata = ctx.node.metadata || {};
    const segmentList = segmentsFor(metadata);
    const selectedId = String(metadata.selectedSegmentId || segmentList[0]?.id || "");
    const selected = segmentList.find((segment) => segment.id === selectedId) || segmentList[0];
    const preview = content || String(selected?.result || "") || upstream.find((ref) => ref.type === "video")?.url || upstream.find((ref) => ref.type === "image")?.url || "";
    const status = String(ctx.node.metadata?.status || "idle");
    const error = String(ctx.node.metadata?.errorDetails || "");
    const total = Math.max(1, segmentList.reduce((sum, item) => sum + Number(item.duration || 0), 0));
    useEffect(() => {
        if (Number(ctx.node.width || 0) < 900 || Number(ctx.node.height || 0) < 700) ctx.updateNode({ width: 1100, height: 820 });
    }, [ctx.node.id]);
    const updateSegmentSelection = (id: string) => ctx.updateMetadata({ selectedSegmentId: id, playhead: Number(segmentList.find((item) => item.id === id)?.start || 0) });
    const selectedRefs = selected ? refsForSegment(selected) : [];
    // 单 Clip 时沿用旧画布：尚未落到 clip 的连接素材仍显示在当前 Clip 的 Refs 轨道。
    // 多 Clip 时保持每个 Clip 独立，避免把一个 Clip 的角色引用误显示到其他 Clip。
    const refs = selected ? (selectedRefs.length || segmentList.length > 1 ? selectedRefs : upstream) : upstream;
    const imageRefs = refs.filter((item) => item.type === "image");
    const videoRefs = refs.filter((item) => item.type === "video");
    const audioRefs = refs.filter((item) => item.type === "audio");
    const outputResults = segmentList.flatMap((segment, index) => (Array.isArray(segment.results) ? segment.results : resultUrl(segment.result) ? [{ url: resultUrl(segment.result), type: "video" as const, name: `Clip ${index + 1}` }] : []));
    const characterAssets = Array.isArray(metadata.h3CharacterAssets) ? metadata.h3CharacterAssets as Array<Record<string, unknown>> : [];
    const thumbnail = (ref: H3Ref, compact = false) => <div key={`${ref.url}-${compact ? "small" : "large"}`} style={{ position: "relative", minWidth: compact ? 82 : 0, height: compact ? 58 : 0, flex: compact ? "0 0 82px" : undefined, borderRadius: 5, overflow: "hidden", border: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel }}>
        {ref.type === "video" ? <video src={ref.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : ref.type === "image" ? <img src={ref.url} alt={ref.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ padding: 10, fontSize: 10 }}>♫ {ref.name}</div>}
        {compact ? <span style={{ position: "absolute", left: 3, bottom: 3, padding: "2px 4px", borderRadius: 3, background: "#111b", color: "#fff", fontSize: 9 }}>{ref.type === "image" ? "Image" : ref.type === "video" ? "Video" : "Audio"}</span> : null}
    </div>;

    return (
        <div data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} style={{ width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", boxSizing: "border-box", color: ctx.theme.node.text, background: ctx.theme.node.fill, borderRadius: 12, overflow: "auto" }}>
            <div style={{ height: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, fontWeight: 800, fontSize: 13 }}><span style={{ fontSize: 16 }}>▣</span><span>MiniMax H3</span><span style={{ color: ctx.theme.node.muted, fontSize: 10 }}>{Number(metadata.duration || total).toFixed(1)}s / {total.toFixed(1)}s</span><span style={{ marginLeft: "auto", color: status === "error" ? "#ef4444" : status === "loading" ? ctx.theme.toolbar.activeText : ctx.theme.node.muted, fontSize: 10 }}>{status === "loading" ? "生成中" : status === "success" ? "已完成" : status === "error" ? "失败" : ""}</span><button type="button" onClick={() => ctx.openPanel()} style={{ ...buttonStyle(ctx), padding: "4px 7px" }}>⚙</button></div>
            <div style={{ flex: "0 0 42%", minHeight: 260, display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, padding: 8, boxSizing: "border-box" }}>
                <div style={{ border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, overflow: "hidden", display: "flex", flexDirection: "column" }}><div style={{ padding: "6px 8px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, fontSize: 11, fontWeight: 800 }}>▤ Assets</div><div style={{ padding: 6, display: "flex", flexDirection: "column", gap: 6, overflow: "auto" }}>{characterAssets.map((asset, index) => { const images = Array.isArray(asset.images) ? asset.images : []; return <div key={`character-${index}`} style={{ border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, padding: 3 }}><div style={{ fontSize: 9, fontWeight: 800, marginBottom: 3 }}>{String(asset.name || asset.characterName || "Character")}</div><div style={{ display: "flex", gap: 3, overflow: "hidden" }}>{images.slice(0, 4).map((image) => { const item = image && typeof image === "object" ? image as Record<string, unknown> : {}; const url = String(item.url || item.dataUrl || item.localUrl || item.sourceUrl || ""); return url ? <img key={url} src={url} alt="" style={{ width: 27, height: 27, objectFit: "cover", borderRadius: 3 }} /> : null; })}</div></div>; })}{upstream.map((ref) => thumbnail(ref, true))}{!upstream.length && !characterAssets.length ? <span style={{ padding: 8, color: ctx.theme.node.placeholder, fontSize: 10 }}>连接素材</span> : null}</div><div style={{ marginTop: "auto", padding: 8, borderTop: `1px solid ${ctx.theme.node.stroke}`, fontSize: 10, color: ctx.theme.node.muted }}>▱ Output</div></div>
                <div style={{ minWidth: 0, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, background: ctx.theme.node.panel, display: "grid", placeItems: "center", position: "relative", overflow: "hidden" }}>{preview && (content || videoRefs.length) ? <video src={preview} controls muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : preview ? <img src={preview} alt="H3 reference" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ color: ctx.theme.node.placeholder, fontSize: 12 }}>连接视频和角色参考图</span>}{status === "loading" ? <span style={{ position: "absolute", bottom: 8, left: 8, padding: "5px 8px", borderRadius: 5, background: "#111c", fontSize: 10 }}>✧ 生成中 · 输入参考</span> : null}</div>
            </div>
            <div style={{ padding: "0 8px 8px", minHeight: 82 }}><div style={{ height: 25, display: "flex", alignItems: "center", gap: 8, color: ctx.theme.node.muted, fontSize: 10, borderBottom: `1px solid ${ctx.theme.node.stroke}` }}><button type="button" onClick={() => { const next = Number(metadata.playhead || 0) >= total ? 0 : total; ctx.updateMetadata({ playhead: next }); }} style={{ ...buttonStyle(ctx), padding: "2px 5px" }}>▶</button><span>{Number(metadata.playhead || 0).toFixed(1)}s</span>{[0, 1, 2, 3, 4].map((tick) => <span key={tick} style={{ flex: 1 }}>{Math.round(total * tick / 4)}s</span>)}</div><div style={{ display: "flex", gap: 4, height: 48, padding: "5px 0", overflowX: "auto" }}>{segmentList.map((segment, index) => <div key={segment.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-infinite-canvas-clip", segment.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dragged = event.dataTransfer.getData("application/x-infinite-canvas-clip"); if (!dragged || dragged === segment.id) return; const from = segmentList.findIndex((item) => item.id === dragged); const to = segmentList.findIndex((item) => item.id === segment.id); if (from < 0 || to < 0) return; const next = [...segmentList]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: dragged }); }} style={{ flex: `0 0 ${Math.max(110, (Number(segment.duration || 1) / total) * 100)}px`, minWidth: 110, border: `1px solid ${segment.id === selected?.id ? ctx.theme.toolbar.activeText : ctx.theme.node.stroke}`, borderRadius: 5, background: segment.id === selected?.id ? ctx.theme.toolbar.activeBg : ctx.theme.node.panel, display: "grid", gridTemplateColumns: "20px 1fr 22px 20px", alignItems: "center", gap: 3, padding: 3, cursor: "grab" }}><button type="button" onClick={() => updateSegmentSelection(segment.id)} style={{ border: 0, background: "transparent", color: ctx.theme.toolbar.activeText, cursor: "pointer" }}>〰</button><button type="button" onClick={() => updateSegmentSelection(segment.id)} style={{ border: 0, background: "transparent", color: ctx.theme.node.text, textAlign: "center", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Clip {index + 1}<br /><small>{Number(segment.start || 0).toFixed(0)}s - {(Number(segment.start || 0) + Number(segment.duration || 0)).toFixed(0)}s</small></button><span style={{ fontSize: 10 }}>⌕{refsForSegment(segment).length}</span><button type="button" disabled={segmentList.length <= 1} onClick={() => { if (segmentList.length <= 1) return; const next = segmentList.filter((item) => item.id !== segment.id); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: next[Math.max(0, index - 1)]?.id || "" }); }} style={{ border: 0, background: "transparent", color: ctx.theme.node.muted, cursor: "pointer" }}>×</button></div>)}<button type="button" onClick={() => { const next = compactSegmentStarts([...segmentList, { id: `segment-${Date.now()}`, prompt: String(metadata.prompt || defaultPrompt), duration: Number(metadata.duration || 5), status: "idle" }]); ctx.updateMetadata({ segments: next, selectedSegmentId: next[next.length - 1].id }); }} style={{ ...buttonStyle(ctx), minWidth: 38, padding: 0 }}>＋</button></div></div>
            <div onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); const ref = normalizeDroppedRef(event); if (!ref || !selected) return; const existing = refsForSegment(selected); if (existing.some((item) => item.url === ref.url)) return; patchSelectedSegment(ctx, metadata, { refItems: [...(selected.refItems || []), ref], refs: { image: [...(selected.refs?.image || []), ...(ref.type === "image" ? [ref] : [])], video: [...(selected.refs?.video || []), ...(ref.type === "video" ? [ref] : [])], audio: [...(selected.refs?.audio || []), ...(ref.type === "audio" ? [ref] : [])] } }); }} style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, padding: "7px 10px", display: "grid", gridTemplateColumns: "75px 1fr", gap: 8, minHeight: 65, boxSizing: "border-box" }}><div style={{ display: "flex", alignItems: "center", fontSize: 11, fontWeight: 800, color: ctx.theme.node.muted }}>Clip {Math.max(1, segmentList.findIndex((item) => item.id === selected?.id) + 1)}<br /><small>{Number(selected?.start || 0).toFixed(0)}s - {(Number(selected?.start || 0) + Number(selected?.duration || 0)).toFixed(0)}s</small></div><div style={{ display: "flex", gap: 6, overflowX: "auto", alignItems: "center" }}>{[...imageRefs, ...videoRefs, ...audioRefs].map((ref) => <div key={ref.url} style={{ position: "relative", flex: "0 0 82px" }}>{thumbnail(ref, true)}<button type="button" onClick={() => patchSelectedSegment(ctx, metadata, { refItems: (selected?.refItems || []).filter((item) => item.url !== ref.url), refs: { image: (selected?.refs?.image || []).filter((item) => item.url !== ref.url), video: (selected?.refs?.video || []).filter((item) => item.url !== ref.url), audio: (selected?.refs?.audio || []).filter((item) => item.url !== ref.url) } })} style={{ position: "absolute", top: 2, right: 2, border: 0, borderRadius: 4, background: "#111c", color: "#fff", cursor: "pointer", lineHeight: 1 }}>×</button></div>)}{!refs.length ? <span style={{ color: ctx.theme.node.placeholder, fontSize: 10 }}>Refs：从 Assets 拖入当前 Clip</span> : null}</div></div>
            {selected ? <div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 220px", gap: 10, padding: "8px 10px", minHeight: 170, overflow: "hidden" }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 800 }}><span>⌘ Prompt</span><button type="button" onClick={() => ctx.updateMetadata({ prompt: String(selected.prompt || "") })} style={{ ...buttonStyle(ctx), padding: "3px 7px" }}>智能分镜</button></div>
                    <textarea value={String(selected.prompt || "")} onChange={(event) => ctx.updateMetadata({ segments: segmentList.map((item) => item.id === selected.id ? { ...item, prompt: event.target.value } : item), prompt: event.target.value })} rows={6} style={{ width: "100%", flex: 1, minHeight: 100, resize: "none", boxSizing: "border-box", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, padding: 8, background: ctx.theme.node.panel, color: ctx.theme.node.text, fontSize: 11, lineHeight: 1.4 }} />
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{["多参考", "模板", "定义", "摘要", "保留", "分辨", "声景", "配乐"].map((label) => <button type="button" key={label} onClick={() => { const tag = label === "多参考" ? "@图片1" : label === "定义" ? "<Subject 1>" : label === "分辨" ? "<Video 1>" : label === "声景" ? "<Audio 1>" : ""; if (tag) patchSelectedSegment(ctx, metadata, { prompt: `${String(selected.prompt || "")}${selected.prompt ? "\n" : ""}${tag}` }); }} style={{ ...buttonStyle(ctx), padding: "3px 7px", fontSize: 10 }}>{label}</button>)}</div>
                </div>
                <div style={{ borderLeft: `1px solid ${ctx.theme.node.stroke}`, paddingLeft: 10, display: "flex", flexDirection: "column", gap: 5, overflow: "auto" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontWeight: 800 }}>☷ Clip settings<span style={{ display: "flex", gap: 4 }}><button type="button" onClick={() => replaceSelectedWithSourceSplits(ctx, metadata)} style={{ ...buttonStyle(ctx), padding: "4px 6px" }}>✂ 分段</button><button type="button" onClick={() => { ctx.openPanel(); setTimeout(() => ctx.emit("minimax-h3:run", { nodeId: ctx.node.id }), 0); }} style={{ ...buttonStyle(ctx, true), padding: "4px 8px" }}>✧ Generate clip</button></span></div><label style={{ fontSize: 10 }}>任务模式<select value={String(selected.taskMode || "r2v")} onChange={(event) => ctx.updateMetadata({ segments: segmentList.map((item) => item.id === selected.id ? { ...item, taskMode: event.target.value } : item) })} style={{ width: "100%", marginTop: 3, padding: 5, background: ctx.theme.node.panel, color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5 }}><option value="r2v">参考主体</option><option value="rv2v">视频编辑</option><option value="i2v">图生视频</option></select></label><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}><label style={{ fontSize: 10 }}>Duration<input value={Number(selected.duration || 0)} type="number" onChange={(event) => ctx.updateMetadata({ segments: segmentList.map((item) => item.id === selected.id ? { ...item, duration: Number(event.target.value) } : item) })} style={{ width: "100%", marginTop: 3, boxSizing: "border-box", background: ctx.theme.node.panel, color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, padding: 5 }} /></label><label style={{ fontSize: 10 }}>Megapixels<input value={Number(selected.megapixels || metadata.megapixels || 1)} type="number" step="0.1" onChange={(event) => ctx.updateMetadata({ segments: segmentList.map((item) => item.id === selected.id ? { ...item, megapixels: Number(event.target.value) } : item) })} style={{ width: "100%", marginTop: 3, boxSizing: "border-box", background: ctx.theme.node.panel, color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, padding: 5 }} /></label></div><label style={{ fontSize: 10 }}>Aspect ratio<select value={String(selected.aspectRatio || "16:9 (Widescreen)")} onChange={(event) => ctx.updateMetadata({ segments: segmentList.map((item) => item.id === selected.id ? { ...item, aspectRatio: event.target.value } : item) })} style={{ width: "100%", marginTop: 3, padding: 5, background: ctx.theme.node.panel, color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5 }}><option>16:9 (Widescreen)</option><option>9:16 (Portrait Widescreen)</option><option>1:1 (Square)</option><option>4:3 (Standard)</option></select></label><Toggle ctx={ctx} label="Motion Context" value={selected.motionContextEnabled !== false} onChange={(value) => ctx.updateMetadata({ segments: segmentList.map((item) => item.id === selected.id ? { ...item, motionContextEnabled: value, tailFrameEnabled: value } : item) })} /></div>
                </div> : null}
            <div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, padding: "7px 10px", display: "flex", flexDirection: "column", gap: 6 }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><span style={{ fontSize: 10, color: ctx.theme.node.muted }}>全局参数</span><label style={{ fontSize: 10 }}>MP <input type="number" min="0.1" max="2" step="0.1" value={Number(metadata.minimaxGlobalMegapixels || metadata.megapixels || 1)} onChange={(event) => ctx.updateMetadata({ minimaxGlobalMegapixels: Number(event.target.value) })} style={{ width: 48, padding: 3, background: ctx.theme.node.panel, color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 4 }} /></label><label style={{ fontSize: 10 }}>Steps <input type="number" min="1" max="60" value={Number(metadata.minimaxGlobalVideoSteps || metadata.videoSteps || 8)} onChange={(event) => ctx.updateMetadata({ minimaxGlobalVideoSteps: Number(event.target.value) })} style={{ width: 48, padding: 3, background: ctx.theme.node.panel, color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 4 }} /></label><Toggle ctx={ctx} label="Global LoRA" value={metadata.minimaxGlobalLoraEnabled !== false} onChange={(value) => ctx.updateMetadata({ minimaxGlobalLoraEnabled: value })} /><Toggle ctx={ctx} label="Global TE" value={metadata.minimaxGlobalTeAccel === true} onChange={(value) => ctx.updateMetadata({ minimaxGlobalTeAccel: value })} /><button type="button" onClick={() => { ctx.openPanel(); setTimeout(() => ctx.emit("minimax-h3:run", { nodeId: ctx.node.id, all: true }), 0); }} style={{ ...buttonStyle(ctx, true), marginLeft: "auto", padding: "5px 9px" }}>☷ 一键运行全部 Clip</button></div><div style={{ display: "flex", gap: 6, alignItems: "center", color: ctx.theme.node.muted, fontSize: 10 }}><span>模型</span><span style={{ padding: "3px 6px", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 4 }}>{String(metadata.minimaxBaseModel || metadata.modelName || "10Eros Max H3")}</span><span>LoRA</span><span style={{ padding: "3px 6px", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 4 }}>{metadata.minimaxGlobalLoraEnabled === false ? "关闭" : "启用"}</span><span style={{ marginLeft: "auto" }}>{upstream.length} 个输入 · {refs.length} 个当前 Refs</span></div></div>
            {outputResults.length ? <div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, padding: "6px 10px", display: "flex", gap: 6, alignItems: "center", overflowX: "auto" }}><span style={{ color: ctx.theme.node.muted, fontSize: 10, flex: "0 0 auto" }}>▱ Output</span>{outputResults.map((result) => <div key={result.url} style={{ position: "relative", width: 82, height: 46, flex: "0 0 82px", borderRadius: 4, overflow: "hidden", border: `1px solid ${ctx.theme.node.stroke}` }}><video src={result.url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} /><span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 8, background: "#111c", color: "#fff", padding: "1px 3px" }}>{result.name}</span></div>)}</div> : null}
            {error ? <div style={{ color: "#ef4444", fontSize: 10, lineHeight: 1.4, padding: "0 10px 6px", maxHeight: 30, overflow: "auto" }}>{error}</div> : null}
        </div>
    );
}

function H3Icon({ name }: { name: "clapperboard" | "play" | "plus" | "download" | "settings" | "database" | "output" | "sparkles" | "paperclip" | "waves" | "trash" | "close" | "prompt" | "sliders" }) {
    const paths: Record<string, string> = {
        clapperboard: "M4 4h16v16H4z M4 8h16 M8 4l3 4 M14 4l3 4",
        play: "M8 5l11 7-11 7z",
        plus: "M12 5v14 M5 12h14",
        download: "M12 4v11 M7 11l5 5 5-5 M5 20h14",
        settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 12h2m12 0h2M12 4v2m0 12v2",
        database: "M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0z M4 6c0 2 16 2 16 0 M4 12c0 2 16 2 16 0",
        output: "M5 5h14v14H5z M8 12h8m-4-4 4 4-4 4",
        sparkles: "M12 3l1.5 6.5L20 11l-6.5 1.5L12 19l-1.5-6.5L4 11l6.5-1.5z",
        paperclip: "M8 12.5l5.5-5.5a3 3 0 0 1 4 4l-7 7a5 5 0 0 1-7-7l7-7",
        waves: "M4 8c2-4 4 4 6 0s4 4 6 0 3 1 4 0 M4 12c2-4 4 4 6 0s4 4 6 0 3 1 4 0",
        trash: "M5 7h14m-9 4v5m4-5v5M9 7V4h6v3m-9 0 1 13h10l1-13",
        close: "M6 6l12 12M18 6L6 18",
        prompt: "M5 5h14v14H5z M8 9h8M8 13h5",
        sliders: "M4 7h16M4 12h16M4 17h16 M8 5v4m8-2v4m-5 3v4",
    };
    return <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function H3PaneHandles({ ctx }: { ctx: CanvasNodeContext }) {
    const begin = (pane: "library" | "preview" | "video" | "refs", event: React.PointerEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const metadata = ctx.node.metadata || {};
        const initial = {
            library: Math.max(170, Math.min(520, Number(metadata.minimaxLibraryW || 190))),
            preview: Math.max(130, Math.min(760, Number(metadata.minimaxPreviewH || 220))),
            video: Math.max(48, Math.min(180, Number(metadata.minimaxVideoTrackH || 74))),
            refs: Math.max(30, Math.min(130, Number(metadata.minimaxRefLaneH || 36))),
        };
        const onMove = (move: PointerEvent) => {
            const dx = move.clientX - startX;
            const dy = move.clientY - startY;
            const bounds: Record<typeof pane, [number, number, number]> = {
                library: [170, 520, initial.library + dx],
                preview: [130, 760, initial.preview + dy],
                video: [48, 180, initial.video + dy],
                refs: [30, 130, initial.refs + dy],
            };
            const [min, max, next] = bounds[pane];
            const key = pane === "library" ? "minimaxLibraryW" : pane === "preview" ? "minimaxPreviewH" : pane === "video" ? "minimaxVideoTrackH" : "minimaxRefLaneH";
            ctx.updateMetadata({ [key]: Math.round(Math.max(min, Math.min(max, next))) });
        };
        const onUp = () => { window.removeEventListener("pointermove", onMove, true); window.removeEventListener("pointerup", onUp, true); };
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
    };
    return <div style={{ display: "contents" }}>
        <span key="library" className="minimax-pane-resize minimax-library-resize" onPointerDown={(event) => begin("library", event)} />
        <span key="preview" className="minimax-pane-resize minimax-preview-resize" onPointerDown={(event) => begin("preview", event)} />
        <span key="video" className="minimax-pane-resize minimax-video-resize" onPointerDown={(event) => begin("video", event)} />
        <span key="refs" className="minimax-pane-resize minimax-ref-resize" onPointerDown={(event) => begin("refs", event)} />
    </div>;
}

function H3PlayheadStyle({ percent }: { percent: number }) {
    const safe = Math.max(0, Math.min(100, percent));
    const position = `calc(52px + ${safe}% - ${safe * 1.06}px)`;
    return <style>{`.minimax-canvas-workbench .minimax-edit-timeline::after{left:${position}}.minimax-canvas-workbench .minimax-edit-timeline::before{content:"";display:block;position:absolute;z-index:15;top:0;left:${position};width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #f8fafc;transform:translateX(-50%);pointer-events:none}`}</style>;
}

function requestH3Run(ctx: CanvasNodeContext, all = false) {
    const node = ctx.getNode(ctx.node.id) || ctx.node;
    const metadata = node.metadata || {};
    if (["queued", "loading"].includes(String(metadata.status))) return;
    const segments = segmentsFor(metadata);
    const selectedId = String(metadata.selectedSegmentId || segments[0]?.id || "");
    const selectedSegment = segments.find((s) => s.id === selectedId) || segments[0];
    // 从 DOM 读取当前 textarea 的 prompt 值（H3Panel 和 H3ContentExact）
    const panelTextarea = document.querySelector<HTMLTextAreaElement>(`textarea[placeholder="描述动作、镜头与角色替换要求"]`);
    const workbenchTextarea = document.querySelector<HTMLTextAreaElement>(`.minimax-canvas-workbench .minimax-current-panel textarea`);
    const domPrompt = panelTextarea?.value?.trim() || workbenchTextarea?.value?.trim() || "";
    // 优先使用 DOM 值，其次是 selected segment 的 prompt
    const currentPrompt = domPrompt || selectedSegment?.prompt || "";
    const nextSegments = segments.map((segment) => {
        const shouldRun = all || segment.id === selectedId;
        if (!shouldRun) return segment;
        // 如果当前 segment 是选中的，优先使用 DOM 值，其次使用 segment 的现有值
        const newPrompt = segment.id === selectedId && (currentPrompt || segment.prompt) ? (currentPrompt || segment.prompt) : segment.prompt;
        return { ...segment, status: "queued", progress: 0, runtimeTaskId: "", prompt: newPrompt };
    });
    ctx.updateMetadata({
        selectedSegmentId: selectedId,
        segments: nextSegments,
        prompt: currentPrompt || selectedSegment?.prompt || metadata.prompt,
        status: "queued",
        runRequestId: `h3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        runRequestAll: all,
        runRequestConsumedId: "",
        runtimeTaskId: "",
        runProgress: 0,
        runStartedAt: Date.now(),
        runFinishedAt: undefined,
        errorDetails: "",
    });
    ctx.openPanel();
    // Keep the event for already-mounted panels; the request metadata above
    // is the durable fallback for panels that mount after this event fires.
    setTimeout(() => ctx.emit("minimax-h3:run", { nodeId: ctx.node.id, requestId: `h3-${Date.now()}`, all }), 0);
}

function h3LogMedia(ref: H3Ref) {
    return { url: ref.url, name: ref.name, type: ref.type, ...(ref.storageKey ? { storageKey: ref.storageKey } : {}) };
}

async function createH3Log(ctx: CanvasNodeContext, segment: H3Segment | undefined, prompt: string, refs: H3Ref[], params: Record<string, unknown>) {
    try {
        return await ctx.generationLogs.create({
            projectId: ctx.projectId, nodeId: ctx.node.id, segmentId: segment?.id, status: "queued",
            platform: String(params.engine || "ComfyUI"), workflow: String(params.workflow || "MiniMax H3"), model: String(params.modelName || ""),
            taskMode: String(params.taskMode || segment?.taskMode || "r2v"), prompt, references: refs.map(h3LogMedia),
            inputCounts: { image: refs.filter((ref) => ref.type === "image").length, video: refs.filter((ref) => ref.type === "video").length, audio: refs.filter((ref) => ref.type === "audio").length },
            startedAt: new Date().toISOString(), durationMs: 0, outputs: [], params,
        });
    } catch (error) {
        console.warn("[minimax-h3] failed to create generation log", error);
        return null;
    }
}

async function finishH3Log(ctx: CanvasNodeContext, taskId: string, status: "success" | "failed" | "cancelled", patch: Record<string, unknown>) {
    try {
        const logs = await ctx.generationLogs.list({ projectId: ctx.projectId, nodeId: ctx.node.id, limit: 500 });
        const log = logs.find((item) => item.runtimeTaskId === taskId);
        if (log) await ctx.generationLogs.update(log.id, { status, ...patch });
    } catch (error) { console.warn("[minimax-h3] failed to update generation log", error); }
}

function H3StatusBadge({ status, error, onRetry }: { status: string; error: string; onRetry: () => void }) {
    if (!status || status === "idle") return null;
    const label = status === "queued" ? "排队中…" : status === "loading" ? "生成中…" : status === "success" ? "已完成" : status === "cancelled" ? "已取消" : status === "error" ? `失败：${error || "未知错误"}` : status;
    return <div className={`minimax-status-badge ${status}`}><span>{label}</span>{status === "error" ? <button type="button" onClick={(event) => { event.stopPropagation(); onRetry(); }}>重试</button> : null}</div>;
}

function resetH3Run(ctx: CanvasNodeContext) {
    const node = ctx.getNode(ctx.node.id) || ctx.node;
    const segments = segmentsFor(node.metadata || {}).map((segment) => ({ ...segment, result: "", results: [], status: "idle", progress: 0, runtimeTaskId: "" }));
    ctx.updateMetadata({ content: "", mimeType: undefined, naturalWidth: undefined, naturalHeight: undefined, durationMs: undefined, materials: [], segments, status: "idle", errorDetails: "", runtimeTaskId: "", runProgress: 0, runRequestId: "", runRequestConsumedId: "", runFinishedAt: undefined });
}

function H3RulerScrubber({ ctx, total, previewH, libraryW }: { ctx: CanvasNodeContext; total: number; previewH: number; libraryW: number }) {
    const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const apply = (clientX: number) => ctx.updateMetadata({ playhead: Math.max(0, Math.min(total, ((clientX - rect.left) / Math.max(1, rect.width)) * total)) });
        apply(event.clientX);
        const move = (moveEvent: PointerEvent) => apply(moveEvent.clientX);
        const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
    };
    return <div className="minimax-ruler-scrubber" style={{ left: `calc(${libraryW}px + 68px)`, top: `calc(50px + ${previewH}px + 8px)` }} onPointerDown={scrub} />;
}

function H3PreviewPlayer({ ctx, url, kind, playhead, playRequest }: { ctx: CanvasNodeContext; url: string; kind: "image" | "video" | "audio"; playhead: number; playRequest: number }) {
    const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
    useEffect(() => { const media = mediaRef.current; if (!media || !playRequest) return; if (media.paused) void media.play().catch(() => undefined); else media.pause(); }, [playRequest]);
    if (!url) return <div className="minimax-player-content"><div className="minimax-player-empty">连接视频和角色参考图</div></div>;
    if (kind === "audio") return <div className="minimax-player-content"><div className="minimax-player-empty"><H3Icon name="output" /><span>音频参考</span><audio ref={(node) => { mediaRef.current = node; }} src={url} controls preload="metadata" /></div></div>;
    if (kind === "image") return <div className="minimax-player-content minimax-player-image"><img src={url} alt="H3 reference" /></div>;
    return <div className="minimax-player-content"><video ref={(node) => { mediaRef.current = node; }} src={url} controls muted playsInline onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.max(0, playhead); }} onTimeUpdate={(event) => { const time = Number(event.currentTarget.currentTime || 0); if (Math.abs(time - Number(ctx.node.metadata?.playhead || 0)) > 0.2) ctx.updateMetadata({ playhead: time }); }} /></div>;
}

function h3PreviewUrl(url: string) {
    const raw = String(url || "");
    if (!raw || /^(data|blob):/i.test(raw)) return raw;
    if (/^\/(assets|output)\//i.test(raw)) return `/api/media-preview?w=512&url=${encodeURIComponent(raw)}`;
    return raw;
}

function H3VideoPreviewFallback({ ctx }: { ctx: CanvasNodeContext }) {
    useEffect(() => {
        const root = document.querySelector<HTMLElement>(`.minimax-canvas-workbench[data-h3-node-id="${CSS.escape(ctx.node.id)}"]`);
        if (!root) return;
        root.querySelectorAll<HTMLVideoElement>(".minimax-clip-media video, .minimax-material-card video, .minimax-ref-media video").forEach((video) => {
            if (!video.poster && video.currentSrc) video.poster = h3PreviewUrl(video.currentSrc);
        });
    }, [ctx.node.id]);
    return null;
}

function H3TransportBinder({ ctx }: { ctx: CanvasNodeContext }) {
    useEffect(() => {
        const root = document.querySelector<HTMLElement>(`.minimax-canvas-workbench[data-h3-node-id="${CSS.escape(ctx.node.id)}"]`);
        if (!root) return;
        const onClick = (event: Event) => {
            const target = event.target instanceof Element ? event.target.closest(".minimax-transport button:first-child, .minimax-timeline-controls button") : null;
            if (target) ctx.updateMetadata({ h3PlayRequest: Date.now() });
        };
        root.addEventListener("click", onClick);
        return () => root.removeEventListener("click", onClick);
    }, [ctx.node.id]);
    return null;
}

function H3PromptEnhanceBinder({ ctx, segment }: { ctx: CanvasNodeContext; segment: H3Segment | undefined }) {
    useEffect(() => {
        const root = document.querySelector<HTMLElement>(`.minimax-canvas-workbench[data-h3-node-id="${CSS.escape(ctx.node.id)}"]`);
        if (!root) return;
        const onClick = async (event: Event) => {
            const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".minimax-prompt-field > span > button") : null;
            const firstButton = root.querySelector<HTMLButtonElement>(".minimax-prompt-field > span > button");
            if (!target || target !== firstButton || !segment) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const original = target.textContent || "增强";
            target.disabled = true;
            target.textContent = "增强中…";
            try {
                const result = await ctx.ai.generateText(String(segment.prompt || ""), { model: String(ctx.node.metadata?.minimaxLlmModel || ctx.node.metadata?.llmModel || ""), system: "你是 MiniMax H3 视频提示词整理器。只补充镜头、动作、主体一致性和时序信息，不改变用户意图，不添加免责声明。" });
                if (result.text.trim()) {
                    const metadata = ctx.node.metadata || {};
                    const segments = segmentsFor(metadata);
                    ctx.updateMetadata({ prompt: result.text.trim(), segments: segments.map((item) => item.id === segment.id ? { ...item, prompt: result.text.trim() } : item), minimaxPromptEnhance: true });
                }
            } catch (error) {
                ctx.updateMetadata({ errorDetails: error instanceof Error ? error.message : String(error), status: "error" });
            } finally {
                target.disabled = false;
                target.textContent = original;
            }
        };
        root.addEventListener("click", onClick, true);
        return () => root.removeEventListener("click", onClick, true);
    }, [ctx.node.id, segment?.id, segment?.prompt]);
    return null;
}

function H3PromptInsertBinder({ ctx, segment }: { ctx: CanvasNodeContext; segment: H3Segment | undefined }) {
    useEffect(() => {
        const root = document.querySelector<HTMLElement>(`.minimax-canvas-workbench[data-h3-node-id="${CSS.escape(ctx.node.id)}"]`);
        if (!root) return;
        const onClick = (event: Event) => {
            const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".minimax-prompt-field button") : null;
            if (!target || !segment || target.textContent?.trim() === "增强") return;
            const textarea = root.querySelector<HTMLTextAreaElement>(".minimax-prompt-field textarea");
            if (!textarea) return;
            const label = target.textContent?.trim() || "";
            const insert = label.startsWith("@图片") ? `@图片${Math.max(1, refsForSegment(segment).filter((item) => item.type === "image").length)}` : label.startsWith("@视频") ? `@视频${Math.max(1, refsForSegment(segment).filter((item) => item.type === "video").length)}` : label.startsWith("@音频") ? `@音频${Math.max(1, refsForSegment(segment).filter((item) => item.type === "audio").length)}` : label.startsWith("《") ? label : "";
            if (!insert) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const start = textarea.selectionStart ?? textarea.value.length;
            const end = textarea.selectionEnd ?? start;
            const nextPrompt = `${textarea.value.slice(0, start)}${insert}${textarea.value.slice(end)}`;
            ctx.updateMetadata({ prompt: nextPrompt, segments: segmentsFor(ctx.node.metadata || {}).map((item) => item.id === segment.id ? { ...item, prompt: nextPrompt } : item) });
            requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + insert.length, start + insert.length); });
        };
        root.addEventListener("click", onClick, true);
        return () => root.removeEventListener("click", onClick, true);
    }, [ctx.node.id, segment?.id, segment?.prompt]);
    return null;
}

function H3RefSelectionBinder({ ctx, segments, total }: { ctx: CanvasNodeContext; segments: H3Segment[]; total: number }) {
    useEffect(() => {
        const root = document.querySelector<HTMLElement>(`.minimax-canvas-workbench[data-h3-node-id="${CSS.escape(ctx.node.id)}"]`);
        if (!root) return;
        root.querySelectorAll<HTMLElement>(".minimax-ref-clip.has-ref").forEach((element) => element.setAttribute("draggable", "true"));
        root.querySelectorAll<HTMLElement>(".minimax-output-item").forEach((element) => element.setAttribute("draggable", "true"));
    const onClick = (event: Event) => {
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.minimax-ref-clip') : null;
            if (!target || !root.contains(target) || (event.target instanceof Element && event.target.closest('button'))) return;
            const track = target.closest<HTMLElement>('.minimax-ref-track');
            if (!track) return;
            const trackRect = track.getBoundingClientRect();
            const clipRect = target.getBoundingClientRect();
            const time = Math.max(0, Math.min(total, ((clipRect.left + clipRect.width / 2 - trackRect.left) / Math.max(1, trackRect.width)) * total));
            const segment = segments.find((item) => time >= Number(item.start || 0) && time < Number(item.start || 0) + Math.max(0.5, Number(item.duration || 1))) || segments[0];
            if (segment) ctx.updateMetadata({ selectedSegmentId: segment.id, playhead: Number(segment.start || 0) });
    };
    const onDragStart = (event: Event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(".minimax-ref-clip.has-ref");
        const outputTarget = (event.target as HTMLElement).closest<HTMLElement>(".minimax-output-item");
        if (outputTarget) {
            const mediaUrl = outputTarget.querySelector("img,video")?.getAttribute("src") || "";
            const output = segments.flatMap((item, index) => [...(item.results || []), ...(resultUrl(item.result) ? [{ url: resultUrl(item.result), type: "video" as const, name: `Clip ${index + 1}` }] : [])]).find((item) => item.url === mediaUrl || mediaUrl.endsWith(item.url) || item.url.endsWith(mediaUrl));
            if (!output) return;
            const drag = event as DragEvent;
            drag.stopPropagation();
            drag.dataTransfer?.setData("application/x-infinite-canvas-output", JSON.stringify(output));
            if (drag.dataTransfer) drag.dataTransfer.effectAllowed = "copy";
            return;
        }
        if (!target) return;
        const mediaUrl = target.querySelector("img,video")?.getAttribute("src") || "";
        const ref = segments.flatMap((item) => refsForSegment(item)).find((item) => item.url === mediaUrl || mediaUrl.endsWith(item.url) || item.url.endsWith(mediaUrl));
        if (!ref) return;
        const drag = event as DragEvent;
        drag.stopPropagation();
        drag.dataTransfer?.setData("application/x-infinite-canvas-ref", JSON.stringify(ref));
        const track = target.closest<HTMLElement>(".minimax-ref-track");
        const lane = target.closest<HTMLElement>(".minimax-ref-lane");
        if (track && lane) {
            const trackRect = track.getBoundingClientRect();
            const clipRect = target.getBoundingClientRect();
            const time = Math.max(0, Math.min(total, ((clipRect.left + clipRect.width / 2 - trackRect.left) / Math.max(1, trackRect.width)) * total));
            const sourceSegment = segments.find((item) => time >= Number(item.start || 0) && time < Number(item.start || 0) + Math.max(0.5, Number(item.duration || 1)));
            const laneIndex = Array.from(lane.parentElement?.children || []).indexOf(lane);
            if (sourceSegment && laneIndex >= 0) drag.dataTransfer?.setData("application/x-infinite-canvas-ref-position", JSON.stringify({ segmentId: sourceSegment.id, index: laneIndex }));
        }
        if (drag.dataTransfer) drag.dataTransfer.effectAllowed = "copy";
    };
    const onDropCapture = (event: Event) => {
        const drag = event as DragEvent;
        const currentRefs = (event.target as HTMLElement).closest<HTMLElement>(".minimax-current-ref-items");
        if (currentRefs) {
            const raw = drag.dataTransfer?.getData("application/x-infinite-canvas-ref") || drag.dataTransfer?.getData("application/json") || drag.dataTransfer?.getData("text/plain");
            if (raw) {
                try {
                    const value = JSON.parse(raw) as Record<string, unknown>;
                    const url = String(value.url || value.dataUrl || value.localUrl || value.originalLocalUrl || value.sourceUrl || value.path || "").trim();
                    const kind = String(value.kind || value.type || "image").toLowerCase();
                    const storageKey = String(value.storageKey || "").trim();
                    const ref: H3Ref = { url, name: String(value.name || "Ref"), type: kind.startsWith("video") ? "video" : kind.startsWith("audio") ? "audio" : "image", ...(storageKey ? { storageKey } : {}) };
                    const metadata = ctx.node.metadata || {};
                    const currentSegments = segmentsFor(metadata);
                    const selectedId = String(metadata.selectedSegmentId || currentSegments[0]?.id || "");
                    const selectedSegment = currentSegments.find((item) => item.id === selectedId);
                    if (ref.url && selectedSegment && !refsForSegment(selectedSegment).some((item) => sameRef(item, ref))) {
                        const nextRefs = [...refsForSegment(selectedSegment), ref];
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        ctx.updateMetadata({ selectedSegmentId: selectedSegment.id, segments: currentSegments.map((item) => item.id === selectedSegment.id ? { ...item, refItems: nextRefs, refs: { image: nextRefs.filter((item) => item.type === "image"), video: nextRefs.filter((item) => item.type === "video"), audio: nextRefs.filter((item) => item.type === "audio") } } : item) });
                    }
                } catch { /* ignore malformed asset payloads */ }
            }
            return;
        }
        const refPosition = drag.dataTransfer?.getData("application/x-infinite-canvas-ref-position");
        const refTarget = (event.target as HTMLElement).closest<HTMLElement>(".minimax-ref-clip.has-ref");
        if (refPosition && refTarget) {
            try {
                const from = JSON.parse(refPosition) as { segmentId: string; index: number };
                const track = refTarget.closest<HTMLElement>(".minimax-ref-track");
                const lane = refTarget.closest<HTMLElement>(".minimax-ref-lane");
                if (track && lane) {
                    const trackRect = track.getBoundingClientRect();
                    const clipRect = refTarget.getBoundingClientRect();
                    const time = Math.max(0, Math.min(total, ((clipRect.left + clipRect.width / 2 - trackRect.left) / Math.max(1, trackRect.width)) * total));
                    const toSegment = segments.find((item) => time >= Number(item.start || 0) && time < Number(item.start || 0) + Math.max(0.5, Number(item.duration || 1)));
                    const toIndex = Array.from(lane.parentElement?.children || []).indexOf(lane);
                    if (toSegment && from.segmentId === toSegment.id && Number.isInteger(from.index) && Number.isInteger(toIndex) && from.index !== toIndex) {
                        const source = segments.find((item) => item.id === from.segmentId);
                        if (source) {
                            const nextRefs = refsForSegment(source);
                            const [moved] = nextRefs.splice(from.index, 1);
                            if (moved) { nextRefs.splice(toIndex, 0, moved); event.preventDefault(); event.stopImmediatePropagation(); ctx.updateMetadata({ selectedSegmentId: source.id, segments: segments.map((item) => item.id === source.id ? { ...item, refItems: nextRefs, refs: { image: nextRefs.filter((item) => item.type === "image"), video: nextRefs.filter((item) => item.type === "video"), audio: nextRefs.filter((item) => item.type === "audio") } } : item) }); return; }
                        }
                    }
                }
            } catch { /* ignore malformed ref positions */ }
        }
        const target = (event.target as HTMLElement).closest<HTMLElement>(".minimax-tl-clip");
        const raw = drag.dataTransfer?.getData("application/x-infinite-canvas-output");
        if (!target || !raw) return;
        try {
            const output = JSON.parse(raw) as H3Ref;
            const track = root.querySelector<HTMLElement>(".minimax-video-track");
            const rect = target.getBoundingClientRect();
            const segment = segments.find((item) => item.id === target.dataset.segmentId) || segments.find((item) => { const start = Number(item.start || 0); const width = Math.max(0.5, Number(item.duration || 1)); const trackRect = track?.getBoundingClientRect(); const time = trackRect ? ((rect.left + rect.width / 2 - trackRect.left) / Math.max(1, trackRect.width)) * total : start; return time >= start && time < start + width; });
            if (!segment || !output.url) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            ctx.updateMetadata({ selectedSegmentId: segment.id, segments: segments.map((item) => item.id === segment.id ? { ...item, result: output.url, results: [output, ...(item.results || []).filter((candidate) => candidate.url !== output.url)], status: "success" } : item) });
        } catch { /* ignore malformed drag payloads */ }
    };
    root.addEventListener('click', onClick);
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('drop', onDropCapture, true);
    return () => { root.removeEventListener('click', onClick); root.removeEventListener('dragstart', onDragStart); root.removeEventListener('drop', onDropCapture, true); };
    }, [ctx.node.id, segments.map((item) => `${item.id}:${item.start}:${item.duration}`).join('|'), total]);
    return null;
}

export function H3ContentExact({ ctx }: CanvasNodeContentProps) {
    const metadata = ctx.node.metadata || {};
    const segments = segmentsFor(metadata);
    const selected = segments.find((item) => item.id === String(metadata.selectedSegmentId || "")) || segments[0];
    const selectedIndex = Math.max(0, segments.findIndex((item) => item.id === selected?.id));
    const upstream = readRefs(ctx);
    const selectedRefs = selected ? refsForSegment(selected) : [];
    const assets = [...upstream, ...segments.flatMap((item) => refsForSegment(item))].filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index);
    const outputs = [...(Array.isArray(metadata.materials) ? metadata.materials : []), ...segments.flatMap((item, index) => [...(item.results || []), ...(resultUrl(item.result) ? [{ url: resultUrl(item.result), type: "video", name: `Clip ${index + 1}` }] : [])])].map((item, index) => { const value = item && typeof item === "object" ? item as Record<string, unknown> : { url: String(item) } as Record<string, unknown>; const url = String(value.url || value.video_url || value.content || ""); const type = String(value.type || value.kind || "video").startsWith("image") ? "image" : String(value.type || value.kind || "video").startsWith("audio") ? "audio" : "video"; return url ? { url, type, name: String(value.name || `Clip ${index + 1}`) } as H3Ref : null; }).filter((item): item is H3Ref => Boolean(item)).filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index);
    const total = Math.max(1, segments.reduce((sum, item) => sum + Math.max(0.5, Number(item.duration || 1)), 0));
    const playhead = Math.max(0, Math.min(total, Number(metadata.playhead || 0)));
    const fmt = (value: number) => `${Number(value || 0).toFixed(Number(value || 0) % 1 ? 1 : 0)}s`;
    const selectedVideo = selectedRefs.find((item) => item.type === "video");
    const selectedImage = selectedRefs.find((item) => item.type === "image");
    const preview = resultUrl(selected?.result) || selectedVideo?.url || String(metadata.content || upstream.find((item) => item.type === "video")?.url || selectedImage?.url || "");
    const selectedResultRef = (selected?.results || []).find((item) => resultUrl(item.url) === preview || item.url === preview);
    const previewKind: H3Ref["type"] = selectedResultRef?.type || (resultUrl(selected?.result) ? "video" : selectedVideo ? "video" : selectedImage ? "image" : "video");
    const imageRefs = selectedRefs.filter((item) => item.type === "image");
    const videoRefs = selectedRefs.filter((item) => item.type === "video");
    const audioRefs = selectedRefs.filter((item) => item.type === "audio");
    const refLanes = Math.max(1, selectedRefs.length, ...segments.map((item) => refsForSegment(item).length));
    const previewH = Math.max(130, Math.min(760, Number(metadata.minimaxPreviewH || 220)));
    const videoTrackH = Math.max(48, Math.min(180, Number(metadata.minimaxVideoTrackH || 74)));
    const refLaneH = Math.max(30, Math.min(130, Number(metadata.minimaxRefLaneH || 36)));
    const libraryW = Math.max(170, Math.min(520, Number(metadata.minimaxLibraryW || 190)));
    const playRequest = Number(metadata.h3PlayRequest || 0);
    useEffect(() => {
        const workbench = Array.from(document.querySelectorAll<HTMLElement>('.minimax-canvas-workbench[data-h3-node-id]')).find((item) => item.dataset.h3NodeId === String(ctx.node.id));
        const button = workbench ? Array.from(workbench.querySelectorAll<HTMLButtonElement>('button')).find((item) => /Generate clip|Reset/.test(item.textContent || '')) : undefined;
        if (!button) return;
        const completed = String(metadata.status || selected?.status || '') === 'success';
        button.classList.toggle('minimax-reset', completed);
        button.classList.toggle('minimax-run', !completed);
        button.setAttribute('aria-label', completed ? 'Reset' : 'Generate clip');
        const textNode = Array.from(button.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.nodeValue = ` ${completed ? 'Reset' : 'Generate clip'}`;
    }, [ctx.node.id, metadata.status, selected?.id, selected?.status]);
    const patchSelected = (patch: Partial<H3Segment>) => selected && ctx.updateMetadata({ selectedSegmentId: selected.id, segments: segments.map((item) => item.id === selected.id ? { ...item, ...patch } : item) });
    const patchSegmentRefs = (segmentId: string, refUrl: string) => ctx.updateMetadata({ selectedSegmentId: segmentId, segments: segments.map((item) => { if (item.id !== segmentId) return item; const next = refsForSegment(item).filter((candidate) => candidate.url !== refUrl); return { ...item, refItems: next, refs: { image: next.filter((candidate) => candidate.type === "image"), video: next.filter((candidate) => candidate.type === "video"), audio: next.filter((candidate) => candidate.type === "audio") } }; }) });
    const thumbnail = (ref: H3Ref, compact = false, removable = false) => { const isOutput = compact && String(ref.name || "").startsWith("Clip"); const cardClass = isOutput ? "minimax-material-card minimax-output-item" : compact ? "minimax-material-card minimax-asset-item" : "minimax-material-card"; return <div key={ref.url} className={cardClass} draggable={!isOutput} onDragStart={(event) => { if (isOutput) return; event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-infinite-canvas-ref", JSON.stringify(ref)); event.dataTransfer.setData("text/plain", JSON.stringify(ref)); }} style={{ position: "relative", flex: `0 0 ${compact ? 82 : 118}px`, height: compact ? (isOutput ? 78 : 58) : 64, overflow: "hidden", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, background: ctx.theme.node.fill, cursor: isOutput ? "default" : "grab" }}>{ref.type === "video" ? <video src={ref.url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : ref.type === "image" ? <img src={ref.url} alt={ref.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ padding: 8, fontSize: 10 }}>♫ {ref.name}</span>}<span>{ref.type === "image" ? "Image" : ref.type === "video" ? "Video" : "Audio"}</span>{isOutput ? <span style={{ position: "absolute", right: 2, top: 2, display: "flex", gap: 2 }}><button type="button" title="下载" onClick={(event) => { event.stopPropagation(); const link = document.createElement("a"); link.href = ref.url; link.download = ref.name || "h3-output"; link.click(); }}><H3Icon name="download" /></button><button type="button" title="设为当前 Clip" onClick={(event) => { event.stopPropagation(); patchSelected({ result: ref.url, results: [ref] }); }}><H3Icon name="output" /></button></span> : null}{removable ? <button type="button" onClick={(event) => { event.stopPropagation(); patchSelected({ refItems: selectedRefs.filter((item) => item.url !== ref.url), refs: { image: imageRefs.filter((item) => item.url !== ref.url), video: videoRefs.filter((item) => item.url !== ref.url), audio: audioRefs.filter((item) => item.url !== ref.url) } }); }} style={{ position: "absolute", top: 2, right: 2, zIndex: 4 }}>×</button> : null}</div>; };
    const addRef = (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); const ref = normalizeDroppedRef(event); if (!ref) return; const rect = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))); const time = ratio * total; const target = segments.find((item) => time >= Number(item.start || 0) && time < Number(item.start || 0) + Math.max(0.5, Number(item.duration || 1))) || selected; if (!target) return; const targetRefs = refsForSegment(target); if (targetRefs.some((item) => item.url === ref.url)) return; const next = [...targetRefs, ref]; ctx.updateMetadata({ selectedSegmentId: target.id, segments: segments.map((item) => item.id === target.id ? { ...item, refItems: next, refs: { image: next.filter((item) => item.type === "image"), video: next.filter((item) => item.type === "video"), audio: next.filter((item) => item.type === "audio") } } : item) }); };
    const addRefToSelected = (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); const ref = normalizeDroppedRef(event); if (!ref || !selected || selectedRefs.some((item) => item.url === ref.url)) return; const next = [...selectedRefs, ref]; ctx.updateMetadata({ selectedSegmentId: selected.id, segments: segments.map((item) => item.id === selected.id ? { ...item, refItems: next, refs: { image: next.filter((item) => item.type === "image"), video: next.filter((item) => item.type === "video"), audio: next.filter((item) => item.type === "audio") } } : item) }); };
    const clipCard = (segment: H3Segment, index: number) => { const left = Number(segment.start || 0) / total * 100; const width = Math.max(5, Number(segment.duration || 1) / total * 100); const active = segment.id === selected?.id; const refs = refsForSegment(segment); return <div key={segment.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-infinite-canvas-clip", segment.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const ref = normalizeDroppedRef(event); if (ref) { const existing = refsForSegment(segment); if (existing.some((item) => item.url === ref.url)) return; const nextRefs = [...existing, ref]; ctx.updateMetadata({ selectedSegmentId: segment.id, segments: segments.map((item) => item.id === segment.id ? { ...item, refItems: nextRefs, refs: { image: nextRefs.filter((item) => item.type === "image"), video: nextRefs.filter((item) => item.type === "video"), audio: nextRefs.filter((item) => item.type === "audio") } } : item) }); return; } const id = event.dataTransfer.getData("application/x-infinite-canvas-clip"); if (!id || id === segment.id) return; const from = segments.findIndex((item) => item.id === id); const to = segments.findIndex((item) => item.id === segment.id); if (from < 0 || to < 0) return; const next = [...segments]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: id }); }} onClick={() => ctx.updateMetadata({ selectedSegmentId: segment.id, playhead: Number(segment.start || 0) })} className={`minimax-tl-clip ${active ? "active" : ""}`} style={{ left: `${left}%`, width: `${width}%` }}><div className="minimax-clip-media">{segment.result ? <video src={segment.result} muted playsInline preload="metadata" /> : <div className="minimax-clip-empty"><H3Icon name="clapperboard" /></div>}</div><button type="button" className={`minimax-clip-motion ${segment.motionContextEnabled === false ? "off" : ""}`} title="Motion Context" onClick={(event) => { event.stopPropagation(); ctx.updateMetadata({ segments: segments.map((item) => item.id === segment.id ? { ...item, motionContextEnabled: item.motionContextEnabled === false } : item) }); }}><H3Icon name="waves" /></button><div className="minimax-clip-meta"><b>Clip {index + 1}</b><span>{fmt(Number(segment.start || 0))} - {fmt(Number(segment.start || 0) + Number(segment.duration || 0))}</span></div>{refs.length ? <span className="minimax-clip-ref-count"><H3Icon name="paperclip" /> {refs.length}</span> : null}{segments.length > 1 ? <button type="button" className="minimax-clip-delete" onClick={(event) => { event.stopPropagation(); const next = segments.filter((item) => item.id !== segment.id); ctx.updateMetadata({ segments: compactSegmentStarts(next), selectedSegmentId: next[Math.max(0, index - 1)]?.id || "" }); }}><H3Icon name="close" /></button> : null}</div>; };
    return <div className="minimax-canvas-workbench" data-canvas-no-zoom data-h3-node-id={ctx.node.id} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClickCapture={(event) => { const target = (event.target as HTMLElement).closest<HTMLButtonElement>(".minimax-run, .minimax-reset"); if (!target) return; event.preventDefault(); event.stopPropagation(); target.classList.contains("minimax-reset") ? resetH3Run(ctx) : requestH3Run(ctx); }} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <H3PaneHandles ctx={ctx} />
        <H3PlayheadStyle percent={total ? (playhead / total) * 100 : 0} />
        <H3StatusBadge status={String(metadata.status || selected?.status || "idle")} error={String(metadata.errorDetails || metadata.error || "")} onRetry={() => requestH3Run(ctx)} />
        <H3RulerScrubber ctx={ctx} total={total} previewH={previewH} libraryW={libraryW} />
        <H3RefSelectionBinder ctx={ctx} segments={segments} total={total} />
        <H3VideoPreviewFallback ctx={ctx} />
        <H3TransportBinder ctx={ctx} />
        <H3PromptEnhanceBinder ctx={ctx} segment={selected} />
        <H3PromptInsertBinder ctx={ctx} segment={selected} />
        <style>{`.minimax-canvas-workbench{--minimax-preview-h:${previewH}px;--minimax-video-h:${videoTrackH}px;--minimax-ref-lane-h:${refLaneH}px;--minimax-ref-h:${Math.max(78, refLanes * refLaneH)}px}.minimax-canvas-workbench .minimax-wb-body{grid-template-columns:${libraryW}px minmax(0,1fr)}.minimax-canvas-workbench .minimax-wb-main{grid-template-rows:var(--minimax-preview-h) calc(28px + var(--minimax-video-h) + var(--minimax-ref-h)) minmax(150px,1fr)}.minimax-canvas-workbench .minimax-edit-timeline{grid-template-rows:28px var(--minimax-video-h) var(--minimax-ref-h)}`}</style>
         <div className="minimax-wb-toolbar"><div className="minimax-brand"><H3Icon name="clapperboard" /> <span>MiniMax H3</span><em title="已加载新版 H3 插件">v1.2</em><b>{fmt(playhead)} / {fmt(total)}</b></div><div className="minimax-transport"><button type="button" title="播放" onClick={() => ctx.updateMetadata({ playhead: playhead >= total ? 0 : total })}><H3Icon name="play" /></button><button type="button" title="新增片段" onClick={() => { const next = compactSegmentStarts([...segments, { id: `segment-${Date.now()}`, prompt: String(metadata.prompt || defaultPrompt), duration: 5, status: "idle" }]); ctx.updateMetadata({ segments: next, selectedSegmentId: next[next.length - 1].id }); }}><H3Icon name="plus" /></button></div><div className="minimax-top-actions"><button type="button" title="下载当前片段" disabled={!selected?.result} onClick={() => { if (!selected?.result) return; const link = document.createElement("a"); link.href = resultUrl(selected.result); link.download = `Clip-${selectedIndex + 1}.mp4`; link.click(); }}><H3Icon name="download" /></button><button type="button" title="打开参数" onClick={() => ctx.openPanel()}><H3Icon name="settings" /></button></div></div>
        <div className="minimax-wb-body"><aside className="minimax-library"><div className="minimax-library-head"><H3Icon name="database" /> <span>Assets</span></div><div className="minimax-library-list">{assets.map((ref) => thumbnail(ref, true))}{!assets.length ? <div className="minimax-library-empty"><H3Icon name="database" /><span>Assets</span></div> : null}</div><div className="minimax-library-head minimax-output-head"><H3Icon name="output" /> <span>Output</span></div><div className="minimax-library-list minimax-output-list">{outputs.map((ref) => thumbnail(ref, true))}{!outputs.length ? <div className="minimax-library-empty"><H3Icon name="output" /><span>Output</span></div> : null}</div></aside>
            <main className="minimax-wb-main"><div className="minimax-player-stage"><H3PreviewPlayer ctx={ctx} url={preview} kind={previewKind} playhead={playhead} playRequest={playRequest} /></div>
                <div className="minimax-edit-timeline"><div className="minimax-timeline-controls"><button type="button" onClick={() => ctx.updateMetadata({ playhead: playhead >= total ? 0 : total })}><H3Icon name="play" /></button></div><div className="minimax-ruler"><div className="minimax-track-content">{Array.from({ length: 6 }).map((_, index) => <span className="minimax-tick" key={index} style={{ left: `${index * 20}%` }}><b>{fmt(total * index / 5)}</b></span>)}</div></div><div className="minimax-add-gutter" /><div className="minimax-track-label minimax-video-label">Video</div><div className="minimax-track minimax-video-track"><div className="minimax-track-content">{segments.map(clipCard)}</div></div><button type="button" className="minimax-video-add" onClick={() => { const next = compactSegmentStarts([...segments, { id: `segment-${Date.now()}`, prompt: defaultPrompt, duration: 5, status: "idle" }]); ctx.updateMetadata({ segments: next, selectedSegmentId: next[next.length - 1].id }); }}><H3Icon name="plus" /></button><div className="minimax-track-label minimax-ref-label">Refs</div><div className="minimax-ref-track" onDragOver={(event) => event.preventDefault()} onDrop={addRef}><div className="minimax-ref-content">{Array.from({ length: refLanes }).map((_, lane) => <div className="minimax-ref-lane" key={lane}>{segments.map((segment) => { const ref = refsForSegment(segment)[lane]; const left = Number(segment.start || 0) / total * 100; const width = Math.max(5, Number(segment.duration || 1) / total * 100); return <div key={segment.id} className={`minimax-ref-clip ${segment.id === selected?.id ? "active" : ""} ${ref ? "has-ref" : "is-empty"}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={(event) => { event.stopPropagation(); ctx.updateMetadata({ selectedSegmentId: segment.id, playhead: Number(segment.start || 0) }); }}>{ref ? <div className="minimax-ref-media">{ref.type === "video" ? <video src={ref.url} muted playsInline preload="metadata" /> : ref.type === "image" ? <img src={ref.url} alt={ref.name} /> : <span>{ref.name}</span>}</div> : <div className="minimax-clip-empty"><H3Icon name="paperclip" /></div>}{ref ? <><span className="minimax-ref-counts">{ref.name || `Ref ${lane + 1}`}</span><button type="button" title="移除参考" onClick={(event) => { event.stopPropagation(); patchSelected({ refItems: selectedRefs.filter((item) => item.url !== ref.url), refs: { image: imageRefs.filter((item) => item.url !== ref.url), video: videoRefs.filter((item) => item.url !== ref.url), audio: audioRefs.filter((item) => item.url !== ref.url) } }); }}>×</button></> : null}</div>; })}</div>)}</div></div><div className="minimax-ref-gutter" /></div>
                 <section className="minimax-current-panel"><div className="minimax-current-head"><div className="minimax-current-title"><span className="minimax-current-dot" /><b>Clip {selectedIndex + 1}</b><span>{fmt(Number(selected?.start || 0))} - {fmt(Number(selected?.start || 0) + Number(selected?.duration || 0))}</span></div><div className="minimax-current-refs"><span><H3Icon name="database" /> {imageRefs.length}</span><span><H3Icon name="clapperboard" /> {videoRefs.length}</span><span><H3Icon name="output" /> {audioRefs.length}</span></div></div><div className="minimax-current-ref-items">{selectedRefs.map((ref) => thumbnail(ref, true, true))}{!selectedRefs.length ? <span><H3Icon name="paperclip" /> Refs：从 Assets 拖入参考素材</span> : null}</div><label className="minimax-prompt-field"><span><H3Icon name="prompt" /> Prompt <button type="button" onClick={() => ctx.openPanel()}>增强</button>{imageRefs.length ? <button type="button" onClick={() => patchSelected({ prompt: `${String(selected?.prompt || "")}${selected?.prompt ? "\n" : ""}@图片${imageRefs.length}` })}>@图片{imageRefs.length}</button> : null}{videoRefs.length ? <button type="button" onClick={() => patchSelected({ prompt: `${String(selected?.prompt || "")}${selected?.prompt ? "\n" : ""}@视频${videoRefs.length}` })}>@视频{videoRefs.length}</button> : null}{audioRefs.length ? <button type="button" onClick={() => patchSelected({ prompt: `${String(selected?.prompt || "")}${selected?.prompt ? "\n" : ""}@音频${audioRefs.length}` })}>@音频{audioRefs.length}</button> : null}</span><textarea value={String(selected?.prompt || "")} onChange={(event) => patchSelected({ prompt: event.target.value })} /><div className="minimax-prompt-modes">{["多参考", "模板", "定义", "摘要", "保留", "分辨", "声景", "配乐"].map((label) => <button type="button" key={label} onClick={() => { const tag = label === "多参考" ? `@图片${Math.max(1, imageRefs.length)}` : label === "定义" ? "<Subject 1>" : label === "分辨" ? "<Video 1>" : label === "声景" ? "<Audio 1>" : label === "模板" ? "保持主体身份、服装和镜头连续" : label === "摘要" ? "动作与镜头摘要：" : label === "保留" ? "保持不变：" : "配乐："; patchSelected({ prompt: `${String(selected?.prompt || "")}${selected?.prompt ? "\n" : ""}${tag}` }); }}>{label}</button>)}</div><small className="minimax-prompt-syntax"><code>@图片1~3</code> <code>@视频1~3</code> <code>@音频1~3</code> · <button type="button" onClick={() => patchSelected({ prompt: `${String(selected?.prompt || "")}${selected?.prompt ? " " : ""}《计数》` })}>《计数》</button> <button type="button" onClick={() => patchSelected({ prompt: `${String(selected?.prompt || "")}${selected?.prompt ? " " : ""}《总数》` })}>《总数》</button> <button type="button" onClick={() => patchSelected({ prompt: `${String(selected?.prompt || "")}${selected?.prompt ? " " : ""}《进度》` })}>《进度》</button></small></label><div className="minimax-clip-parameters"><div className="minimax-section-label"><H3Icon name="sliders" /> <span>Clip settings</span></div><div className="minimax-settings"><label className="minimax-wide-setting"><span>Engine</span><select value={String(metadata.minimaxEngine || "comfyui")} onChange={(event) => ctx.updateMetadata({ minimaxEngine: event.target.value })}><option value="comfyui">ComfyUI</option><option value="runninghub">RunningHub</option></select></label><label><span>Duration</span><input type="number" value={Number(selected?.duration || 5)} onChange={(event) => patchSelected({ duration: Number(event.target.value) })} /><b>s</b></label><label><span>Megapixels</span><input type="number" step="0.1" value={Number(selected?.megapixels || metadata.megapixels || 0.4)} onChange={(event) => patchSelected({ megapixels: Number(event.target.value) })} /><b>MP</b></label><label className="minimax-wide-setting"><span>Aspect ratio</span><select value={String(selected?.aspectRatio || "16:9")} onChange={(event) => patchSelected({ aspectRatio: event.target.value })}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option></select></label><ClipSettings ctx={ctx} metadata={metadata} segment={selected} patch={patchSelected} /><button type="button" className="minimax-run" onClick={() => { ctx.openPanel(); setTimeout(() => ctx.emit("minimax-h3:run", { nodeId: ctx.node.id }), 0); }}><H3Icon name="sparkles" /> Generate clip</button></div></div></section>
            </main>
        </div>
    </div>;
}

function Toggle({ ctx, label, value, onChange }: { ctx: CanvasNodeContext; label: string; value: boolean; onChange: (value: boolean) => void }) {
    return <button type="button" onClick={() => onChange(!value)} style={buttonStyle(ctx, value)}>{value ? "●" : "○"} {label}</button>;
}

function H3AdvancedSettings({ ctx, metadata, segment }: { ctx: CanvasNodeContext; metadata: Record<string, unknown>; segment: H3Segment }) {
    const field = { width: "100%", boxSizing: "border-box", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, padding: "4px 6px", background: ctx.theme.node.panel, color: ctx.theme.node.text, fontSize: 10 } as const;
    const patch = (next: Partial<H3Segment>) => patchSelectedSegment(ctx, metadata, next);
    return <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, padding: "5px 0" }}><label style={{ fontSize: 10 }}>Steps<input type="number" min="1" max="60" value={Number(segment.videoSteps || metadata.videoSteps || 20)} onChange={(event) => patch({ videoSteps: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>Denoise<input type="number" min="0" max="1" step="0.05" value={Number(segment.denoise ?? metadata.denoise ?? 1)} onChange={(event) => patch({ denoise: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>Seed mode<select value={segment.noiseSeedMode === "fixed" ? "fixed" : "random"} onChange={(event) => patch({ noiseSeedMode: event.target.value as "random" | "fixed", noiseSeed: event.target.value === "fixed" ? (segment.noiseSeed ?? segment.seed ?? Math.floor(Math.random() * 4294967296)) : undefined })} style={field}><option value="random">Random</option><option value="fixed">Fixed</option></select></label>{segment.noiseSeedMode === "fixed" ? <label style={{ fontSize: 10 }}>Seed<input type="number" min="0" max="4294967295" value={String(segment.noiseSeed ?? segment.seed ?? "")} onChange={(event) => patch({ noiseSeed: event.target.value, seed: event.target.value })} style={field} /></label> : null}<Toggle ctx={ctx} label="Motion Context" value={segment.motionContextEnabled !== false} onChange={(value) => patch({ motionContextEnabled: value, tailFrameEnabled: value })} />{segment.motionContextEnabled !== false ? <><label style={{ fontSize: 10 }}>Noise start<input type="number" min="0" max="1" step="0.01" value={Number(segment.motionContextNoiseAlpha ?? metadata.motionContextNoiseAlpha ?? 0.45)} onChange={(event) => patch({ motionContextNoiseAlpha: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>Noise end<input type="number" min="0" max="1" step="0.01" value={Number(segment.motionContextNoiseAlphaEnd ?? metadata.motionContextNoiseAlphaEnd ?? 0.1)} onChange={(event) => patch({ motionContextNoiseAlphaEnd: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>Ramp frames<input type="number" min="0" max="22" value={Number(segment.motionContextNoiseRampFrames ?? metadata.motionContextNoiseRampFrames ?? 3)} onChange={(event) => patch({ motionContextNoiseRampFrames: Number(event.target.value) })} style={field} /></label><Toggle ctx={ctx} label="递进增噪" value={segment.motionContextNoiseEnabled !== false} onChange={(value) => patch({ motionContextNoiseEnabled: value })} /></> : null}{segment.taskMode === "rv2v" || segment.taskMode === "v2v" ? <><label style={{ fontSize: 10 }}>Audio mode<select value={String(segment.audioMode || "native")} onChange={(event) => patch({ audioMode: event.target.value })} style={field}><option value="native">Native</option><option value="lock_source">Lock source</option><option value="remix_source">Remix source</option><option value="reference_only">Reference only</option></select></label><Toggle ctx={ctx} label="源视频作参考" value={segment.addSourceAsReference === true} onChange={(value) => patch({ addSourceAsReference: value })} /></> : null}</div>;
}

export function H3Panel({ ctx }: CanvasNodePanelProps) {
    const metadata = ctx.node.metadata || {};
    const upstream = useMemo(() => readRefs(ctx), [ctx.node.id, ctx.getConnections().length, ctx.getNodes().length]);
    const sourceVideo = upstream.find((ref) => ref.type === "video");
    const [prompt, setPrompt] = useState(String(metadata.prompt || defaultPrompt));
    const [duration, setDuration] = useState(String(metadata.duration || "5"));
    const [ratio, setRatio] = useState(String(metadata.aspectRatio || "16:9 (Widescreen)"));
    const [megapixels, setMegapixels] = useState(String(metadata.megapixels || metadata.minimaxGlobalMegapixels || "0.4"));
    const [loraName, setLoraName] = useState(String(metadata.loraName || metadata.minimaxLoraName || ""));
    const [modelName, setModelName] = useState(normalizeH3Model(metadata.modelName || metadata.minimaxBaseModel));
    const [combatLoraWeight, setCombatLoraWeight] = useState(String(metadata.combatLoraWeight || metadata.minimaxCombatLoraWeight || "0"));
    const [cinematicLoraWeight, setCinematicLoraWeight] = useState(String(metadata.cinematicLoraWeight || metadata.minimaxCinematicLoraWeight || "0"));
    const [teAccel, setTeAccel] = useState(metadata.teAccel === true || metadata.minimaxTeAccel === true);
    const [promptEnhance, setPromptEnhance] = useState(metadata.promptEnhance === true || metadata.minimaxPromptEnhance === true);
    const [promptEnhanceLanguage, setPromptEnhanceLanguage] = useState(String(metadata.promptEnhanceLanguage || metadata.minimaxPromptEnhanceLanguage || "zh"));
    const [steps, setSteps] = useState(String(metadata.videoSteps || "8"));
    const [denoise, setDenoise] = useState(String(metadata.denoise ?? "0.65"));
    const [seed, setSeed] = useState(String(metadata.seed ?? metadata.noiseSeed ?? ""));
    const [motion, setMotion] = useState(metadata.motionContextEnabled !== false);
    const [motionNoise, setMotionNoise] = useState(Boolean(metadata.motionContextNoiseEnabled));
    const [noiseAlpha, setNoiseAlpha] = useState(String(metadata.motionContextNoiseAlpha ?? "0.45"));
    const [noiseAlphaEnd, setNoiseAlphaEnd] = useState(String(metadata.motionContextNoiseAlphaEnd ?? "0.10"));
    const [noiseRampFrames, setNoiseRampFrames] = useState(String(metadata.motionContextNoiseRampFrames ?? "3"));
    const [autoSplit, setAutoSplit] = useState(Boolean(metadata.autoSplit));
    const [segmentDuration, setSegmentDuration] = useState(String(metadata.segmentDuration ?? "6"));
    const [maxSegments, setMaxSegments] = useState(String(metadata.maxSegments ?? "60"));
    const [selectedSegmentId, setSelectedSegmentId] = useState(String(metadata.selectedSegmentId || ""));
    const [running, setRunning] = useState(false);
    const models = ctx.ai.listModels("video");
    const selectedModel = String(metadata.model || ctx.ai.defaultModel("video") || models[0]?.value || "");

    // Keep the hidden event runner synchronized with the visible Clip editor.
    // The editor writes per-Clip values into metadata.segments, while this
    // runner historically kept a separate local form state.
    useEffect(() => {
        const currentSegments = segmentsFor(ctx.node.metadata || {});
        const current = currentSegments.find((segment) => segment.id === String((ctx.node.metadata || {}).selectedSegmentId || "")) || currentSegments[0];
        const currentMetadata = ctx.node.metadata || {};
        setSelectedSegmentId(String(current?.id || ""));
        setPrompt(current?.prompt !== undefined ? String(current.prompt) : currentMetadata.prompt !== undefined ? String(currentMetadata.prompt) : defaultPrompt);
        setDuration(String(current?.duration || currentMetadata.duration || "8"));
        setRatio(String(current?.aspectRatio || currentMetadata.aspectRatio || "16:9 (Widescreen)"));
        setMegapixels(String(current?.megapixels || currentMetadata.megapixels || currentMetadata.minimaxGlobalMegapixels || "0.4"));
        setModelName(normalizeH3Model(current?.modelName || currentMetadata.minimaxBaseModel || currentMetadata.modelName));
        setLoraName(String(current?.loraName ?? currentMetadata.loraName ?? currentMetadata.minimaxLoraName ?? ""));
        setCombatLoraWeight(String(current?.combatLoraWeight ?? currentMetadata.combatLoraWeight ?? currentMetadata.minimaxCombatLoraWeight ?? "0"));
        setCinematicLoraWeight(String(current?.cinematicLoraWeight ?? currentMetadata.cinematicLoraWeight ?? currentMetadata.minimaxCinematicLoraWeight ?? "0"));
        setSteps(String(current?.videoSteps || currentMetadata.videoSteps || currentMetadata.minimaxGlobalVideoSteps || "8"));
        setDenoise(String(current?.denoise ?? currentMetadata.denoise ?? "0.65"));
        setSeed(String(current?.noiseSeed ?? current?.seed ?? currentMetadata.seed ?? currentMetadata.noiseSeed ?? ""));
        setMotion(current?.motionContextEnabled !== false && currentMetadata.motionContextEnabled !== false);
        setMotionNoise(current?.motionContextNoiseEnabled === true || currentMetadata.motionContextNoiseEnabled === true);
    }, [ctx.node.id, ctx.node.metadata]);

    useEffect(() => {
        const taskId = String(metadata.runtimeTaskId || "");
        if (!taskId || !["loading", "queued"].includes(String(metadata.status))) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const poll = async () => {
            try {
                const task = String(metadata.minimaxEngine || "").toLowerCase() === "runninghub" ? await ctx.ai.getRunningHubH3Task(taskId) : await ctx.ai.getLocalH3Task(taskId);
                if (cancelled) return;
                if (task.status === "succeeded" && task.result?.url) { update({ content: task.result.url, mimeType: task.result.mimeType, ...(task.result.segments?.length ? { segments: task.result.segments } : {}), materials: appendVideoMaterials(metadata.materials, [{ url: task.result.url, type: "video", name: "H3 输出" }]), status: "success", errorDetails: "" }); void finishH3Log(ctx, taskId, "success", { finishedAt: new Date().toISOString(), durationMs: Date.now() - Number(metadata.runStartedAt || Date.now()), outputs: [{ url: task.result.url, type: "video", mimeType: task.result.mimeType }] }); }
                else if (["failed", "cancelled"].includes(task.status)) { update({ status: task.status === "cancelled" ? "cancelled" : "error", errorDetails: task.error || "H3 任务失败" }); void finishH3Log(ctx, taskId, task.status === "cancelled" ? "cancelled" : "failed", { finishedAt: new Date().toISOString(), durationMs: Date.now() - Number(metadata.runStartedAt || Date.now()), error: task.error || "H3 任务失败" }); }
                else timer = setTimeout(() => void poll(), 1500);
            } catch (error) {
                if (!cancelled) timer = setTimeout(() => void poll(), 2500);
            }
        };
        void poll();
        return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }, [ctx.node.id, metadata.runtimeTaskId, metadata.status]);

    const update = (patch: Record<string, unknown>) => ctx.updateMetadata(patch);
    const segmentList = segmentsFor(metadata);
    const selectedSegment = segmentList.find((segment) => segment.id === selectedSegmentId) || segmentList[0];
    const updateSelected = (patch: Partial<H3Segment>) => {
        if (!selectedSegment) return;
        update({ selectedSegmentId: selectedSegment.id, segments: segmentList.map((segment) => segment.id === selectedSegment.id ? { ...segment, ...patch } : segment) });
    };
    const removeStoredRef = (url: string) => {
        const current = metadata.h3Refs && typeof metadata.h3Refs === "object" ? metadata.h3Refs as Record<string, unknown> : {};
        const next = Object.fromEntries(Object.entries(current).map(([kind, values]) => [kind, Array.isArray(values) ? values.filter((item) => !item || typeof item !== "object" || String((item as Record<string, unknown>).url || (item as Record<string, unknown>).dataUrl || "") !== url) : values]));
        update({ h3Refs: next, segments: segmentList.map((segment) => ({ ...segment, refItems: (segment.refItems || []).filter((item) => item.url !== url) })) });
    };
    const dropRef = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const raw = event.dataTransfer.getData("application/x-infinite-canvas-ref") || event.dataTransfer.getData("application/json") || event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
        if (!raw) return;
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(raw.split(/\r?\n/).find((line) => line && !line.startsWith("#")) || raw) as Record<string, unknown>; } catch { parsed = { url: raw.split(/\r?\n/).find((line) => line && !line.startsWith("#")) || raw }; }
        const url = String(parsed.url || parsed.dataUrl || parsed.localUrl || parsed.originalLocalUrl || parsed.sourceUrl || parsed.path || "").trim();
        if (!url) return;
        const kind = String(parsed.kind || parsed.type || "image").startsWith("video") ? "video" : String(parsed.kind || parsed.type || "image").startsWith("audio") ? "audio" : "image";
        const storageKey = String(parsed.storageKey || "").trim();
        const current = metadata.h3Refs && typeof metadata.h3Refs === "object" ? metadata.h3Refs as Record<string, unknown> : {};
        const bucket = Array.isArray(current[kind]) ? current[kind] as unknown[] : [];
        if (bucket.some((item) => item && typeof item === "object" && sameRef(item as H3Ref, { url, name: "", type: kind as H3Ref["type"], storageKey: storageKey || undefined }))) return;
        const item = { url, name: String(parsed.name || `${kind}-ref`), type: kind as H3Ref["type"], ...(storageKey ? { storageKey } : {}) };
        const nextSegments = selectedSegment ? segmentList.map((segment) => segment.id === selectedSegment.id ? { ...segment, refItems: [...(segment.refItems || []), item] } : segment) : segmentList;
        update({ h3Refs: { ...current, [kind]: [...bucket, item] }, segments: nextSegments, selectedSegmentId: selectedSegment?.id || selectedSegmentId });
    };
    const run = async (runAll = false) => {
        // The visible workbench is the source of truth. This hidden component
        // only consumes run events and must not submit stale local form state.
        // The panel can remain mounted while the visible workbench adds or
        // selects Clips. ctx.node is the render-time snapshot, so always read
        // the latest node before preparing a run; otherwise a Clip2 run could
        // write back an old one-Clip snapshot and erase the other Clips.
        const liveMetadata = ctx.getNode(ctx.node.id)?.metadata || ctx.node.metadata || {};
        const liveSegments = segmentsFor(liveMetadata);
        const liveSelected = liveSegments.find((segment) => segment.id === String(liveMetadata.selectedSegmentId || "")) || liveSegments[0];
        // 从 DOM 读取当前 textarea 的 prompt 值（H3Panel 和 H3ContentExact）
        // H3Panel 有 placeholder，H3ContentExact 没有，所以分开选择
        const panelTextarea = document.querySelector<HTMLTextAreaElement>(`textarea[placeholder="描述动作、镜头与角色替换要求"]`);
        const workbenchTextarea = document.querySelector<HTMLTextAreaElement>(`.minimax-canvas-workbench .minimax-current-panel textarea`);
        const domPrompt = panelTextarea?.value?.trim() || workbenchTextarea?.value?.trim() || "";
        // 优先级：segment.prompt > DOM textarea > metadata.prompt > defaultPrompt
        const livePrompt = String(liveSelected?.prompt || domPrompt || liveMetadata.prompt || defaultPrompt);
        const liveDuration = String(liveSelected?.duration || liveMetadata.duration || "8");
        const liveRatio = String(liveSelected?.aspectRatio || liveMetadata.aspectRatio || "16:9");
        const liveMegapixels = Number(liveSelected?.megapixels || liveMetadata.megapixels || liveMetadata.minimaxGlobalMegapixels || 0.4);
        const liveSettings = liveSelected ? compatibleH3Settings(liveSelected, String(liveMetadata.minimaxBaseModel || liveMetadata.modelName || defaultH3Model), String(liveMetadata.minimaxLoraName || liveMetadata.loraName || ""), upstream) : { modelName: defaultH3Model, loraName: "", defaultSteps: 20 };
        const liveSteps = Number(liveSelected?.videoSteps || liveMetadata.videoSteps || liveMetadata.minimaxGlobalVideoSteps || liveSettings.defaultSteps);
        const liveDenoise = Number(liveSelected?.denoise ?? liveMetadata.denoise ?? 0.65);
        const liveSeed = liveSelected?.seed ?? liveMetadata.seed ?? liveMetadata.noiseSeed ?? "";
        const liveModelName = liveSettings.modelName;
        const liveLoraName = liveSettings.loraName;
        const liveMotion = liveSelected?.motionContextEnabled !== false && liveMetadata.motionContextEnabled !== false;
        const prompt = livePrompt;
        const duration = liveDuration;
        const ratio = liveRatio;
        const megapixels = String(liveMegapixels);
        const steps = String(liveSteps);
        const denoise = String(liveDenoise);
        const seed = String(liveSeed || "");
        const modelName = liveModelName;
        const loraName = liveLoraName;
        const motion = liveMotion;
        const combatLoraWeight = String(liveSelected?.combatLoraWeight ?? liveMetadata.minimaxCombatLoraWeight ?? "0");
        const cinematicLoraWeight = String(liveSelected?.cinematicLoraWeight ?? liveMetadata.minimaxCinematicLoraWeight ?? "0");
        const selectedSegmentId = String(liveMetadata.selectedSegmentId || liveSelected?.id || "");
        const video = upstream.find((ref) => ref.type === "video");
        const images = upstream.filter((ref) => ref.type === "image");
        const audios = upstream.filter((ref) => ref.type === "audio");
        // 读取所有 segment 的 taskMode，t2v 不需要校验素材连接
        const hasT2vSegment = liveSegments.some((seg) => String(seg.taskMode || "r2v") === "t2v");
        const needsMaterialValidation = !hasT2vSegment && !video && !images.length;
        if (needsMaterialValidation) {
            update({ status: "error", errorDetails: "请先连接源视频或角色参考图。" });
            return;
        }
        setRunning(true);
        const logRefs = [...images, ...(video ? [video] : []), ...audios] as H3Ref[];
        const generationLog = await createH3Log(ctx, liveSelected, livePrompt, logRefs, { engine: liveMetadata.minimaxEngine || "comfyui", workflow: "MiniMax H3", modelName: liveModelName, taskMode: liveSelected?.taskMode || "r2v", duration: liveDuration, aspectRatio: liveRatio, megapixels: liveMegapixels, videoSteps: liveSteps, denoise: liveDenoise, seed: liveSeed });
        const generationLogId = generationLog?.id || "";
        update({ prompt: livePrompt, duration: liveDuration, aspectRatio: liveRatio, megapixels: liveMegapixels, videoSteps: liveSteps, denoise: liveDenoise, seed: String(liveSeed).trim() ? Number(liveSeed) : undefined, modelName: liveModelName, minimaxBaseModel: liveModelName, loraName: liveLoraName, combatLoraWeight: Number(liveSelected?.combatLoraWeight ?? liveMetadata.minimaxCombatLoraWeight ?? combatLoraWeight), cinematicLoraWeight: Number(liveSelected?.cinematicLoraWeight ?? liveMetadata.minimaxCinematicLoraWeight ?? cinematicLoraWeight), teAccel: liveMetadata.minimaxGlobalTeAccel === true || teAccel, promptEnhance, promptEnhanceLanguage, motionContextEnabled: liveMotion, motionContextNoiseEnabled: liveSelected?.motionContextNoiseEnabled === true || liveMetadata.motionContextNoiseEnabled === true || motionNoise, motionContextNoiseAlpha: Number(liveSelected?.motionContextNoiseAlpha ?? liveMetadata.motionContextNoiseAlpha ?? noiseAlpha), motionContextNoiseAlphaEnd: Number(liveSelected?.motionContextNoiseAlphaEnd ?? liveMetadata.motionContextNoiseAlphaEnd ?? noiseAlphaEnd), motionContextNoiseRampFrames: Number(liveSelected?.motionContextNoiseRampFrames ?? liveMetadata.motionContextNoiseRampFrames ?? noiseRampFrames), model: selectedModel, status: "loading", errorDetails: "", runStartedAt: Date.now() });
        const lastSubmitted = { taskMode: "", video: 0, images: 0, audios: 0, model: "" };
        try {
            let effectivePrompt = livePrompt;
            if (promptEnhance) {
                const enhanced = await ctx.ai.generateText(livePrompt, { model: String(liveMetadata.minimaxLlmModel || liveMetadata.llmModel || ""), system: `你是 MiniMax H3 视频提示词整理器。用${promptEnhanceLanguage === "en" ? "英文" : "中文"}输出一条完整提示词，只补充镜头、动作、主体一致性和时序信息，不改变用户意图，不添加免责声明。` });
                if (enhanced.text.trim()) effectivePrompt = enhanced.text.trim();
            }
            const allSegments: H3Segment[] = liveSegments.length ? liveSegments : [{ id: "segment-1", prompt: livePrompt, duration: Number(liveDuration) }];
            // The visible workbench writes the selected id into metadata. The
            // local panel state can lag behind when the user clicks another
            // Clip, so metadata is the source of truth for execution.
            const activeId = String(liveMetadata.selectedSegmentId || selectedSegmentId || allSegments[0]?.id || "");
            const storedSegments = runAll ? allSegments : allSegments.filter((segment) => String(segment.id) === activeId);
            const requestedIds = new Set(storedSegments.map((segment) => segment.id));
            const markRequestedSegments = (patch: Partial<H3Segment>) => {
                const current = segmentsFor(ctx.getNode(ctx.node.id)?.metadata || liveMetadata);
                update({ segments: current.map((segment) => requestedIds.has(segment.id) ? { ...segment, ...patch } : segment) });
            };
            markRequestedSegments({ status: "loading", progress: 0 });
            let previousVideo: { name: string; url: string } | undefined;
            let lastResult: Awaited<ReturnType<typeof ctx.ai.runLocalH3>> | undefined;
            const nextSegments: H3Segment[] = [];
            // 用于错误日志记录最后一次提交的信息
            for (const [index, segment] of storedSegments.entries()) {
                const segmentRefs = refsForSegment(segment);
                const requestedTaskMode = String(segment.taskMode || "r2v");
                // t2v：只使用纯提示词，忽略所有素材
                // i2v/fl2v：只使用图片
                // v2v：只使用视频
                // rv2v/r2v：使用视频+图片+音频
                const isT2v = requestedTaskMode === "t2v";
                const isV2v = requestedTaskMode === "v2v";
                const isI2vFl2v = requestedTaskMode === "i2v" || requestedTaskMode === "fl2v";
                const isR2vOrRv2v = !isT2v && !isV2v && !isI2vFl2v;
                const effectiveTaskMode = isR2vOrRv2v && requestedTaskMode === "rv2v" && !segmentRefs.some((ref) => ref.type === "video") && !video ? "r2v" : requestedTaskMode;
                const segmentVideo = !isT2v && !isI2vFl2v ? (segmentRefs.find((ref) => ref.type === "video") || (index === 0 ? video : undefined)) : undefined;
                const segmentImages = isT2v || isV2v ? [] : segmentRefs.filter((ref) => ref.type === "image");
                const segmentAudios = isT2v || isV2v || isI2vFl2v ? [] : segmentRefs.filter((ref) => ref.type === "audio");
                // t2v 模式下不传递任何图片给 compatibleH3Settings，避免影响模型选择
                const upstreamForSettings = isT2v ? [] : [...images, ...(video ? [video] : [])];
                const segmentSettings = compatibleH3Settings({ ...segment, taskMode: effectiveTaskMode }, liveModelName, liveLoraName, upstreamForSettings);
                const segmentSteps = Number(segment.videoSteps || liveMetadata.minimaxGlobalVideoSteps || segmentSettings.defaultSteps);
                const h3Runner = String(liveMetadata.minimaxEngine || "").toLowerCase() === "runninghub" ? ctx.ai.runRunningHubH3 : ctx.ai.runLocalH3;
                const segmentPrompt = promptEnhance ? effectivePrompt : segment.prompt !== undefined ? String(segment.prompt) : effectivePrompt;
                const promptFlags = `${segment.noDub !== false ? "\nNo dialogue, narration, voiceover, or singing." : ""}${segment.noCaption !== false ? "\nNo subtitles, captions, on-screen text, or text overlays." : ""}`;
                // 根据任务模式决定提交哪些 refs
                const finalReferences = isT2v || isV2v ? [] : (segmentImages.length ? segmentImages : isI2vFl2v ? [] : images).map((ref) => ({ name: `${ref.name}.png`, url: ref.url }));
                const finalVideo = !isT2v && !isI2vFl2v ? (segmentVideo ? { name: `${segmentVideo.name}.mp4`, url: segmentVideo.url } : undefined) : undefined;
                const finalAudios = isR2vOrRv2v ? (segmentAudios.length ? segmentAudios : audios).map((ref) => ({ name: `${ref.name}.mp3`, url: ref.url })) : [];
                // 记录提交信息用于错误日志
                lastSubmitted.taskMode = effectiveTaskMode;
                lastSubmitted.video = finalVideo ? 1 : 0;
                lastSubmitted.images = finalReferences.length;
                lastSubmitted.audios = finalAudios.length;
                lastSubmitted.model = segmentSettings.modelName;
                const segmentResult = await h3Runner(`${segmentPrompt}${promptFlags}`, {
                    video: finalVideo,
                    references: finalReferences,
                    audios: finalAudios,
                    previousVideo,
                }, { duration: Number(segment.duration || duration), aspectRatio: String(segment.aspectRatio || ratio), megapixels: Number(segment.megapixels || megapixels), videoSteps: segmentSteps, denoise: Number(segment.denoise ?? denoise), ...(segment.noiseSeedMode === "fixed" && String(segment.noiseSeed ?? segment.seed ?? "").trim() ? { seed: Number(segment.noiseSeed ?? segment.seed) } : {}), modelName: segmentSettings.modelName, loraName: segmentSettings.loraName, combatLoraWeight: Number(segment.combatLoraWeight ?? 0), cinematicLoraWeight: Number(segment.cinematicLoraWeight ?? 0), teAccel: segment.teAccel ?? teAccel, taskMode: effectiveTaskMode, audioMode: String(segment.audioMode || "native"), audioDenoiseStrength: Number(segment.audioDenoiseStrength ?? 1), addSourceAsReference: segment.addSourceAsReference === true, promptPrimaryAudioOrdinal: Number(segment.promptPrimaryAudioOrdinal || 0), strictPromptTags: segment.strictPromptTags !== false, referenceVideoPolicy: String(segment.referenceVideoPolicy || "official_2_to_15s"), refImageSize: String(segment.refImageSize || "match"), motionContext: (autoSplit || index > 0) && segment.motionContextEnabled !== false && motion, motionContextNoise: (autoSplit || index > 0) && segment.motionContextNoiseEnabled !== false && motionNoise, motionContextNoiseAlpha: Number(segment.motionContextNoiseAlpha ?? noiseAlpha), motionContextNoiseAlphaEnd: Number(segment.motionContextNoiseAlphaEnd ?? noiseAlphaEnd), motionContextNoiseRampFrames: Number(segment.motionContextNoiseRampFrames ?? noiseRampFrames), runninghubMode: metadata.minimaxRunningHubMode, runninghubWorkflowId: metadata.minimaxRunningHubWorkflowId, runninghubAppId: metadata.minimaxRunningHubAppId, runninghubFields: metadata.minimaxRunningHubFields, runninghubParams: metadata.minimaxRunningHubParams, runninghubWorkflowJson: metadata.minimaxRunningHubWorkflowJson, useWallet: metadata.minimaxRunningHubUseWallet === true, ...(autoSplit && storedSegments.length === 1 ? { autoSplit: true, segmentDuration: Number(segmentDuration), maxSegments: Number(maxSegments) } : {}) }, { onTaskId: (taskId) => { update({ runtimeTaskId: taskId, runProgress: 0.1 }); markRequestedSegments({ runtimeTaskId: taskId, progress: 0.1 }); if (generationLogId) void ctx.generationLogs.update(generationLogId, { status: "running", runtimeTaskId: taskId }); } });
                lastResult = segmentResult;
                if (autoSplit && segmentResult.segments?.length) {
                    nextSegments.push(...segmentResult.segments.map((item, itemIndex) => { const resultUrl = item.media?.find((media) => media.mimeType.startsWith("video/"))?.url || ""; return { ...segment, id: `${segment.id}-${itemIndex + 1}`, prompt: String(segment.prompt || prompt), duration: Number(segmentDuration), start: 0, result: resultUrl, results: resultUrl ? [{ url: resultUrl, type: "video" as const, name: `Clip ${itemIndex + 1}` }] : [], status: "success" }; }));
                    break;
                }
                previousVideo = { name: `h3-segment-${index + 1}.mp4`, url: segmentResult.url };
                nextSegments.push({ ...segment, prompt: String(segment.prompt || prompt), duration: Number(segment.duration || duration), result: segmentResult.url, results: [{ url: segmentResult.url, type: "video", name: `Clip ${index + 1}` }], status: "success", progress: 1 });
            }
            if (!lastResult) throw new Error("没有可运行的 H3 分段");
            const mergedSegments = runAll
                ? compactSegmentStarts(nextSegments)
                : autoSplit && storedSegments.length === 1 && nextSegments.length
                    ? compactSegmentStarts([...allSegments.slice(0, Math.max(0, allSegments.findIndex((item) => item.id === activeId))), ...nextSegments, ...allSegments.slice(Math.max(0, allSegments.findIndex((item) => item.id === activeId)) + 1)])
                    : allSegments.map((segment) => nextSegments.find((item) => item.id === segment.id) || segment);
            const generatedMaterials = mergedSegments.flatMap((segment, index) => (segment.results || []).filter((item) => item.type === "video").map((item) => ({ ...item, name: item.name || `Clip ${index + 1}` })));
              update({ content: lastResult.url, mimeType: lastResult.mimeType, naturalWidth: lastResult.width, naturalHeight: lastResult.height, durationMs: lastResult.durationMs, segments: mergedSegments, materials: appendVideoMaterials(liveMetadata.materials, [...generatedMaterials, { url: lastResult.url, type: "video", name: `Clip ${selectedSegmentId || "输出"}` }]), runtimeTaskId: lastResult.taskId, status: "success", errorDetails: "", runFinishedAt: Date.now() });
              if (generationLogId) void ctx.generationLogs.update(generationLogId, { status: "success", runtimeTaskId: lastResult.taskId, finishedAt: new Date().toISOString(), durationMs: Date.now() - Number(liveMetadata.runStartedAt || Date.now()), outputs: [{ url: lastResult.url, type: "video", mimeType: lastResult.mimeType }] });
        } catch (error) {
            // 增强错误日志：包含实际提交信息
            const errorMessage = error instanceof Error ? error.message : String(error);
            const debugInfo = `[h3-run] taskMode=${lastSubmitted.taskMode}, video=${lastSubmitted.video}, images=${lastSubmitted.images}, audios=${lastSubmitted.audios}, model=${lastSubmitted.model}`;
            const enhancedError = errorMessage.includes(debugInfo) ? errorMessage : `${errorMessage}\n${debugInfo}`;
            const current = segmentsFor(ctx.getNode(ctx.node.id)?.metadata || liveMetadata);
            const errorIds = new Set((runAll ? current : current.filter((segment) => segment.id === selectedSegmentId)).map((segment) => segment.id));
              update({ segments: current.map((segment) => errorIds.has(segment.id) ? { ...segment, status: "error", progress: 0 } : segment), status: "error", errorDetails: enhancedError, runFinishedAt: Date.now() });
              if (generationLogId) void ctx.generationLogs.update(generationLogId, { status: "failed", finishedAt: new Date().toISOString(), durationMs: Date.now() - Number(liveMetadata.runStartedAt || Date.now()), error: enhancedError, params: { ...lastSubmitted } });
        } finally {
            setRunning(false);
        }
    };

    useEffect(() => ctx.on("minimax-h3:run", (payload) => {
        if (!payload || typeof payload !== "object" || String((payload as Record<string, unknown>).nodeId || "") !== ctx.node.id) return;
        const requestId = String((payload as Record<string, unknown>).requestId || "");
        if (requestId) update({ runRequestConsumedId: requestId, status: "loading", errorDetails: "", runProgress: 0 });
        void run(Boolean((payload as Record<string, unknown>).all));
    }), [ctx.node.id, run]);
    useEffect(() => ctx.on("minimax-h3:run-all", (payload) => {
        if (!payload || typeof payload !== "object" || String((payload as Record<string, unknown>).nodeId || "") !== ctx.node.id) return;
        void run(true);
    }), [ctx.node.id, run]);
    useEffect(() => {
        const current = ctx.getNode(ctx.node.id)?.metadata || {};
        const requestId = String(current.runRequestId || "");
        if (!requestId || requestId === String(current.runRequestConsumedId || "")) return;
        update({ runRequestConsumedId: requestId, status: "loading", errorDetails: "", runProgress: 0 });
        void run(current.runRequestAll === true);
    }, [ctx.node.id, ctx.node.metadata?.runRequestId, ctx.node.metadata?.runRequestConsumedId, ctx.node.metadata?.runRequestAll, run]);

    // The migrated workbench contains the complete H3 editor. Keep this
    // component mounted as the event-driven runner, but avoid rendering a
    // second inspector below the node like the new canvas host normally does.
    if (metadata.h3ExternalPanel !== true) return null;

    const field = { width: "100%", boxSizing: "border-box", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 7, padding: "6px 8px", background: ctx.theme.node.panel, color: ctx.theme.node.text, fontSize: 11 } as const;
    return (
        <div data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onDragOver={(event) => event.preventDefault()} onDrop={dropRef} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 9, padding: 12, boxSizing: "border-box", color: ctx.theme.node.text }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 800, fontSize: 13 }}><span>MiniMax H3 参数</span><span style={{ color: ctx.theme.node.muted, fontSize: 10 }}>{upstream.length} refs</span></div>
            <textarea value={prompt} onChange={(event) => { const value = event.target.value; setPrompt(value); update({ prompt: value, segments: segmentList.map((segment) => segment.id === selectedSegment?.id ? { ...segment, prompt: value } : segment) }); }} placeholder="描述动作、镜头与角色替换要求" rows={4} style={{ ...field, resize: "vertical", lineHeight: 1.45 }} />
            <div style={{ border: `1px dashed ${ctx.theme.node.stroke}`, borderRadius: 8, padding: 7, display: "flex", flexWrap: "wrap", gap: 5, minHeight: 28 }}><span style={{ width: "100%", color: ctx.theme.node.muted, fontSize: 10 }}>Refs（可从 Assets 拖入）</span>{upstream.length ? upstream.map((ref) => { const removable = Boolean(metadata.h3Refs && typeof metadata.h3Refs === "object" && Object.values(metadata.h3Refs as Record<string, unknown>).some((values) => Array.isArray(values) && values.some((item) => item && typeof item === "object" && String((item as Record<string, unknown>).url || (item as Record<string, unknown>).dataUrl || "") === ref.url))); return <span key={ref.url} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, padding: "3px 6px", borderRadius: 5, background: ctx.theme.toolbar.panel }}><span>{ref.name}</span>{removable ? <button type="button" aria-label="移除引用" onClick={() => removeStoredRef(ref.url)} style={{ border: 0, background: "transparent", color: ctx.theme.node.muted, cursor: "pointer", padding: 0 }}>×</button> : null}</span>; }) : <span style={{ color: ctx.theme.node.placeholder, fontSize: 10 }}>拖入角色图、源视频或音频</span>}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 7 }}>
                <label style={{ fontSize: 10 }}>时长<input value={duration} onChange={(event) => setDuration(event.target.value)} style={field} /></label>
                <label style={{ fontSize: 10 }}>比例<select value={ratio} onChange={(event) => setRatio(event.target.value)} style={field}><option>16:9 (Widescreen)</option><option>9:16 (Portrait Widescreen)</option><option>1:1 (Square)</option><option>4:3 (Standard)</option><option>3:4 (Portrait Standard)</option><option>21:9 (Ultrawide)</option></select></label>
                    <label style={{ fontSize: 10 }}>步数<input value={steps} onChange={(event) => setSteps(event.target.value)} style={field} /></label>
                    <label style={{ fontSize: 10 }}>百万像素<input type="number" min="0.1" max="2" step="0.1" value={megapixels} onChange={(event) => setMegapixels(event.target.value)} style={field} /></label>
            </div>
            <label style={{ fontSize: 10 }}>随机种子（留空为随机）<input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="可选，0-4294967295" type="number" min="0" max="4294967295" step="1" style={field} /></label>
            <label style={{ fontSize: 10 }}>基础模型<select value={modelName} onChange={(event) => { setModelName(event.target.value); update({ modelName: event.target.value, minimaxBaseModel: event.target.value }); }} style={field}>{h3ModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 7, alignItems: "end" }}><label style={{ fontSize: 10 }}>LoRA 名称<input value={loraName} onChange={(event) => setLoraName(event.target.value)} placeholder="可选" style={field} /></label><label style={{ fontSize: 10 }}>战斗 LoRA<input type="number" min="0" max="1" step="0.05" value={combatLoraWeight} onChange={(event) => setCombatLoraWeight(event.target.value)} style={field} /></label><label style={{ fontSize: 10 }}>电影 LoRA<input type="number" min="0" max="1" step="0.05" value={cinematicLoraWeight} onChange={(event) => setCinematicLoraWeight(event.target.value)} style={field} /></label><Toggle ctx={ctx} label="TE 加速" value={teAccel} onChange={setTeAccel} /></div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><Toggle ctx={ctx} label="提示词增强" value={promptEnhance} onChange={setPromptEnhance} />{promptEnhance ? <select value={promptEnhanceLanguage} onChange={(event) => setPromptEnhanceLanguage(event.target.value)} style={{ ...field, width: 90 }}><option value="zh">中文</option><option value="en">English</option></select> : null}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}><span style={{ fontSize: 10, fontWeight: 800 }}>Clip 分段（{segmentsFor(metadata).length}）</span><button type="button" onClick={() => { const current = segmentsFor(metadata); const next = [...current, { id: `segment-${current.length + 1}`, prompt, duration: Number(duration), status: "idle" }]; update({ segments: next }); }} style={buttonStyle(ctx)}>＋分段</button></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 150, overflow: "auto" }}>{segmentList.map((segment, index) => <div key={segment.id} onClick={() => { setSelectedSegmentId(segment.id); update({ selectedSegmentId: segment.id }); }} style={{ display: "grid", gridTemplateColumns: "48px 1fr 58px 24px", gap: 5, alignItems: "center", padding: 3, borderRadius: 7, outline: segment.id === selectedSegment?.id ? `1px solid ${ctx.theme.toolbar.activeText}` : "1px solid transparent" }}><span style={{ fontSize: 10, color: ctx.theme.node.muted }}>Clip {index + 1}</span><input value={String(segment.prompt || "")} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSegment(ctx, metadata, index, { prompt: event.target.value })} style={field} /><input type="number" min="0.5" max="60" step="0.5" value={Number(segment.duration || duration)} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSegment(ctx, metadata, index, { duration: Number(event.target.value) })} style={field} /><button type="button" disabled={segmentList.length <= 1} onClick={(event) => { event.stopPropagation(); update({ segments: segmentList.filter((_, itemIndex) => itemIndex !== index) }); }} style={{ ...buttonStyle(ctx), padding: "4px 6px" }}>×</button></div>)}</div>
            {selectedSegment ? <div style={{ borderTop: `1px solid ${ctx.theme.node.stroke}`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ fontSize: 11, fontWeight: 800 }}>Clip {segmentList.findIndex((segment) => segment.id === selectedSegment.id) + 1} 设置</div>
                <label style={{ fontSize: 10 }}>任务模式<select value={String(selectedSegment.taskMode || "r2v")} onChange={(event) => updateSelected({ taskMode: event.target.value })} style={field}><option value="t2v">文生视频</option><option value="i2v">图生视频</option><option value="fl2v">首尾帧生视频</option><option value="r2v">参考主体生视频</option><option value="v2v">视频编辑</option><option value="rv2v">参考素材改视频</option></select></label>
                <label style={{ fontSize: 10 }}>Base model<select value={normalizeH3Model(selectedSegment.modelName || modelName)} onChange={(event) => { setModelName(event.target.value); updateSelected({ modelName: event.target.value }); }} style={field}>{h3ModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label style={{ fontSize: 10 }}>LoRA<select value={String(selectedSegment.loraName ?? loraName)} onChange={(event) => { setLoraName(event.target.value); updateSelected({ loraName: event.target.value }); }} style={field}>{h3LoraOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><label style={{ fontSize: 10 }}>Combat LoRA<input type="number" min="0" max="1" step="0.05" value={Number(selectedSegment.combatLoraWeight ?? combatLoraWeight)} onChange={(event) => { setCombatLoraWeight(event.target.value); updateSelected({ combatLoraWeight: Number(event.target.value) }); }} style={field} /></label><label style={{ fontSize: 10 }}>MysticXXX LoRA<input type="number" min="0" max="1" step="0.05" value={Number(selectedSegment.cinematicLoraWeight ?? cinematicLoraWeight)} onChange={(event) => { setCinematicLoraWeight(event.target.value); updateSelected({ cinematicLoraWeight: Number(event.target.value) }); }} style={field} /></label></div>
                <Toggle ctx={ctx} label="TE Speed" value={selectedSegment.teAccel ?? teAccel} onChange={(value) => { setTeAccel(value); updateSelected({ teAccel: value }); }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                    <label style={{ fontSize: 10 }}>比例<select value={String(selectedSegment.aspectRatio || ratio)} onChange={(event) => updateSelected({ aspectRatio: event.target.value })} style={field}><option>16:9 (Widescreen)</option><option>9:16 (Portrait Widescreen)</option><option>1:1 (Square)</option><option>4:3 (Standard)</option><option>3:4 (Portrait Standard)</option><option>21:9 (Ultrawide)</option></select></label>
                    <label style={{ fontSize: 10 }}>步数<input type="number" min="1" max="60" value={Number(selectedSegment.videoSteps || steps)} onChange={(event) => updateSelected({ videoSteps: Number(event.target.value) })} style={field} /></label>
                    <label style={{ fontSize: 10 }}>去噪<input type="number" min="0" max="1" step="0.05" value={Number(selectedSegment.denoise ?? denoise)} onChange={(event) => updateSelected({ denoise: Number(event.target.value) })} style={field} /></label>
                </div>
                <label style={{ fontSize: 10 }}>Clip 随机种子（留空为随机）<input type="number" min="0" max="4294967295" step="1" value={String(selectedSegment.seed ?? "")} onChange={(event) => updateSelected({ seed: event.target.value })} style={field} /></label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Toggle ctx={ctx} label="Motion Context" value={selectedSegment.motionContextEnabled !== false} onChange={(value) => updateSelected({ motionContextEnabled: value })} /><Toggle ctx={ctx} label="递进增噪" value={selectedSegment.motionContextNoiseEnabled === true} onChange={(value) => updateSelected({ motionContextNoiseEnabled: value })} /></div>
                {selectedSegment.taskMode === "rv2v" ? <><label style={{ fontSize: 10 }}>音频模式<select value={String(selectedSegment.audioMode || "native")} onChange={(event) => updateSelected({ audioMode: event.target.value })} style={field}><option value="native">原生生成</option><option value="lock_source">保留源音频</option><option value="remix_source">混音源音频</option><option value="reference_only">仅作参考</option></select></label><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><label style={{ fontSize: 10 }}>音频去噪<input type="number" min="0" max="1" step="0.05" value={Number(selectedSegment.audioDenoiseStrength ?? 1)} onChange={(event) => updateSelected({ audioDenoiseStrength: Number(event.target.value) })} style={field} /></label><label style={{ fontSize: 10 }}>参考视频策略<select value={String(selectedSegment.referenceVideoPolicy || "official_2_to_15s")} onChange={(event) => updateSelected({ referenceVideoPolicy: event.target.value })} style={field}><option value="official_2_to_15s">官方 2-15 秒</option><option value="model_minimum">模型最短时长</option></select></label></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Toggle ctx={ctx} label="源视频作为参考" value={selectedSegment.addSourceAsReference === true} onChange={(value) => updateSelected({ addSourceAsReference: value })} /><Toggle ctx={ctx} label="严格提示词标签" value={selectedSegment.strictPromptTags !== false} onChange={(value) => updateSelected({ strictPromptTags: value })} /></div></> : null}
            </div> : null}
            <label style={{ fontSize: 10 }}>去噪强度<input value={denoise} onChange={(event) => setDenoise(event.target.value)} type="number" min="0.05" max="1" step="0.05" style={field} /></label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Toggle ctx={ctx} label="Motion Context" value={motion} onChange={setMotion} /><Toggle ctx={ctx} label="递进增噪" value={motionNoise} onChange={setMotionNoise} /></div>
            {motionNoise ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}><label style={{ fontSize: 10 }}>噪声起始<input value={noiseAlpha} onChange={(event) => setNoiseAlpha(event.target.value)} type="number" min="0" max="1" step="0.05" style={field} /></label><label style={{ fontSize: 10 }}>噪声结束<input value={noiseAlphaEnd} onChange={(event) => setNoiseAlphaEnd(event.target.value)} type="number" min="0" max="1" step="0.05" style={field} /></label><label style={{ fontSize: 10 }}>渐变帧数<input value={noiseRampFrames} onChange={(event) => setNoiseRampFrames(event.target.value)} type="number" min="0" max="22" step="1" style={field} /></label></div> : null}
            {sourceVideo ? <><Toggle ctx={ctx} label="源视频自动分段" value={autoSplit} onChange={(value) => { setAutoSplit(value); update({ autoSplit: value }); }} /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><label style={{ fontSize: 10 }}>每段秒数<input value={segmentDuration} onChange={(event) => { setSegmentDuration(event.target.value); update({ segmentDuration: Number(event.target.value) }); }} type="number" min="0.5" max="60" step="0.5" style={field} /></label><label style={{ fontSize: 10 }}>最多段数<input value={maxSegments} onChange={(event) => { setMaxSegments(event.target.value); update({ maxSegments: Number(event.target.value) }); }} type="number" min="1" max="240" step="1" style={field} /></label></div></> : null}
            <div style={{ color: ctx.theme.node.muted, fontSize: 10, lineHeight: 1.4 }}>上游素材按连接顺序作为 refs；视频源与角色图可直接连接到本节点。参数会保存在节点自身。</div>
            <div style={{ display: "flex", gap: 7 }}><button type="button" disabled={running} onClick={() => void run()} style={{ ...buttonStyle(ctx, true), flex: 1, opacity: running ? 0.6 : 1 }}>{running ? "生成中…" : "运行 H3"}</button><button type="button" onClick={() => update({ content: "", status: "idle", errorDetails: "" })} style={buttonStyle(ctx)}>清空结果</button></div>
        </div>
    );
}

function refsForSegment(segment: H3Segment) {
    const buckets = segment.refs;
    const items = segment.refItems || [ ...(buckets?.image || []), ...(buckets?.video || []), ...(buckets?.audio || []) ];
    const refs = items.filter((item) => item?.url).map((item) => ({ ...item, type: item.type || (item as H3Ref & { kind?: H3Ref["type"] }).kind || "image" as const }));
    return refs.filter((item, index, all) => all.findIndex((other) => sameRef(other, item)) === index);
}

function resultUrl(value: unknown) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const item = value as Record<string, unknown>;
    return String(item.url || item.video_url || item.content || item.localUrl || "");
}

function appendVideoMaterials(existing: unknown, additions: Array<{ url: string; type: string; name: string }>) {
    const current = Array.isArray(existing) ? existing.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
    const next = [...current, ...additions].filter((item, index, all) => {
        const url = String(item.url || "");
        return Boolean(url) && all.findIndex((candidate) => String(candidate.url || "") === url) === index;
    });
    return next;
}


function updateSegment(ctx: CanvasNodeContext, metadata: Record<string, unknown>, index: number, patch: Partial<H3Segment>) {
    const next = segmentsFor(metadata).map((segment, itemIndex) => itemIndex === index ? { ...segment, ...patch } : segment);
    ctx.updateMetadata({ segments: next });
}

