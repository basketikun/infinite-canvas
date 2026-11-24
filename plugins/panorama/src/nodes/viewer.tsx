// 3D 全景节点:等距柱状(equirectangular)360° 全景查看器。
// 三种取图方式:① 选择上游图片 ② 本地上传 ③ AI 生成(复用宿主内置生成面板)。进入全景后才读取原图。
// three.js 随插件包分发。AI 生成通过 useBuiltinPanel 声明,结果写回本节点。
import { Globe, Image as ImageIcon, Move3d } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CanvasNodeDefinition, CanvasNodeContentProps, CanvasNodeContext } from "@infinite-canvas/plugin-sdk";

// three 随浏览器入口打包，首次打开节点时初始化。
let threePromise: Promise<any> | undefined;
function loadThree(): Promise<any> {
    if (!threePromise) threePromise = import("three").catch((error) => { threePromise = undefined; throw error; });
    return threePromise;
}

// AI 生成的固定前置提示词:约束模型产出可用于球面贴图的 equirectangular 全景图。
// 用户只需描述场景内容,这段会自动拼在前面,保证 2:1、无缝、无畸变文字等。
const PANORAMA_SYSTEM_PROMPT =
    "A seamless 360-degree equirectangular panorama photo, 2:1 aspect ratio, full spherical projection covering 360 degrees horizontally and 180 degrees vertically. " +
    "The left and right edges connect seamlessly with no visible seam, the horizon is level at the vertical center, vertical lines stay straight, " +
    "sky or ceiling at the top and ground or floor at the bottom with natural spherical stretching. " +
    "No text, no watermark, no border, no frame, no split panels, no collage. Scene: ";

// ---------------------------------------------------------------------------
// 全景查看器:球体内壁贴等距柱状纹理,指针拖动转视角、滚轮缩放 fov。
// 自适应容器尺寸(ResizeObserver);超过 GPU 上限的大图先降采样,避免加载失败。
// ---------------------------------------------------------------------------
function PanoramaViewer({ src, ctx, signal }: { src: string; ctx: CanvasNodeContext; signal: AbortSignal }) {
    const mountRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

    useLayoutEffect(() => {
        const mount = mountRef.current;
        if (!mount || !src || signal.aborted) return;
        let disposed = false;
        let frame = 0;
        let renderer: any = null;
        let geometry: any = null;
        let material: any = null;
        let texture: any = null;
        let resizeObserver: ResizeObserver | null = null;
        let cleanupEvents = () => {};
        let image: HTMLImageElement | null = null;

        setStatus("loading");

        loadThree()
            .then((THREE: any) => {
                if (disposed || !mountRef.current) return;

                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(70, 1, 1, 1100);
                const target = new THREE.Vector3();

                renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                renderer.setClearColor(0x000000, 1);
                const canvas: HTMLCanvasElement = renderer.domElement;
                canvas.style.width = "100%";
                canvas.style.height = "100%";
                canvas.style.display = "block";
                canvas.style.cursor = "grab";
                mount.appendChild(canvas);
                const maxTextureSide = Math.min(renderer.capabilities.maxTextureSize || 4096, 4096);

                geometry = new THREE.SphereGeometry(500, 96, 64);
                geometry.scale(-1, 1, 1); // 翻转法线,从球心向内看
                material = new THREE.MeshBasicMaterial({ color: 0xffffff });
                scene.add(new THREE.Mesh(geometry, material));

                // 视角状态
                let lon = 0;
                let lat = 0;
                let fov = 70;
                let dragging = false;
                let startX = 0;
                let startY = 0;
                let startLon = 0;
                let startLat = 0;

                const onDown = (event: PointerEvent) => {
                    dragging = true;
                    startX = event.clientX;
                    startY = event.clientY;
                    startLon = lon;
                    startLat = lat;
                    canvas.style.cursor = "grabbing";
                    canvas.setPointerCapture?.(event.pointerId);
                };
                const onMove = (event: PointerEvent) => {
                    if (!dragging) return;
                    lon = startLon - (event.clientX - startX) * 0.12;
                    lat = Math.max(-84, Math.min(84, startLat + (event.clientY - startY) * 0.12));
                };
                const onUp = (event: PointerEvent) => {
                    const wasDragging = dragging;
                    dragging = false;
                    canvas.style.cursor = "grab";
                    // 没有拖动的单击等同于点击节点：打开下方对话框。
                    if (wasDragging && event.type === "pointerup" && Math.hypot(event.clientX - startX, event.clientY - startY) < 4) ctx.openPanel();
                };
                const onWheel = (event: WheelEvent) => {
                    event.preventDefault();
                    fov = Math.max(38, Math.min(86, fov + event.deltaY * 0.035));
                };
                canvas.addEventListener("pointerdown", onDown);
                canvas.addEventListener("pointermove", onMove);
                canvas.addEventListener("pointerup", onUp);
                canvas.addEventListener("pointercancel", onUp);
                canvas.addEventListener("wheel", onWheel, { passive: false });
                cleanupEvents = () => {
                    canvas.removeEventListener("pointerdown", onDown);
                    canvas.removeEventListener("pointermove", onMove);
                    canvas.removeEventListener("pointerup", onUp);
                    canvas.removeEventListener("pointercancel", onUp);
                    canvas.removeEventListener("wheel", onWheel);
                };

                const resize = () => {
                    if (!renderer || !mountRef.current) return;
                    const width = Math.max(1, mountRef.current.clientWidth);
                    const height = Math.max(1, mountRef.current.clientHeight);
                    renderer.setSize(width, height, false);
                    camera.aspect = width / height;
                    camera.updateProjectionMatrix();
                };
                resizeObserver = new ResizeObserver(resize);
                resizeObserver.observe(mount);
                resize();

                const render = () => {
                    if (disposed || !renderer) return;
                    if (!dragging) lon += 0.02; // 缓慢自转
                    camera.fov = fov;
                    camera.updateProjectionMatrix();
                    const phi = THREE.MathUtils.degToRad(90 - lat);
                    const theta = THREE.MathUtils.degToRad(lon);
                    target.set(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
                    camera.lookAt(target);
                    renderer.render(scene, camera);
                    frame = requestAnimationFrame(render);
                };
                render();

                // 载入纹理:大图降采样到 GPU 上限,避免超限导致黑屏/失败
                image = new Image();
                image.crossOrigin = "anonymous";
                image.onload = () => {
                    if (disposed || !material || !image) return;
                    try {
                        const w = image.naturalWidth || image.width;
                        const h = image.naturalHeight || image.height;
                        const scale = Math.min(1, maxTextureSide / w, maxTextureSide / h);
                        let source: HTMLImageElement | HTMLCanvasElement = image;
                        if (scale < 1) {
                            const c = document.createElement("canvas");
                            c.width = Math.max(1, Math.round(w * scale));
                            c.height = Math.max(1, Math.round(h * scale));
                            c.getContext("2d")?.drawImage(image, 0, 0, c.width, c.height);
                            source = c;
                        }
                        texture = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
                        texture.colorSpace = THREE.SRGBColorSpace;
                        texture.minFilter = THREE.LinearFilter;
                        texture.needsUpdate = true;
                        material.map = texture;
                        material.needsUpdate = true;
                        setStatus("ready");
                    } catch {
                        setStatus("error");
                    }
                };
                image.onerror = () => !disposed && setStatus("error");
                image.src = src;
            })
            .catch(() => !disposed && setStatus("error"));

        const release = () => {
            if (disposed) return;
            disposed = true;
            signal.removeEventListener("abort", release);
            cleanupEvents();
            if (image) { image.onload = null; image.onerror = null; image.src = ""; }
            resizeObserver?.disconnect();
            if (frame) cancelAnimationFrame(frame);
            texture?.dispose?.();
            material?.dispose?.();
            geometry?.dispose?.();
            if (renderer) {
                renderer.domElement?.remove?.();
                renderer.dispose?.();
                renderer.forceContextLoss?.();
            }
        };
        signal.addEventListener("abort", release, { once: true });
        return release;
    }, [src, signal]);

    return (
        <div style={{ position: "relative", height: "100%", width: "100%", overflow: "hidden", borderRadius: 16, background: "#000" }}>
            <div ref={mountRef} data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} style={{ position: "absolute", inset: 0 }} />
            {status !== "ready" ? (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: ctx.theme.node.placeholder, fontSize: 13, background: status === "error" ? "rgba(0,0,0,0.6)" : `linear-gradient(135deg, ${ctx.theme.node.fill}, #000)` }}>
                    {status === "error" ? "全景图读取失败,请换 2:1 的 JPG/PNG 全景图" : "正在加载全景…"}
                </div>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------
// 空态:提供「上传全景图」按钮;AI 生成在单击节点后打开的下方对话框中进行。
// 整块不可点,避免误触;拖动节点照常。
// ---------------------------------------------------------------------------
function PanoramaEmpty({ ctx }: { ctx: CanvasNodeContext }) {
    const [failed, setFailed] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    // 本地上传:存入宿主图片库,节点只记录图片引用
    const onPick = useCallback(
        (file: File | undefined) => {
            if (!file) return;
            setFailed(false);
            void ctx.images.store(file, ctx.scope.signal).then((image) => ctx.updateMetadata({ content: image.url, storageKey: image.storageKey })).catch((error) => {
                if (ctx.scope.signal.aborted) return;
                console.error("[panorama] save image", error);
                setFailed(true);
            });
        },
        [ctx],
    );

    const t = ctx.theme;
    const baseBtn = {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        borderRadius: 999,
        padding: "9px 18px",
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${t.node.stroke}`,
        background: t.node.fill,
        color: t.node.text,
    } as const;

    return (
        <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 20, borderRadius: 16, boxSizing: "border-box", background: t.node.fill }}>
            {failed && <p role="alert">全景图未能保存，请重新选择。</p>}
            <Globe size={34} aria-hidden />
            <div data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} style={{ display: "flex", gap: 10 }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0])} />
                <button type="button" style={baseBtn} onClick={() => fileRef.current?.click()}>
                    <ImageIcon size={16} aria-hidden style={{ marginRight: 6, verticalAlign: "-3px" }} />上传全景图
                </button>
            </div>
            <span style={{ fontSize: 12, color: t.node.placeholder, textAlign: "center" }}>上传 2:1 等距柱状全景图，或在下方对话框描述场景生成</span>
        </div>
    );
}

type PanoramaSource = { nodeId: string; storageKey?: string; url?: string };
type PanoramaRead = { source: PanoramaSource; signal: AbortSignal; preview?: string; original?: string; pending?: boolean };

function getPanoramaSource(ctx: CanvasNodeContext): PanoramaSource | null {
    const current = ctx.getNode(ctx.node.id);
    if (!current) return null;
    const node = current.metadata?.storageKey || current.metadata?.content ? current : ctx.getUpstream().find((item) => item.metadata?.storageKey || item.metadata?.content);
    return node ? { nodeId: node.id, storageKey: node.metadata?.storageKey, url: node.metadata?.content } : null;
}

function PanoramaContent({ ctx }: CanvasNodeContentProps) {
    useSyncExternalStore(ctx.subscribe, ctx.getSnapshot);
    const source = getPanoramaSource(ctx);
    const active = useRef<PanoramaRead | null>(null);
    const [view, setView] = useState<PanoramaRead | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    useLayoutEffect(() => {
        setView(null);
        setLoading(false);
        setFailed(false);
        if (!source || ctx.scope.signal.aborted) return;
        const controller = new AbortController();
        const signal = AbortSignal.any([ctx.scope.signal, controller.signal]);
        const record: PanoramaRead = { source, signal };
        active.current = record;
        const unsubscribe = ctx.subscribe(() => {
            if (signal.aborted) return;
            try {
                const current = getPanoramaSource(ctx);
                if (!current || current.nodeId !== source.nodeId || current.storageKey !== source.storageKey || current.url !== source.url) controller.abort();
            } catch (error) { controller.abort(error); }
        });
        const release = () => {
            signal.removeEventListener("abort", release);
            unsubscribe();
            controller.abort();
            if (record.preview) { URL.revokeObjectURL(record.preview); record.preview = undefined; }
            if (record.original) { URL.revokeObjectURL(record.original); record.original = undefined; }
            if (active.current === record) { active.current = null; setView(null); setLoading(false); }
        };
        signal.addEventListener("abort", release, { once: true });
        setView(record);
        if (source.storageKey) void ctx.images.preview(source.storageKey, signal).then((blob) => {
            if (!blob || signal.aborted) return;
            record.preview = URL.createObjectURL(blob);
            setView({ ...record });
        }).catch((error) => { if (!signal.aborted) console.error("[panorama] image preview", error); });
        return release;
    }, [ctx.images, ctx.scope.signal, source?.nodeId, source?.storageKey, source?.url]);
    const open = async () => {
        const record = active.current;
        if (!record || record.signal.aborted || record.pending || record.original) return;
        record.pending = true;
        setLoading(true);
        setFailed(false);
        try {
            const blob = await ctx.images.read(record.source.storageKey, record.source.url, record.signal);
            record.signal.throwIfAborted();
            record.original = URL.createObjectURL(blob);
            setView({ ...record });
        } catch (error) {
            if (!record.signal.aborted) { console.error("[panorama] open image", error); setFailed(true); }
        } finally { record.pending = false; if (active.current === record) setLoading(false); }
    };
    // 交互状态才载入原图并进入全景；移动状态只显示预览，工具条的「交互」或双击节点即可切换。
    const interactive = Boolean(ctx.node.metadata?.interactive);
    useEffect(() => {
        if (interactive && view) void open();
    }, [interactive, view?.source.nodeId, view?.source.storageKey, view?.source.url]);
    if (ctx.node.metadata?.status === "loading") return <p role="status">正在生成全景图…</p>;
    if (ctx.node.metadata?.status === "error") return <p>全景图未生成，请打开生成面板重试。</p>;
    if (!source) return <PanoramaEmpty ctx={ctx} />;
    if (interactive && view?.original && !view.signal.aborted) return <PanoramaViewer src={view.original} ctx={ctx} signal={view.signal} />;
    const hint = failed ? "全景图暂时无法打开，请重试" : interactive || loading ? "正在加载全景…" : "双击节点进入全景";
    return <div style={{ position: "relative", height: "100%", width: "100%", display: "grid", placeItems: "center", color: ctx.theme.node.text }}>
        {view?.preview && <img src={view.preview} onError={() => setView((current) => current && ({ ...current, preview: undefined }))} alt="全景预览" style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />}
        <div role={failed ? "alert" : "status"} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 999, padding: "6px 14px", fontSize: 12, background: ctx.theme.toolbar.panel, color: ctx.theme.node.text, pointerEvents: "none" }}><Move3d size={14} aria-hidden />{hint}</div>
    </div>;
}

export const viewer: CanvasNodeDefinition = {
    type: "panorama:viewer",
    title: "3D 全景",
    icon: <Globe />,
    description: "360° 全景查看器",
    defaultSize: { width: 480, height: 240 },
    // 等距柱状全景图固定 2:1，缩放节点时保持比例。
    keepAspectRatio: () => true,
    defaultMetadata: { mediaKind: "image" },
    minimapColor: "#0ea5e9",
    // 宿主自动提供「交互 ⇄ 移动」开关:默认移动(拖动节点),切到交互后可转全景视角
    interactionToggle: true,
    // 复用宿主内置生成面板(模型选择/设置/提示词库完全一致),生成结果写回本节点。
    // 前缀约束模型产出可用于球面贴图的 equirectangular 全景图。
    useBuiltinPanel: { mode: "image", promptPrefix: PANORAMA_SYSTEM_PROMPT, writeBackToSelf: true, imageAspectRatio: "2:1" },
    // 双击在「移动」与「交互（进入全景）」之间切换，与工具条的开关一致。
    onDoubleClick: (ctx) => {
        if (!getPanoramaSource(ctx)) return false;
        void ctx.updateMetadata({ interactive: !ctx.node.metadata?.interactive }).catch((error) => { if (!ctx.scope.signal.aborted) console.error("[panorama] toggle interactive", error); });
        return true;
    },
    Content: PanoramaContent,
};
