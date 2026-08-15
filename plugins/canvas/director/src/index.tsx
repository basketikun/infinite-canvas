import { definePlugin, useEffect, useRef } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeWorkspaceProps, CanvasUpstreamResource, PluginAgentAction } from "@infinite-canvas/plugin-sdk";

type DirectorContext = CanvasNodeContentProps["ctx"];
type DirectorAgentCall = (action: string, params: Record<string, unknown>) => Promise<unknown>;

const directorAgentCalls = new Map<string, DirectorAgentCall>();
const DIRECTOR_AGENT_ACTIONS: PluginAgentAction[] = [
    ["get_state", "读取当前场景、镜头、实体、演员标记和 Camera Mark。"],
    ["list_assets", "列出 Blockout 可用资产。"],
    ["add_entity", "向当前场景添加一个实体。"],
    ["move_entity", "移动或旋转一个实体。"],
    ["delete_entity", "删除一个实体。"],
    ["add_actor_mark", "为实体添加演员运动标记。"],
    ["add_camera_mark", "为当前镜头添加 Camera Mark。"],
    ["clear_camera_marks", "清除当前镜头的 Camera Marks。"],
    ["set_shot", "修改当前镜头名称、时长、FPS 或画幅。"],
    ["new_shot", "在当前场景新建镜头。"],
    ["apply_framing", "应用 2S、OTS、REV、TOP、LOW 或 DUTCH 构图。"],
    ["list_choreography_options", "列出编舞类型、风格、队形和结尾选项。"],
    ["spawn_choreography", "在当前场景生成舞蹈、打斗或追逐编舞。"],
    ["choreograph_entities", "为已有演员实体生成编舞标记。"],
    ["list_motion_presets", "列出可用运动预设。"],
    ["set_time", "设置当前播放时间。"],
    ["play", "从头播放当前镜头。"],
    ["stop", "停止播放。"],
    ["screenshot", "导出当前镜头当前时间的 PNG 截图。"],
].map(([name, description]) => ({ name, description }));

const buttonStyle = (ctx: DirectorContext) => ({
    border: `1px solid ${ctx.theme.toolbar.border}`,
    borderRadius: 8,
    background: ctx.theme.toolbar.panel,
    color: ctx.theme.node.text,
    cursor: "pointer",
    padding: "7px 12px",
    fontSize: 12,
});

function metadataText(ctx: DirectorContext, key: string, fallback: string) {
    const value = ctx.node.metadata?.[key];
    return typeof value === "string" && value.trim() ? value : fallback;
}

function metadataNumber(ctx: DirectorContext, key: string, fallback: number) {
    const value = ctx.node.metadata?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function DirectorContent({ ctx }: CanvasNodeContentProps) {
    const scene = metadataText(ctx, "scene", "Scene 01");
    const shot = metadataText(ctx, "shot", "Shot 01");
    const duration = metadataNumber(ctx, "duration", 5);
    const fps = metadataNumber(ctx, "fps", 24);
    const focalLength = metadataNumber(ctx, "focalLength", 35);
    const entityCount = metadataNumber(ctx, "entityCount", 0);
    const thumbnail = metadataText(ctx, "thumbnail", "");
    const upstreamCount = ctx.getUpstreamResources().length;

    return (
        <div data-canvas-no-zoom style={{ display: "flex", height: "100%", width: "100%", gap: 12, padding: 12, boxSizing: "border-box", color: ctx.theme.node.text }}>
            <div style={{ display: "grid", width: 108, flexShrink: 0, placeItems: "center", borderRadius: 10, background: ctx.theme.node.panel, color: ctx.theme.node.muted, overflow: "hidden" }}>
                {thumbnail ? <img src={thumbnail} alt="Director thumbnail" style={{ height: "100%", width: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 30 }}>🎬</span>}
            </div>
            <div style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", gap: 7 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 15, fontWeight: 650 }}>{metadataText(ctx, "projectName", "Untitled Director")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px", fontSize: 11, opacity: 0.72 }}>
                    <span>{scene}</span>
                    <span>{shot}</span>
                    <span>{duration}s · {fps}fps</span>
                    <span>{focalLength}mm</span>
                </div>
                <div style={{ marginTop: "auto", fontSize: 11, opacity: 0.6 }}>上游参考：{upstreamCount} · 实体：{entityCount}</div>
                <button type="button" style={buttonStyle(ctx)} onMouseDown={(event) => event.stopPropagation()} onClick={() => ctx.openWorkspace()}>
                    打开导演台
                </button>
            </div>
        </div>
    );
}

const DIRECTOR_PROTOCOL = "infinite-canvas-director-v1";

type DirectorMessage = {
    protocol: typeof DIRECTOR_PROTOCOL;
    requestId?: string;
    type: string;
    payload?: unknown;
};

type StorageMeta = {
    projectSavedAt?: number;
    backupSavedAt?: number;
};

function isDirectorMessage(value: unknown): value is DirectorMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as { protocol?: unknown; requestId?: unknown; type?: unknown };
    return message.protocol === DIRECTOR_PROTOCOL && typeof message.type === "string" && (message.requestId === undefined || typeof message.requestId === "string");
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function storedJson(value: unknown): string | null {
    if (typeof value === "string") return value;
    const record = asRecord(value);
    return typeof record.json === "string" ? record.json : null;
}

function projectStorageKey(projectId: string, fileName: string): string {
    return `projects/${projectId}/${fileName}`;
}

function createBlockoutProjectId(): string {
    const suffix = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    return `director-project-${suffix}`;
}

function arrayBufferDataUrl(value: unknown): Promise<string> {
    const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : new Uint8Array();
    if (!bytes.length) return Promise.reject(new Error("Thumbnail payload is empty."));
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(reader.error || new Error("Thumbnail conversion failed."));
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        reader.readAsDataURL(new Blob([copy.buffer], { type: "image/png" }));
    });
}

const EXPORT_SERVICE_URL = "http://127.0.0.1:8787";

function exportServiceUrl(path: string) {
    return `${EXPORT_SERVICE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function exportServiceRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(exportServiceUrl(path), { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Export service request failed: ${response.status}`);
    return payload;
}

function exportBody(value: unknown): BodyInit {
    if (value instanceof ArrayBuffer) return new Uint8Array(value) as unknown as BodyInit;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength) as unknown as BodyInit;
    if (typeof value === "string") return value;
    return JSON.stringify(value ?? "");
}

function artifactMime(path: string) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
    if (lower.endsWith(".glb")) return "model/gltf-binary";
    return "application/octet-stream";
}

function absoluteExportArtifacts(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => ({
        ...item,
        url: typeof item.url === "string" ? exportServiceUrl(item.url) : item.url,
    }));
}

type ExportArtifact = { name: string; url?: string; mimeType?: string; size?: number };

function findExportArtifact(artifacts: ExportArtifact[], predicate: (name: string) => boolean) {
    return artifacts.find((artifact) => typeof artifact.name === "string" && predicate(artifact.name.toLowerCase()));
}

function DirectorWorkspace({ ctx, onClose }: CanvasNodeWorkspaceProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const generatedProjectId = useRef<string | null>(null);
    const storedProjectId = metadataText(ctx, "blockoutProjectId", "");
    const legacyProjectId = metadataText(ctx, "projectId", "");
    const projectId = storedProjectId || legacyProjectId || (generatedProjectId.current ??= createBlockoutProjectId());
    const projectName = metadataText(ctx, "projectName", "Untitled Director");
    const upstream = ctx.getUpstreamResources() as CanvasUpstreamResource[];
    const blockoutWebUrl = new URL("/plugins/blockout/workbench/index.html?director=phase8", window.location.origin).toString();
    const activeExportJobId = useRef<string | null>(null);
    const exportWritebackTimer = useRef<number | null>(null);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const pendingAgentCalls = useRef(new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>());

    useEffect(() => {
        if (!storedProjectId) ctx.updateMetadata({ blockoutProjectId: projectId });
    }, [ctx.node.id, ctx.updateMetadata, projectId, storedProjectId]);

    useEffect(() => {
        const respond = (requestId: string, type: string, origin: string, payload?: unknown, error?: unknown) => {
            iframeRef.current?.contentWindow?.postMessage(
                { protocol: DIRECTOR_PROTOCOL, requestId, type: `${type}:RESULT`, payload, error: error ? String(error) : undefined },
                origin || window.location.origin,
            );
        };

        const syncExportToCanvas = async (jobId: string) => {
            if (activeExportJobId.current !== jobId) return;
            const response = await exportServiceRequest<{ artifacts?: ExportArtifact[] }>(`/exports/${encodeURIComponent(jobId)}/artifacts`);
            if (activeExportJobId.current !== jobId) return;
            const artifacts = Array.isArray(response.artifacts) ? response.artifacts : [];
            const reference = findExportArtifact(artifacts, (name) => name.endsWith("_reference.mp4"));
            const still = findExportArtifact(artifacts, (name) => name.includes("/stills/") && (name.endsWith("_first.png") || name.endsWith("_mark-1.png")));
            const prompt = findExportArtifact(artifacts, (name) => name.endsWith("/prompt.txt") || name === "prompt.txt");
            const node = ctxRef.current.getNode(ctx.node.id);
            const baseX = (node?.position.x ?? 0) + (node?.width ?? 360) + 80;
            const baseY = node?.position.y ?? 0;
            const outputSpecs: Array<{ key: string; type: "video" | "image" | "text"; title: string; url?: string; content?: string; mimeType?: string }> = [];
            if (reference?.url) outputSpecs.push({ key: "referenceVideo", type: "video", title: "Director Reference MP4", url: reference.url, mimeType: reference.mimeType || "video/mp4" });
            if (still?.url) outputSpecs.push({ key: "mainStill", type: "image", title: "Director Main Still", url: still.url, mimeType: still.mimeType || "image/png" });
            if (prompt?.url) {
                const promptResponse = await fetch(prompt.url);
                const content = promptResponse.ok ? await promptResponse.text() : "";
                if (content.trim()) outputSpecs.push({ key: "prompt", type: "text", title: "Director Prompt", content, mimeType: "text/plain" });
            }
            const ops = outputSpecs.flatMap((spec, index) => {
                const id = `${ctx.node.id}-output-${spec.key}`;
                const current = ctxRef.current.getNode(id);
                const metadata = {
                    content: spec.content || spec.url || "",
                    status: "success" as const,
                    mimeType: spec.mimeType,
                    source: "director:blockout",
                    exportJobId: jobId,
                    exportArtifact: spec.key,
                };
                const nodeOp = current
                    ? { type: "update_node" as const, id, patch: { title: spec.title }, metadata }
                    : { type: "add_node" as const, id, nodeType: spec.type, title: spec.title, position: { x: baseX + index * 380, y: baseY + index * 260 }, width: spec.type === "text" ? 340 : 360, height: spec.type === "text" ? 220 : 240, metadata };
                const connection = { type: "connect_nodes" as const, fromNodeId: ctx.node.id, toNodeId: id };
                return [nodeOp, connection];
            });
            if (ops.length) ctxRef.current.applyOps(ops);
        };

        const scheduleExportWriteback = (jobId: string) => {
            if (exportWritebackTimer.current !== null) window.clearTimeout(exportWritebackTimer.current);
            exportWritebackTimer.current = window.setTimeout(() => {
                exportWritebackTimer.current = null;
                void syncExportToCanvas(jobId).catch((error) => console.warn("[director] export writeback failed", error));
            }, 750);
        };

        const handleRequest = async (message: DirectorMessage, origin: string) => {
            if (!message.requestId) return;
            const payload = asRecord(message.payload);

            try {
                if (message.type === "PROJECT_LOAD") {
                    const [projectValue, backupValue, metaValue] = await Promise.all([
                        ctx.storage.get(projectStorageKey(projectId, "project.json")),
                        ctx.storage.get(projectStorageKey(projectId, "project.autosave.json")),
                        ctx.storage.get<StorageMeta>(projectStorageKey(projectId, "meta")),
                    ]);
                    const meta = asRecord(metaValue);
                    const projectSavedAt = typeof meta.projectSavedAt === "number" ? meta.projectSavedAt : 0;
                    const backupSavedAt = typeof meta.backupSavedAt === "number" ? meta.backupSavedAt : 0;
                    respond(message.requestId, message.type, origin, {
                        json: storedJson(projectValue),
                        backupJson: storedJson(backupValue),
                        backupNewer: backupSavedAt > projectSavedAt,
                        folder: `director://${projectId}`,
                    });
                    return;
                }

                if (message.type === "PROJECT_SAVE" || message.type === "PROJECT_SAVE_BACKUP") {
                    if (typeof payload.json !== "string") throw new Error("Project JSON is missing.");
                    const metaKey = projectStorageKey(projectId, "meta");
                    const currentMeta = asRecord(await ctx.storage.get<StorageMeta>(metaKey));
                    const now = Date.now();
                    if (message.type === "PROJECT_SAVE") {
                        await ctx.storage.set(projectStorageKey(projectId, "project.json"), payload.json);
                        await ctx.storage.set(metaKey, { ...currentMeta, projectSavedAt: now });
                    } else {
                        await ctx.storage.set(projectStorageKey(projectId, "project.autosave.json"), { json: payload.json, savedAt: now });
                        await ctx.storage.set(metaKey, { ...currentMeta, backupSavedAt: now });
                    }
                    respond(message.requestId, message.type, origin, true);
                    return;
                }

                if (message.type === "PRESETS_LIST") {
                    respond(message.requestId, message.type, origin, []);
                    return;
                }

                if (message.type === "EXPORT_BEGIN") {
                    if (typeof payload.jobId !== "string" || typeof payload.outPath !== "string") throw new Error("Export job is missing jobId or outPath.");
                    if (exportWritebackTimer.current !== null) window.clearTimeout(exportWritebackTimer.current);
                    await exportServiceRequest("/exports", { method: "POST", body: JSON.stringify({ jobId: payload.jobId, outPath: payload.outPath, opts: payload.opts }) });
                    activeExportJobId.current = payload.jobId;
                    respond(message.requestId, message.type, origin, true);
                    return;
                }

                if (message.type === "EXPORT_FRAME") {
                    if (typeof payload.jobId !== "string") throw new Error("Export frame is missing jobId.");
                    const frame = payload.png;
                    if (!(frame instanceof ArrayBuffer) && !ArrayBuffer.isView(frame)) throw new Error("Export frame is not an ArrayBuffer.");
                    await exportServiceRequest(`/exports/${encodeURIComponent(payload.jobId)}/frames`, {
                        method: "POST",
                        headers: { "content-type": "application/octet-stream" },
                        body: exportBody(frame),
                    });
                    respond(message.requestId, message.type, origin, true);
                    return;
                }

                if (message.type === "EXPORT_END") {
                    if (typeof payload.jobId !== "string") throw new Error("Export end is missing jobId.");
                    const result = await exportServiceRequest<{ ok?: boolean; code?: number; log?: string; artifacts?: unknown[] }>(`/exports/${encodeURIComponent(payload.jobId)}/end`, { method: "POST", body: "{}" });
                    iframeRef.current?.contentWindow?.postMessage({
                        protocol: DIRECTOR_PROTOCOL,
                        type: "EXPORT_CLOSED",
                        payload: {
                            jobId: payload.jobId,
                            code: Number(result.code ?? -1),
                            log: String(result.log ?? ""),
                            artifacts: absoluteExportArtifacts(result.artifacts),
                            packageUrl: exportServiceUrl(`/exports/${encodeURIComponent(payload.jobId)}/package.zip`),
                        },
                    }, origin || window.location.origin);
                    if (result.ok === true) scheduleExportWriteback(payload.jobId);
                    respond(message.requestId, message.type, origin, result.ok === true);
                    return;
                }

                if (message.type === "EXPORT_CANCEL") {
                    if (typeof payload.jobId !== "string") throw new Error("Export cancel is missing jobId.");
                    await exportServiceRequest(`/exports/${encodeURIComponent(payload.jobId)}/cancel`, { method: "POST", body: "{}" });
                    respond(message.requestId, message.type, origin, true);
                    return;
                }

                if (message.type === "EXPORT_WRITE_FILE") {
                    if (typeof payload.path !== "string") throw new Error("Export file is missing path.");
                    await exportServiceRequest("/files", {
                        method: "PUT",
                        headers: {
                            "content-type": artifactMime(payload.path),
                            "x-job-id": activeExportJobId.current || "",
                            "x-artifact-path": payload.path,
                        },
                        body: exportBody(payload.data),
                    });
                    respond(message.requestId, message.type, origin, true);
                    return;
                }

                if (message.type === "EXPORT_CONCAT") {
                    const result = await exportServiceRequest<{ ok?: boolean; error?: string }>("/concat", {
                        method: "POST",
                        body: JSON.stringify({ jobId: activeExportJobId.current, outPath: payload.outPath, inputPaths: payload.inputPaths }),
                    });
                    respond(message.requestId, message.type, origin, { ok: result.ok === true, error: result.error });
                    return;
                }

                respond(message.requestId, message.type, origin, { ok: false, error: `${message.type} is not available in Director Workspace.` });
            } catch (error) {
                respond(message.requestId, message.type, origin, undefined, error);
            }
        };

        const onMessage = (event: MessageEvent<unknown>) => {
            if (event.source !== iframeRef.current?.contentWindow || !isDirectorMessage(event.data)) return;
            if (event.data.type === "AGENT_RESULT") {
                const value = asRecord(event.data.payload);
                const id = typeof value.id === "string" ? value.id : "";
                const pending = pendingAgentCalls.current.get(id);
                if (!pending) return;
                window.clearTimeout(pending.timer);
                pendingAgentCalls.current.delete(id);
                const result = asRecord(value.result);
                if (result.ok === true) pending.resolve(result.data);
                else pending.reject(new Error(typeof result.error === "string" ? result.error : "Director Agent Action failed."));
                return;
            }
            if (event.data.type === "READY") {
                iframeRef.current?.contentWindow?.postMessage(
                    {
                        protocol: DIRECTOR_PROTOCOL,
                        type: "INIT",
                        payload: { nodeId: ctx.node.id, projectId, projectName, upstream },
                    },
                    event.origin,
                );
            } else if (event.data.type === "PROJECT_SUMMARY_UPDATE") {
                const summary = asRecord(event.data.payload);
                const patch = {
                    ...(typeof summary.sceneName === "string" ? { scene: summary.sceneName } : {}),
                    ...(typeof summary.shotName === "string" ? { shot: summary.shotName } : {}),
                    ...(typeof summary.duration === "number" ? { duration: summary.duration } : {}),
                    ...(typeof summary.fps === "number" ? { fps: summary.fps } : {}),
                    ...(typeof summary.focalLength === "number" ? { focalLength: summary.focalLength } : {}),
                    ...(typeof summary.entityCount === "number" ? { entityCount: summary.entityCount } : {}),
                };
                if (Object.keys(patch).length) ctx.updateMetadata(patch);
            } else if (event.data.type === "THUMBNAIL_UPDATE") {
                void arrayBufferDataUrl(asRecord(event.data.payload).png).then((thumbnail) => ctx.updateMetadata({ thumbnail })).catch((error) => console.warn("[director] thumbnail update failed", error));
            } else if (event.data.type === "CLOSE") {
                onClose();
            } else if (event.data.requestId) {
                void handleRequest(event.data, event.origin);
            }
        };
        const invokeAgentAction: DirectorAgentCall = (action, params) => new Promise((resolve, reject) => {
            const id = `director-agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const timer = window.setTimeout(() => {
                pendingAgentCalls.current.delete(id);
                reject(new Error(`Director Agent Action timed out: ${action}`));
            }, 30_000);
            pendingAgentCalls.current.set(id, { resolve, reject, timer });
            iframeRef.current?.contentWindow?.postMessage({ protocol: DIRECTOR_PROTOCOL, type: "AGENT_CALL", payload: { id, action, params } }, window.location.origin);
        });
        directorAgentCalls.set(ctx.node.id, invokeAgentAction);
        window.addEventListener("message", onMessage);
        return () => {
            window.removeEventListener("message", onMessage);
            if (exportWritebackTimer.current !== null) window.clearTimeout(exportWritebackTimer.current);
            directorAgentCalls.delete(ctx.node.id);
            pendingAgentCalls.current.forEach((pending) => {
                window.clearTimeout(pending.timer);
                pending.reject(new Error("Director Workspace closed."));
            });
            pendingAgentCalls.current.clear();
        };
    }, [ctx.node.id, ctx.storage, onClose, projectId, projectName]);

    return (
        <div style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column", background: "#111113", color: ctx.theme.node.text }}>
            <iframe ref={iframeRef} title="Blockout Web" src={blockoutWebUrl} style={{ minHeight: 0, width: "100%", flex: 1, border: 0, background: "#111113" }} />
        </div>
    );
}

export default definePlugin({
    id: "director",
    name: "Director 导演台",
    version: "0.1.0",
    description: "Infinite Canvas Director 节点壳，加载 Blockout Web 并通过 Embed Bridge 初始化。",
    nodes: [
        {
            type: "director:blockout",
            title: "Director 导演台",
            icon: "🎬",
            description: "打开全屏 Director Workspace",
            defaultSize: { width: 360, height: 240 },
            defaultMetadata: {
                blockoutProjectId: "",
                projectName: "Untitled Director",
                scene: "Scene 01",
                shot: "Shot 01",
                duration: 5,
                fps: 24,
                focalLength: 35,
                entityCount: 0,
            },
            minimapColor: "#f97316",
            hidePanel: true,
            Content: DirectorContent,
            Workspace: DirectorWorkspace,
            agent: {
                listActions: async () => DIRECTOR_AGENT_ACTIONS,
                call: async (ctx, action, params) => {
                    const invoke = directorAgentCalls.get(ctx.node.id);
                    if (!invoke) throw new Error("请先打开 Director Workspace，再调用 Blockout Agent Action。");
                    return await invoke(action, params);
                },
            },
        },
    ],
});
