// 插件公共契约。画布、模型与插件公共类型引用 shared。
import type { AnchorHTMLAttributes, ComponentType, ReactElement, ReactNode } from "react";
import type { ModelCapability, ModelOption } from "@infinite-canvas/shared/models";
import type { PluginJsonValue, PluginStorage } from "@infinite-canvas/shared/plugins";
import type { ModelCallStarted, ModelCallFinished } from "@infinite-canvas/shared/model-calls";
import type { ReadonlySnapshot } from "./readonly-snapshot";
import type { CapabilityCallContext, CapabilityHandle, PluginCapabilities, PluginDeclarations, PluginExtensions, ScopeBinding } from "./runtime/contracts";
import type { Command, PluginCommands } from "./commands";
import type { CanvasSelection, CanvasViewport, CanvasSnapshot, CanvasSession, CanvasSessionEvents, CanvasTransactionOptions } from "./canvas";
import type { CanvasDocumentOp } from "@infinite-canvas/shared/canvas/ops/apply";
export type { Command, CommandContext, PluginCommand, PluginCommands } from "./commands";
/** 工具名称来自贡献 ID，输入、公开输出和执行范围由目标命令声明。 */
export type PluginAgentTool<I = unknown, O = unknown> = { description: string; command: Command<I, O>; /** 只读取数据、不修改画布。 */ readOnly?: boolean };
export type { CanvasChangeSource, CanvasSelection, CanvasViewport, CanvasClipboardFragment, CanvasSnapshot, CanvasSessionEvents, CanvasSession, CanvasSessionCapability, CanvasTransactionOptions } from "./canvas";
export type { ReadonlySnapshot } from "./readonly-snapshot";
export type { ModelCallKind, ModelCallStarted, ModelCallFinished, ModelCallUpstream, ModelCallUsage } from "@infinite-canvas/shared/model-calls";
export type { ModelCapability, ModelOption } from "@infinite-canvas/shared/models";
export type { PluginJsonValue, PluginProjectDomainDeclaration, PluginStorage } from "@infinite-canvas/shared/plugins";
export type { PluginProjectDomainRecord, PluginProjectResource } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { Position, CanvasNodeType, CanvasNodeTypeId, CanvasNodeData, CanvasNodeMetadata, CanvasConnection, CanvasNodeStatus, CanvasGenerationMode, CanvasImageGenerationType } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { Viewport as ViewportTransform } from "@infinite-canvas/shared/canvas/tools/types";
export type { Position, CanvasNodeTypeId, CanvasNodeData, CanvasNodeMetadata, CanvasConnection, CanvasNodeStatus, CanvasGenerationMode, CanvasImageGenerationType, CanvasDocumentOp, ViewportTransform };
export type CanvasBuiltinNodeType = `${CanvasNodeType}`;
export type ReadonlyCanvasNode = ReadonlySnapshot<CanvasNodeData>;
export type ReadonlyCanvasConnection = ReadonlySnapshot<CanvasConnection>;

// ---------------------------------------------------------------------------
// 主题 token(用来让插件 UI 跟随画布明暗主题)
// ---------------------------------------------------------------------------

export type CanvasTheme = ReadonlySnapshot<{
    canvas: {
        background: string;
        dot: string;
        line: string;
        selectionStroke: string;
        selectionFill: string;
    };
    node: {
        label: string;
        fill: string;
        panel: string;
        stroke: string;
        activeStroke: string;
        placeholder: string;
        text: string;
        muted: string;
        faint: string;
    };
    toolbar: {
        panel: string;
        border: string;
        item: string;
        itemHover: string;
        activeBg: string;
        activeText: string;
    };
}>;

// ---------------------------------------------------------------------------
// 资源:插件节点作为上游输入被消费时输出什么(接入生成/引用体系)
// ---------------------------------------------------------------------------

export type CanvasResourceKind = "image" | "video" | "audio" | "text";
export type CanvasNodeResource = { kind: CanvasResourceKind; text?: string; url?: string; storageKey?: string };
export type NodeResourceContribution = { resolve(node: ReadonlyCanvasNode, slotId?: string): CanvasNodeResource | null };
export type CanvasAssetInput =
    | { kind: "text"; title: string; content: string }
    | { kind: "image"; title: string; url?: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string }
    | { kind: "video"; title: string; url?: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string }
    | { kind: "audio"; title: string; url?: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string };

// ---------------------------------------------------------------------------
// AI 生成:插件直接复用宿主的模型/密钥配置发起生成(生图/生视频/生文本/生音频)
//
// 插件本身拿不到 API Key 与模型配置,这些能力由宿主注入。前置/系统提示词由
// 插件自行拼进 prompt(宿主不感知),因此不同插件可各自定制自己的提示词策略。
// 若宿主 AI 配置未就绪,会抛错(并由宿主提示用户去配置),插件用 try/catch 处理即可。
// ---------------------------------------------------------------------------

// 生成公共可选项;references 为图生图/图生视频的参考图(dataURL 或可访问 URL)
export type ModelGenerationInput = {
    prompt: string;
    signal?: AbortSignal;
    references?: string[];
    model?: string; // 指定模型，使用 models.listModels 返回的 value。
};

export type GenerateImageInput = ModelGenerationInput & {
    count?: number; // 期望生成张数(宿主会按模型上限裁剪)
    size?: string; // 形如 "1024x1024" / "auto";缺省用宿主当前配置
};

export type GenerateImageResult = {
    // 生成图的 dataURL(已可直接作为 <img src> 或 three 纹理使用)
    images: string[];
};

export type GenerateVideoInput = ModelGenerationInput & {
    size?: string;
    seconds?: string;
};

export type GenerateVideoResult = {
    /** 已保存的视频使用 storageKey；外部视频使用 url。 */
    storageKey?: string;
    url?: string;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
};

/** 在发起任务的作者与目标范围内查询，可由插件保存以便重开。 */
export type PluginTaskHandle = { token: string; workId?: string };
export type SubmitVideoInput = GenerateVideoInput & { workId?: string };
export type SubmitVideoResult = { kind: "accepted"; handle: PluginTaskHandle } | { kind: "completed"; result: GenerateVideoResult };
export type PluginVideoTaskState = { status: "pending" | "paused" | "failed" | "cancelled" | "interrupted" } | { status: "completed"; result: GenerateVideoResult };
export type TasksCapability = {
    read: (handle: PluginTaskHandle, context: CapabilityCallContext) => Promise<PluginVideoTaskState>;
};

export type GenerateTextInput = {
    prompt: string;
    signal?: AbortSignal;
    model?: string;
    system?: string; // 附加系统提示词(拼在宿主系统提示之后)
    onDelta?: (text: string) => void; // 流式增量回调
};

export type GenerateTextResult = {
    text: string;
};

/** 工作区模型服务；取消信号来自取得能力时的作用域绑定。 */
export type ModelsCapability = {
    generateImage: (input: GenerateImageInput, context: CapabilityCallContext) => Promise<GenerateImageResult>;
    generateVideo: (input: GenerateVideoInput, context: CapabilityCallContext) => Promise<GenerateVideoResult>;
    submitVideo: (input: SubmitVideoInput, context: CapabilityCallContext) => Promise<SubmitVideoResult>;
    generateText: (input: GenerateTextInput, context: CapabilityCallContext) => Promise<GenerateTextResult>;
    listModels: (input: { capability?: ModelCapability }, context: CapabilityCallContext) => ReadonlySnapshot<ModelOption[]>;
    defaultModel: (input: { capability: ModelCapability }, context: CapabilityCallContext) => string;
};
export type PluginModels = CapabilityHandle<ModelsCapability>;

// ---------------------------------------------------------------------------
// 节点上下文:每个节点渲染时注入,是插件与画布交互的核心接口
// ---------------------------------------------------------------------------

export type CanvasNodeContext = {
    /** 绑定当前节点视图的插件能力与作品数据。 */
    readonly plugin: PluginContext;
    readonly scope: ScopeBinding;
    commands: PluginCommands;
    images: PluginContext["images"];
    media: PluginContext["media"];
    // 自身数据
    node: ReadonlyCanvasNode;
    theme: CanvasTheme;
    scale: number;
    isSelected: boolean; // 该节点当前是否被选中(用于按需启用 iframe 交互等)
    isGenerating: boolean;
    expanded: boolean;
    setExpanded(expanded: boolean): void;
    updateMetadata: (patch: CanvasNodeMetadata, attachments?: { keys: readonly string[]; files: readonly PluginProjectDataFile[] }) => Promise<CanvasSnapshot>;
    updateNode: (patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => Promise<CanvasSnapshot>;
    // 图访问
    getSnapshot: () => CanvasSnapshot;
    subscribe: (listener: () => void) => () => void;
    getNode: (id: string) => ReadonlyCanvasNode | null;
    getNodes: () => readonly ReadonlyCanvasNode[];
    getConnections: () => readonly ReadonlyCanvasConnection[];
    getUpstream: () => readonly ReadonlyCanvasNode[];
    getDownstream: () => readonly ReadonlyCanvasNode[];
    // 原子文档操作
    transact: (ops: CanvasDocumentOp[], options?: CanvasTransactionOptions & { signal?: AbortSignal }) => Promise<CanvasSnapshot>;
    // AI 生成能力(生图/生视频/生文本),复用宿主模型配置
    models: PluginModels;
    // 打开/关闭本节点下方的自定义 Panel(需在节点定义里提供 Panel)
    openPanel: () => void;
    closePanel: () => void;
    // 插件私有持久化,按插件 id 命名空间隔离
    storage: PluginStorage;
};

// ---------------------------------------------------------------------------
// 节点定义:内置节点与插件节点统一走这套结构
// ---------------------------------------------------------------------------

export type CanvasNodeToolbarItem = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void | Promise<void>;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
    defaultVisible?: boolean;
};

export type ResolvedNodeTool = {
    title: string;
    label: string;
    icon: ReactNode;
    /** 点击时执行；可调用 ctx.commands 或 ctx.transact。 */
    run: () => unknown | Promise<unknown>;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
    defaultVisible?: boolean;
};
export type NodeToolContribution = { resolve(ctx: CanvasNodeContext): ResolvedNodeTool | null };

export type VideoFramePosition = "first" | "last" | "current";
export type ImageCropRect = { x: number; y: number; width: number; height: number };
export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";
export type ImageUpscaleParams = { targetLongEdge: number; algorithm: ImageUpscaleAlgorithm };
export type ImageSplitParams = { rows: number; columns: number; horizontalLines?: number[]; verticalLines?: number[] };
export type ImageAngleParams = {
    /**
     * 左右角度。
     */
    horizontalAngle: number;
    /**
     * 俯仰角度。
     */
    pitchAngle: number;
    /**
     * 镜头距离。
     */
    cameraDistance: number;
    /**
     * 是否使用广角镜头。
     */
    wideAngle: boolean;
};
export type ImageMaskEditParams = {
    /**
     * 局部修改要求。
     */
    prompt: string;
    /**
     * 预览图与区域标注合成的图片。
     */
    maskDataUrl: string;
    /**
     * 创建结果节点后是否立即生成。
     */
    generate: boolean;
};

export type CanvasNodeContentProps = { ctx: CanvasNodeContext };
export type CanvasNodePanelProps = { ctx: CanvasNodeContext; onClose: () => void };

// 复用宿主内置生成面板(与图片/视频/文本节点同一个组件:模型选择、参数设置、
// 提示词库、运行/停止状态全部一致)。声明它即可获得完整生成体验,无需自写面板。
export type CanvasBuiltinPanelConfig = {
    mode: ModelCapability; // 生成类型,决定面板里的模型/设置项
    // 提交给模型前自动拼在用户提示词前面的固定前缀(如全景图的 equirectangular 约束)
    promptPrefix?: string;
    // true(默认)时生成结果写回本节点自身 metadata.content;false 则按内置逻辑生成到下游新节点
    writeBackToSelf?: boolean;
    // 固定生成宽高比(如全景图的 "2:1"):面板不再提供宽高比、自定义尺寸与张数,生成时统一使用该比例。
    imageAspectRatio?: string;
};

export type CanvasNodeAppearance = {
    // 节点外壳与内容容器使用主题填充或透明背景。
    background: "fill" | "transparent";
    // 仅控制普通边框，选中和关联描边仍由宿主呈现。
    border: "normal" | "none";
    // 是否呈现节点底部的主题渐变。
    bottomGradient: boolean;
};

export type CanvasNodeDefinition = {
    type: string; // 建议 "<pluginId>:<name>",全局唯一
    title: string;
    icon: ReactNode; // emoji 字符串或任意 ReactNode
    description?: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minimapColor?: string;
    showInCreateMenu?: boolean; // 默认 true
    hasSourceHandle?: boolean; // 右侧输出连接点,默认 true
    hidePanel?: boolean; // 为 true 时:点击/新建不弹出下方面板(含内置生图面板),纯展示型节点用
    // 整体省略时使用主题填充、普通边框与底部渐变；函数同步读取只读节点。
    appearance?: CanvasNodeAppearance | ((node: ReadonlyCanvasNode) => CanvasNodeAppearance);
    contentOverflow?: "hidden" | "visible";
    /** 全屏面板由节点操作显式打开。 */
    panelPresentation?: "fullscreen";
    autoOpenPanel?: boolean; // 为 true 时:单击节点自动打开自定义 Panel(默认仅内置节点单击自动打开)
    // 复用宿主内置生成面板;与自定义 Panel 二选一(同时提供时优先 Panel)
    useBuiltinPanel?: CanvasBuiltinPanelConfig;
    // 为 true 时:宿主自动在工具条加「交互 ⇄ 移动」开关,并按 metadata.interactive 控制内容层指针事件。
    // 默认(interactive 未设/为 false)为「移动」态:内容不吃指针,拖动整块移动节点;
    // 切到「交互」态后内容可点击/拖拽(如全景转视角、iframe 操作)。适合内部有交互的展示型节点。
    interactionToggle?: boolean;
    // 配合 interactionToggle:返回 true 表示当前节点内容「强制可交互」(如编辑态),
    // 此时忽略 interactive 标志、始终允许操作,并隐藏移动/交互开关。缺省视为 false。
    forceInteractive?: (node: ReadonlyCanvasNode) => boolean;
    keepAspectRatio?: (node: ReadonlyCanvasNode) => boolean;
    // 渲染
    Content?: ComponentType<CanvasNodeContentProps>;
    Panel?: ComponentType<CanvasNodePanelProps>; // 节点下方面板(自定义)
    onDoubleClick?: (ctx: CanvasNodeContext) => boolean; // 返回 true 表示已处理
};

// ---------------------------------------------------------------------------
// 插件运行时与插件包
// ---------------------------------------------------------------------------

/**
 * 画布宿主内部能力；公开给插件的项目能力由作用域绑定。
 */
export type CanvasPluginHost = {
    canvas: CanvasSession;
    isGenerating(nodeId: string): boolean;
    isExpanded(nodeId: string): boolean;
    setExpanded(nodeId: string, expanded: boolean): void;
    getUpstream: (nodeId: string) => readonly ReadonlyCanvasNode[];
    getDownstream: (nodeId: string) => readonly ReadonlyCanvasNode[];
    openPanel: (nodeId: string) => void;
    closePanel: (nodeId: string) => void;
};

export type PluginCanvas = {
    readonly scope: ScopeBinding;
    /**
     * 仅订阅当前画布；切换项目或停用插件时自动注销。
     */
    on: <K extends keyof PluginCanvasEvents>(event: K, handler: (payload: PluginCanvasEvents[K]) => void | Promise<void>) => () => void;
    projectId: string;
    /**
     * 项目退出或插件停用时中止。
     */
    signal: AbortSignal;
    getSnapshot: () => CanvasSnapshot;
    subscribe: (listener: () => void) => () => void;
    getNodes: () => readonly ReadonlyCanvasNode[];
    getConnections: () => readonly ReadonlyCanvasConnection[];
    getSelectedIds: () => readonly string[];
    transact: (ops: CanvasDocumentOp[], options?: CanvasTransactionOptions & { signal?: AbortSignal }) => Promise<CanvasSnapshot>;
    undo: () => CanvasSnapshot;
    redo: () => CanvasSnapshot;
    setSelection: (selection: CanvasSelection) => void;
    setViewport: (viewport: CanvasViewport) => void;
    flush: () => Promise<void>;
    models: PluginModels;
};

export type PluginCanvasEvents = CanvasSessionEvents & {
    "result.applied": { projectId: string; kind: "image" | "video" | "text" | "audio"; nodeIds: readonly string[]; taskId?: string };
};

export type PluginEvents = PluginCanvasEvents & {
    "model.call.started": ModelCallStarted;
    "model.call.finished": ModelCallFinished;
};

/**
 * 主题插件使用的全局语义配色。
 */
export type PluginAppearance = {
    /** 使用宿主原始配色，仅切换亮暗模式。 */
    useDefaultColors?: boolean;
    /** 完整主题贡献 ID，必须与 themes 登记 ID 一致。 */
    id: string;
    /** 外观设置里显示的名称与说明；预览取下方配色。 */
    name: string;
    description: string;
    mode: "light" | "dark";
    background: string;
    panel: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentText: string;
    /** 单独覆盖画布、节点与工具栏的颜色。 */
    canvasTheme?: { [K in keyof CanvasTheme]?: Partial<CanvasTheme[K]> };
};

export type PluginNavigationEntry = {
    /** 内置页面使用产品 slug，插件页面使用命名空间 ID。 */
    id: string;
    title: string;
};

export type PluginNavigationItem = PluginNavigationEntry & {
    /** 仅隐藏导航入口，保留实际页面路由与配置目录。 */
    hidden?: boolean;
};

export type PluginNavigation = {
    /** 同步返回完整目录，每个原 ID 保留一次，可调整顺序、标题和显隐。 */
    transform: (props: { ctx: PluginContext; items: readonly Readonly<PluginNavigationItem>[] }) => PluginNavigationItem[];
};

export type PluginPageProps = {
    ctx: PluginContext;
    /** 全部主导航入口，包括已隐藏的入口，可用于配置界面。 */
    navigation: readonly PluginNavigationEntry[];
};

export type PluginPage = {
    id: string;
    title: string;
    icon?: ReactNode;
    /** 为 true 时进入主导航；否则只能通过链接访问。 */
    navigation?: boolean;
    Content: ComponentType<PluginPageProps>;
};

export type PluginApplicationAction = { id: string; title: string; hidden?: boolean } & (
    | { type: "action"; icon?: ReactNode; disabled?: boolean; run: () => unknown }
    | { type: "route"; icon?: ReactNode; to: string }
    | { type: "external"; icon?: ReactNode; href: string }
    | { type: "content"; content: ReactElement }
);

export type PluginApplicationActionsTarget = {
    region: "status" | "canvas-leading";
    variant: "default" | "canvas";
    showConfig: boolean;
    /** 画布入口明确提供原项目作用域；操作区 ctx 本身仍为无项目视图。 */
    canvasScope?: ScopeBinding;
};

export type PluginApplicationActions = {
    transform: (props: { ctx: PluginContext; target: Readonly<PluginApplicationActionsTarget>; items: readonly Readonly<PluginApplicationAction>[] }) => PluginApplicationAction[];
};

export type PluginLayoutProps = {
    ctx: PluginContext;
    /** 可见入口，包含当前页状态和已渲染的标签。 */
    items: ReadonlyArray<PluginNavigationEntry & { to: string; active: boolean; label: ReactNode }>;
    /** 站内链接，保留单页跳转和浏览器链接行为。 */
    Link: ComponentType<Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string }>;
    brand: ReactNode;
    actions: ReactNode;
    /** 宿主响应式主导航，可供窄屏布局复用。 */
    navigation: ReactNode;
    /** 当前路由页面。 */
    children: ReactNode;
};

export type PluginLayout = {
    id: string;
    /** 外观设置里显示的名称与说明。 */
    name: string;
    description: string;
    Frame: ComponentType<PluginLayoutProps>;
};

export type PluginSyncProgress = {
    domain?: string;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type SyncTransport = {
    read(path: string, signal?: AbortSignal): Promise<Blob | null>;
    write(path: string, file: Blob, contentType: string, signal?: AbortSignal): Promise<void>;
    readManifest(path: string, signal?: AbortSignal): Promise<{ blob: Blob; revision: string } | null>;
    publishManifest(path: string, blob: Blob, expected: string | null, signal?: AbortSignal): Promise<void>;
};

type SyncTransportContext = {
    readonly url: string;
    readonly directory: readonly string[];
    readonly values: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
};
export type SyncTransportProbe = SyncTransportContext & {
    probe(path: readonly string[], method: "GET" | "HEAD" | "OPTIONS" | "MKCOL" | "PROPFIND", headers?: HeadersInit, signal?: AbortSignal): Promise<number>;
};
export type SyncTransportSession = SyncTransportContext & {
    request(path: readonly string[], init: RequestInit): Promise<Response>;
};
export type PluginSyncTransport = {
    title: string;
    defaultDirectory?: string;
    fields: { key: string; title: string; secret?: boolean }[];
    test(context: SyncTransportProbe): Promise<void>;
    open(context: SyncTransportSession): SyncTransport | Promise<SyncTransport>;
};
export type PluginProjectDataFile = { key: string; file: Blob };
/** 可随业务 JSON 保存；只能在同一作品、作者与文件版本下读取。 */
export type PluginResourceRef = Readonly<{ kind: "canvas" | "work"; id: string; domain: string; dataVersion: number; slot: string; revision: string }>;
export type ResourcesCapability = {
    read(ref: PluginResourceRef, context: CapabilityCallContext): Promise<Blob>;
};
export type PluginProjectDataSnapshot<T> = { value: T; resources: readonly PluginResourceRef[] };
/** 项目由当前视图绑定；域必须由本插件声明，文件按域内槽位访问。 */
export type PluginProjectData = {
    read<T>(domain: string): Promise<PluginProjectDataSnapshot<T> | null>;
    save<T>(domain: string, value: T, slots: readonly string[], files: readonly PluginProjectDataFile[]): Promise<void>;
};
export type PluginWorkInfo = { workId: string; title: string };
export type PluginWorks = {
    list(): Promise<PluginWorkInfo[]>;
    create(workId: string, title: string): Promise<PluginWorkInfo>;
    open(workId: string, signal: AbortSignal): Promise<PluginProjectData>;
    export(workIds: readonly string[], signal: AbortSignal): Promise<Blob>;
    import(file: Blob, signal: AbortSignal): Promise<PluginWorkInfo[]>;
    copy(workId: string, title: string, signal: AbortSignal): Promise<PluginWorkInfo>;
};

export type PluginContext = {
    readonly scope: ScopeBinding;
    projectData: PluginProjectData;
    works: PluginWorks;
    extensions: PluginExtensions;
    capabilities: PluginCapabilities;
    commands: PluginCommands;
    models: PluginModels;
    /** 文件与插件业务记录分别保存，键只在当前插件内有效。 */
    files: {
        read(key: string): Promise<Blob | null>;
        write(key: string, file: Blob): Promise<void>;
        remove(key: string): Promise<void>;
    };
    images: {
        store(file: Blob, signal: AbortSignal): Promise<{ url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string }>;
        /** 只读取已有预览缓存；缺失返回 null，不自动读取原图。 */
        preview(storageKey: string, signal: AbortSignal): Promise<Blob | null>;
        read(storageKey: string | undefined, url: string | undefined, signal: AbortSignal): Promise<Blob>;
    };
    media: {
        read(storageKey: string | undefined, url: string | undefined, signal: AbortSignal): Promise<Blob>;
    };
    id: string;
    signal: AbortSignal;
    layout: {
        /** 选择任意已登记的布局；null 恢复基础外壳。 */
        select: (id: string | null) => void;
    };
    appearance: {
        /**
         * 选择任意已登记的主题；null 恢复基础明暗模式。
         */
        select: (id: string | null) => void;
        getSnapshot: () => PluginAppearance | null;
        subscribe: (listener: () => void) => () => void;
    };
    storage: PluginStorage;
    canvas: () => PluginCanvas;
    onDispose: (cleanup: () => void | Promise<void>) => () => Promise<void>;
    on: <K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void | Promise<void>) => () => void;
    emit: (event: string, payload: unknown) => void;
    onMessage: (event: string, handler: (payload: unknown) => void | Promise<void>) => () => void;
};

/**
 * 创建菜单使用画布坐标，右键菜单使用屏幕坐标；目标与当前选区分开提供。
 */
export type PluginMenuTarget =
    | { location: "canvas.projectMenu" | "canvas.toolbar" | "canvas.extensions" | "canvas.zoomControls" }
    | { location: "canvas.nodeToolbar"; nodeId: string }
    | { location: "canvas.selectionToolbar"; nodeIds: string[] }
    | { location: "canvas.create"; position: Position; /** 为 true 时列出插件提供的扩展节点（二级菜单）。 */ extensions?: boolean }
    | { location: "canvas.connectionCreate"; position: Position; nodeId: string; handleType: "source" | "target" }
    | { location: "canvas.nodeContext"; position: Position; nodeId: string }
    | { location: "canvas.connectionContext"; position: Position; connectionId: string };

export type PluginMenuItem = {
    /**
     * 同一菜单内唯一，插件新增项使用自己的命名空间。
     */
    id: string;
    /**
     * 隐藏只影响菜单入口，不删除对应节点类型或命令。
     */
    hidden?: boolean;
} & ({
    /**
     * 可执行菜单项。
     */
    type: "action";
    /**
     * 面向用户的名称。
     */
    title: string;
    /**
     * 可选图标，默认使用通用拼图图标。
     */
    icon?: ReactNode;
    /**
     * 名称下方的补充说明。
     */
    description?: string;
    /**
     * 悬停提示，未提供时显示名称。
     */
    tooltip?: string;
    /**
     * 菜单右侧的快捷键说明。
     */
    shortcut?: string;
    /**
     * 工具栏按钮的选中状态。
     */
    active?: boolean;
    /**
     * 是否在工具栏图标旁显示名称，未指定时沿用所在工具栏偏好。
     */
    showLabel?: boolean;
    /**
     * 保留入口但不允许执行。
     */
    disabled?: boolean;
    /**
     * 使用危险操作颜色。
     */
    danger?: boolean;
    /**
     * 绑定打开菜单时的画布；异步操作保留该绑定。
     */
    run: () => unknown | Promise<unknown>;
} | {
    /**
     * 分隔线，没有执行动作。
     */
    type: "separator";
} | {
    /** 实际挂载的控件，由宿主提供独立视图上下文；隐藏或卸载时取消。 */
    type: "content";
    title: string;
    Content: ComponentType<PluginMenuItemContentProps>;
});

export type PluginMenuProps = {
    /**
     * 当前菜单扩展所属插件。
     */
    ctx: PluginContext;
    /**
     * 发起菜单的画布，不能在异步完成后重新获取当前画布。
     */
    canvas: PluginCanvas;
    /**
     * 菜单位置与右键目标。
     */
    target: PluginMenuTarget;
    /**
     * transform 收到全部项（含隐藏项）；Content 收到最终可见项。
     */
    items: readonly Readonly<PluginMenuItem>[];
};

export type PluginMenuItemContentProps = Pick<PluginMenuProps, "ctx" | "canvas" | "target"> & { theme: CanvasTheme };

export type PluginMenu = {
    /**
     * 贡献 ID；多个扩展按内置、插件 ID、登记顺序执行。
     */
    id: string;
    /**
     * 此扩展作用的菜单。
     */
    locations: PluginMenuTarget["location"][];
    /**
     * 同步纯函数；返回新列表，可插入、隐藏、重排或替换任意项。
     */
    transform: (props: PluginMenuProps) => readonly PluginMenuItem[];
};

export type PluginPanel = {
    presentation?: "workspace";
    id: string;
    title: string;
    Content: ComponentType<{ ctx: PluginContext; canvas: PluginCanvas; onClose: () => void }>;
};

export type PluginSettings = {
    id: string;
    title: string;
    /** 显示在「设置 → 插件 → 插件详情」中，多个设置即多个标签。 */
    Content: ComponentType<{ ctx: PluginContext }>;
};

export type CanvasSideTabView = {
    getCenter(): Position;
    focusNode(nodeId: string): Promise<void>;
    setHoverNode(nodeId: string | null): void;
};

export type PluginCanvasSideTab = {
    title: string;
    icon?: ReactNode;
    hidden?: boolean;
    Content: ComponentType<{ ctx: PluginContext; view: CanvasSideTabView }>;
};

/**
 * 客户端代码登记全部贡献，并声明设置页显示的名称与说明；插件 id 是插件目录名，入口与图标等按目录约定查找。
 */
export type CanvasPlugin = PluginDeclarations & {
    css?: string;
    setup?: (ctx: PluginContext) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
};

