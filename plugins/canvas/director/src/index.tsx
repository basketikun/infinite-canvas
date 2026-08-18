import { definePlugin, useEffect, useRef } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeWorkspaceProps, CanvasTheme, CanvasUpstreamResource, PluginAgentAction } from "@infinite-canvas/plugin-sdk";

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

function metadataText(ctx: DirectorContext, key: string, fallback: string) {
    const value = ctx.node.metadata?.[key];
    return typeof value === "string" && value.trim() ? value : fallback;
}

function metadataNumber(ctx: DirectorContext, key: string, fallback: number) {
    const value = ctx.node.metadata?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const directorNodeCss = `
.director-node-shell {
    position: relative;
    overflow: hidden;
    border: 1px solid transparent;
    transition: border-color 160ms ease, background 160ms ease;
}
.director-node-shell:hover {
    border-color: color-mix(in srgb, currentColor 18%, transparent);
}
.director-node-header {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 8px;
    min-height: 20px;
}
.director-node-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
}
.director-node-badge {
    flex: 0 0 auto;
    padding: 3px 6px 2px;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    line-height: 1;
    opacity: 0.65;
}
.director-node-preview {
    position: relative;
    display: block;
    min-height: 0;
    width: 100%;
    flex: 1;
    overflow: hidden;
    border: 0;
    border-radius: 8px;
    padding: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
}
.director-node-preview img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.director-node-preview:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: -2px;
}
.director-node-overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(12, 12, 12, 0.42);
    color: #fff;
    opacity: 0;
    transition: opacity 160ms ease;
}
.director-node-preview:hover .director-node-overlay,
.director-node-preview:focus-visible .director-node-overlay {
    opacity: 1;
}
.director-node-overlay-label {
    border: 1px solid rgba(255, 255, 255, 0.34);
    border-radius: 999px;
    background: rgba(18, 18, 18, 0.52);
    padding: 7px 11px;
    font-size: 11px;
    font-weight: 650;
    backdrop-filter: blur(10px);
}
.director-node-placeholder {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 90px;
    place-items: center;
    overflow: hidden;
}
.director-node-placeholder::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(165deg, transparent 48%, currentColor 49%, transparent 50%), linear-gradient(15deg, transparent 48%, currentColor 49%, transparent 50%);
    opacity: 0.08;
}
.director-node-placeholder-horizon {
    position: absolute;
    left: 10%;
    right: 10%;
    bottom: 24%;
    height: 1px;
    background: currentColor;
    opacity: 0.24;
}
.director-node-placeholder-cube {
    position: relative;
    width: 34px;
    height: 28px;
    border: 1px solid currentColor;
    transform: perspective(90px) rotateX(20deg) rotateZ(45deg);
    opacity: 0.42;
}
.director-node-placeholder-camera {
    position: absolute;
    right: 18%;
    bottom: 20%;
    width: 18px;
    height: 10px;
    border: 1px solid currentColor;
    border-radius: 2px;
    opacity: 0.52;
}
.director-node-placeholder-camera::before {
    content: "";
    position: absolute;
    left: -7px;
    top: 2px;
    width: 7px;
    height: 5px;
    border: 1px solid currentColor;
    border-right: 0;
}
.director-node-placeholder-label {
    position: absolute;
    bottom: 10px;
    left: 12px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    opacity: 0.42;
}
.director-node-footer {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: center;
    gap: 8px;
    color: currentColor;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    opacity: 0.66;
}
.director-node-stat {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.director-node-stat:nth-child(2) { text-align: center; }
.director-node-stat:nth-child(3) { text-align: right; }
.director-node-reference {
    position: absolute;
    right: 10px;
    bottom: 39px;
    display: grid;
    width: 18px;
    height: 18px;
    place-items: center;
    border: 1px solid currentColor;
    border-radius: 50%;
    background: color-mix(in srgb, currentColor 8%, transparent);
    font-size: 9px;
    opacity: 0.68;
}
`;

function DirectorContent({ ctx }: CanvasNodeContentProps) {
    const shot = metadataText(ctx, "shot", metadataText(ctx, "projectName", "镜头 01"));
    const duration = metadataNumber(ctx, "duration", 5);
    const focalLength = metadataNumber(ctx, "focalLength", 35);
    const entityCount = metadataNumber(ctx, "entityCount", 0);
    const thumbnail = metadataText(ctx, "thumbnail", "");
    const upstreamCount = ctx.getUpstreamResources().length;

    return (
        <div
            className="director-node-shell"
            data-canvas-no-zoom
            style={{ display: "flex", height: "100%", width: "100%", flexDirection: "column", gap: 8, padding: 10, boxSizing: "border-box", color: ctx.theme.node.text, background: ctx.theme.node.panel }}
        >
            <div className="director-node-header">
                <span className="director-node-title" title={shot}>{shot}</span>
                <span className="director-node-badge">3D</span>
            </div>
            <div
                className="director-node-preview"
                style={{ background: ctx.theme.node.fill, color: ctx.theme.node.muted }}
            >
                {thumbnail ? (
                    <img src={thumbnail} alt={`${shot} 3D 场景预览`} />
                ) : (
                    <div className="director-node-placeholder">
                        <span className="director-node-placeholder-horizon" />
                        <span className="director-node-placeholder-cube" />
                        <span className="director-node-placeholder-camera" />
                        <span className="director-node-placeholder-label">3D SCENE</span>
                    </div>
                )}
                <span
                    className="director-node-overlay"
                    role="button"
                    tabIndex={0}
                    aria-label="进入 3D 导演台"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => ctx.openWorkspace()}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") ctx.openWorkspace();
                    }}
                >
                    <span className="director-node-overlay-label">进入 3D 导演台</span>
                </span>
            </div>
            <div className="director-node-footer">
                <span className="director-node-stat">{duration}s</span>
                <span className="director-node-stat">{focalLength}mm</span>
                <span className="director-node-stat">{entityCount} 对象</span>
            </div>
            {upstreamCount > 0 ? <span className="director-node-reference" title={`${upstreamCount} 个参考素材`}>⌕{upstreamCount}</span> : null}
        </div>
    );
}

const DIRECTOR_PROTOCOL = "infinite-canvas-director-v1";

function blockoutThemePayload(theme: CanvasTheme) {
    return {
        mode: theme.canvas.background === "#181715" ? "dark" : "light",
        theme,
    } as const;
}

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

function arrayBufferValue(value: unknown): ArrayBuffer | null {
    if (value instanceof ArrayBuffer) return value;
    if (!ArrayBuffer.isView(value)) return null;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return bytes.slice().buffer;
}

function safeFileName(value: string, fallback: string): string {
    const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
    return normalized || fallback;
}

function fileStem(value: string): string {
    return value.replace(/\.[^.]+$/, "") || value;
}

function importedFileLocation(kind: string, fileName: string): { relativePath: string; directory: string } {
    const directory = kind === "scan" ? "scans" : kind === "reference" ? "refs" : "assets";
    const uniqueName = `${Date.now().toString(36)}-${safeFileName(fileName, "imported-file")}`;
    return { directory, relativePath: `${directory}/${uniqueName}` };
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
        iframeRef.current?.contentWindow?.postMessage(
            {
                protocol: DIRECTOR_PROTOCOL,
                type: "THEME_UPDATE",
                payload: { locale: ctx.locale, theme: blockoutThemePayload(ctx.theme) },
            },
            window.location.origin,
        );
    }, [ctx.locale, ctx.theme]);

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

                if (message.type === "FILE_IMPORT") {
                    const kind = typeof payload.kind === "string" ? payload.kind : "asset";
                    if (kind !== "asset" && kind !== "scan" && kind !== "reference") throw new Error("Unsupported imported file kind.");
                    const fileName = safeFileName(typeof payload.fileName === "string" ? payload.fileName : "imported-file", "imported-file");
                    const data = arrayBufferValue(payload.data);
                    if (!data) throw new Error("The selected file could not be read in the browser.");
                    const location = importedFileLocation(kind, fileName);
                    await ctx.storage.set(projectStorageKey(projectId, `files/${location.relativePath}`), data);
                    respond(message.requestId, message.type, origin, { relativePath: location.relativePath, name: fileStem(fileName) });
                    return;
                }

                if (message.type === "FILE_READ") {
                    const relativePath = typeof payload.relativePath === "string" ? payload.relativePath.replace(/\\/g, "/").replace(/^\/+/, "") : "";
                    if (!relativePath || relativePath.split("/").some((part) => part === "..")) throw new Error("Invalid project file path.");
                    const stored = await ctx.storage.get(projectStorageKey(projectId, `files/${relativePath}`));
                    const data = arrayBufferValue(stored);
                    if (!data) throw new Error(`Project file not found: ${relativePath}`);
                    respond(message.requestId, message.type, origin, data);
                    return;
                }

                if (message.type === "EXPORT_STILL_TO_CANVAS") {
                    const data = arrayBufferValue(payload.png);
                    if (!data) throw new Error("Exported frame is empty.");
                    const dataUrl = await arrayBufferDataUrl(data);
                    const sourceNode = ctxRef.current.getNode(ctx.node.id);
                    const sourceWidth = Math.max(320, Math.min(560, sourceNode?.width ?? 360));
                    const sourceHeight = Math.max(220, sourceNode?.height ?? 240);
                    const frameWidth = Number(payload.width) > 0 ? Number(payload.width) : 16;
                    const frameHeight = Number(payload.height) > 0 ? Number(payload.height) : 9;
                    const frameHeightOnCanvas = Math.max(220, Math.round(sourceWidth * frameHeight / frameWidth));
                    const baseX = (sourceNode?.position.x ?? 0) + (sourceNode?.width ?? 360) + 80;
                    const baseY = sourceNode?.position.y ?? 0;
                    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : "导演台当前帧";
                    const id = `${ctx.node.id}-frame-${Date.now().toString(36)}`;
                    ctxRef.current.applyOps([
                        {
                            type: "add_node",
                            id,
                            nodeType: "image",
                            title,
                            position: { x: baseX, y: baseY + sourceHeight + 40 },
                            width: sourceWidth,
                            height: frameHeightOnCanvas,
                            metadata: {
                                content: dataUrl,
                                status: "success",
                                mimeType: "image/png",
                                source: "director:current-frame",
                                directorShotTime: Number(payload.time) || 0,
                            },
                        },
                        { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
                    ]);
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
                        payload: { nodeId: ctx.node.id, projectId, projectName, upstream, locale: ctx.locale, theme: blockoutThemePayload(ctx.theme) },
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
    }, [ctx.locale, ctx.node.id, ctx.storage, ctx.theme, onClose, projectId, projectName]);

    return (
        <div style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column", background: ctx.theme.canvas.background, color: ctx.theme.node.text }}>
            <iframe ref={iframeRef} title="Blockout Web" src={blockoutWebUrl} style={{ minHeight: 0, width: "100%", flex: 1, border: 0, background: ctx.theme.canvas.background }} />
        </div>
    );
}

export default definePlugin({
    id: "director",
    name: "Director 导演台",
    version: "0.1.0",
    description: "Infinite Canvas Director 节点壳，加载 Blockout Web 并通过 Embed Bridge 初始化。",
    css: directorNodeCss,
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
