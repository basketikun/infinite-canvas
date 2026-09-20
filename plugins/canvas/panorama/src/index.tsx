// 3D 全景节点:等距柱状(equirectangular)360° 全景查看器。
// 三种取图方式:① 从上游图片节点自动取图 ② 本地上传 ③ AI 生成(复用宿主内置生成面板)。
// three.js 从 CDN 按需加载,不打进 bundle。AI 生成通过 useBuiltinPanel 声明,结果写回本节点。
import { definePlugin, useCallback, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext } from "@infinite-canvas/plugin-sdk";

// three 从 CDN 动态加载(env.d.ts 里声明为 any),不打进 bundle
let threePromise: Promise<any> | undefined;
function loadThree(): Promise<any> {
    if (!threePromise) threePromise = import("https://esm.sh/three@0.180.0");
    return threePromise;
}

// AI 生成的固定前置提示词:约束模型产出可用于球面贴图的 equirectangular 全景图。
// 用户只需描述场景内容,这段会自动拼在前面,保证 2:1、无缝、无畸变文字等。
const PANORAMA_SYSTEM_PROMPT =
    "A seamless 360-degree equirectangular panorama, 2:1 aspect ratio, full spherical VR photo, " +
    "horizontally wrapping seamlessly at the left and right edges, no visible seam, no distortion artifacts, " +
    "even horizon, no text, no watermark. Scene: ";

// ---------------------------------------------------------------------------
// 全景查看器:球体内壁贴等距柱状纹理,指针拖动转视角、滚轮缩放 fov。
// 自适应容器尺寸(ResizeObserver);超过 GPU 上限的大图先降采样,避免加载失败。
// ---------------------------------------------------------------------------
function PanoramaViewer({ src, ctx }: { src: string; ctx: CanvasNodeContext }) {
    const mountRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !src) return;
        let disposed = false;
        let frame = 0;
        let renderer: any = null;
        let geometry: any = null;
        let material: any = null;
        let texture: any = null;
        let resizeObserver: ResizeObserver | null = null;
        let cleanupEvents = () => {};

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
                const onUp = () => {
                    dragging = false;
                    canvas.style.cursor = "grab";
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
                const image = new Image();
                image.crossOrigin = "anonymous";
                image.onload = () => {
                    if (disposed || !material) return;
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

        return () => {
            disposed = true;
            cleanupEvents();
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
    }, [src]);

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
// 空态:两个明确按钮——「上传全景图」和「AI 生成」(打开下方内置生成面板)。
// 整块不可点,避免误触;拖动节点照常。
// ---------------------------------------------------------------------------
function PanoramaEmpty({ ctx }: { ctx: CanvasNodeContext }) {
    const fileRef = useRef<HTMLInputElement>(null);

    // 本地上传:读为 dataURL 写入自身 metadata.content
    const onPick = useCallback(
        (file: File | undefined) => {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => ctx.updateMetadata({ content: String(reader.result || "") });
            reader.readAsDataURL(file);
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
            <span style={{ fontSize: 34 }}>🌐</span>
            <div data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} style={{ display: "flex", gap: 10 }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0])} />
                <button type="button" style={baseBtn} onClick={() => fileRef.current?.click()}>
                    🖼 上传全景图
                </button>
                <button type="button" style={{ ...baseBtn, border: "none", background: t.toolbar.activeBg, color: t.toolbar.activeText }} onClick={() => ctx.openPanel()}>
                    ✨ AI 生成
                </button>
            </div>
            <span style={{ fontSize: 12, color: t.node.placeholder, textAlign: "center" }}>支持 2:1 等距柱状全景图</span>
        </div>
    );
}

function PanoramaContent({ ctx }: CanvasNodeContentProps) {
    const upstreamImage = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find((content): content is string => typeof content === "string" && Boolean(content));
    const source = (typeof ctx.node.metadata?.content === "string" ? ctx.node.metadata.content : "") || upstreamImage || "";

    if (!source) return <PanoramaEmpty ctx={ctx} />;
    return <PanoramaViewer src={source} ctx={ctx} />;
}

export default definePlugin({
    id: "panorama",
    name: "3D 全景节点",
    version: "1.1.0",
    description: "查看 360° 等距柱状全景图,支持上传与 AI 生成,可从上游图片节点取图",
    nodes: [
        {
            type: "panorama:viewer",
            title: "3D 全景",
            icon: "🌐",
            description: "360° 全景查看器(上传 / AI 生成)",
            defaultSize: { width: 480, height: 300 },
            defaultMetadata: {},
            minimapColor: "#0ea5e9",
            // 宿主自动提供「交互 ⇄ 移动」开关:默认移动(拖动节点),切到交互后可转全景视角
            interactionToggle: true,
            // 复用宿主内置生成面板(模型选择/设置完全一致),生成结果写回本节点。
            // 前缀约束模型产出可用于球面贴图的 equirectangular 全景图。
            useBuiltinPanel: { mode: "image", promptPrefix: PANORAMA_SYSTEM_PROMPT, writeBackToSelf: true },
            // 作为上游被消费时,输出自身全景图,供下游节点引用
            resource: (node) => {
                const content = node.metadata?.content;
                return typeof content === "string" && content ? { kind: "image", url: content } : null;
            },
            Content: PanoramaContent,
            // 工具条始终提供「AI 生成」(打开下方内置面板);有图时额外提供「换图」
            toolbar: (ctx) => {
                const hasOwnContent = typeof ctx.node.metadata?.content === "string" && Boolean(ctx.node.metadata?.content);
                return [
                    {
                        id: "panorama-generate",
                        title: "用 AI 生成全景图(打开下方面板)",
                        label: "AI 生成",
                        icon: "✨",
                        onClick: () => ctx.openPanel(),
                    },
                    ...(hasOwnContent
                        ? [
                              {
                                  id: "panorama-reset",
                                  title: "清空当前全景图,重新上传",
                                  label: "换图",
                                  icon: "🔄",
                                  onClick: () => ctx.updateMetadata({ content: "" }),
                              },
                          ]
                        : []),
                ];
            },
        },
    ],
});
