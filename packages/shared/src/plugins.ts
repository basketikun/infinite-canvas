import { z } from "zod";
import { maxSatisfying, satisfies } from "semver";

export const DEFAULT_PLUGIN_REGISTRY = "https://raw.githubusercontent.com/basketikun/infinite-canvas/plugins-dist-v1/index.json";
/** 宿主提供的插件 API 版本；插件版本声明的 pluginApi 必须与之相等才可安装。 */
export const PLUGIN_API_VERSION = 3;
export const PLUGIN_PACKAGE_MAX_BYTES = 30 * 1024 * 1024;

const entrySchema = z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+\.(?:m?js)$/);
// data、files 是插件数据目录，不能作为插件目录名。
const pluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).refine((id) => !["plugin-manager", "builtin", "data", "files"].includes(id));
export const extensionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*:[^:\s]+$/);
const scopeSchema = z.enum(["application", "workspace", "project", "view"]);
export const projectDomainDeclarationSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), dataVersion: z.number().int().positive() }).strict();
export type PluginProjectDomainDeclaration = z.infer<typeof projectDomainDeclarationSchema>;

/**
 * 插件身份的规范化形式，由目录约定生成（见 createPluginPackage）；显示名称、说明、版本与作者由插件目录里的 plugin.json 提供。
 */
export const pluginManifestSchema = z.object({
    id: pluginIdSchema,
    name: z.string().min(1),
    client: entrySchema,
    // 包内展示资源，不依赖客户端插件运行。
    icon: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\?#%:]+\.(?:png|svg|webp|jpg|jpeg|ico)$/i).optional(),
    readme: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\?#%:]+\.md$/i).optional(),
}).strict();

export const pluginPackageSchema = z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
    infiniteCanvas: pluginManifestSchema,
});

/** 插件目录里的 plugin.json：展示用元信息，不需要启动插件即可读取。 */
export const pluginMetaSchema = z.object({ name: z.string().min(1), description: z.string().optional(), version: z.string().optional(), author: z.string().optional() });

/** host 为当前软件版本，用于挑选适配的插件版本。 */
export const pluginInstallSchema = z.object({ name: z.string().min(1), version: z.string().min(1), host: z.string().min(1) }).strict();
const pluginVersionSchema = z.object({ tarball: z.string().min(1), integrity: z.string().min(1), host: z.string().min(1), pluginApi: z.number().int().positive() }).strict();
/** 下载源 index.json：插件市场列表，也是安装依据；tarball 与 icon 可写完整地址，或相对 index.json 所在目录的路径。 */
export const pluginIndexSchema = z.object({
    version: z.literal(1),
    plugins: z.array(z.object({ name: z.string().min(1), title: z.string().min(1), description: z.string().optional(), author: z.string().optional(), icon: z.string().optional(), versions: z.record(z.string(), pluginVersionSchema) }).strict()),
}).strict();
export const pluginRegistrySchema = z.object({ registry: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol) && new URL(value).pathname.endsWith(".json")) }).strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginPackage = z.infer<typeof pluginPackageSchema>;
export type PluginMeta = z.infer<typeof pluginMetaSchema>;
export type PluginPackageInfo = { id: string; name: string; version: string };
export type PluginInstall = z.infer<typeof pluginInstallSchema>;
export type PluginIndex = z.infer<typeof pluginIndexSchema>;
export type PluginIndexEntry = PluginIndex["plugins"][number];
export type PluginRegistryConfig = z.infer<typeof pluginRegistrySchema>;
export type PluginScopeKind = z.infer<typeof scopeSchema>;

export type PluginRuntimeStatus = "starting" | "active" | "disabled" | "failed";

export type PluginJsonValue = null | boolean | number | string | PluginJsonValue[] | { [key: string]: PluginJsonValue };
export const pluginJsonSchema: z.ZodType<PluginJsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(pluginJsonSchema), z.custom<Record<string, PluginJsonValue>>((value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)).pipe(z.record(pluginJsonSchema))]));

const clientPath = z.string().min(1).refine(path => !/[\\%:?#\p{Cc}]/u.test(path) && path.split("/").every(part => part && part !== "." && part !== ".."));
const clientIndex = z.object({ files: z.array(clientPath), styles: z.array(clientPath) }).strict();
export type PluginClientFiles = z.infer<typeof clientIndex> & { generation: string };

export function readPluginClientFiles(pkg: PluginPackage, generation: string, index?: unknown): PluginClientFiles {
    const entry = pkg.infiniteCanvas.client;
    const parsed = clientIndex.safeParse(index === undefined ? { files: [entry], styles: [] } : index);
    if (!generation || !parsed.success) throw new PluginError("PLUGIN_INVALID");
    const { files, styles } = parsed.data;
    const folder = entry.slice(0, entry.lastIndexOf("/") + 1);
    if (!files.includes(entry) || new Set(files).size !== files.length || new Set(styles).size !== styles.length ||
        files.some(file => !file.startsWith(folder) || file.endsWith(".map") || file.endsWith(".files.json") || file.split("/").includes("node_modules") || file.split("/").pop() === "package.json") ||
        styles.some(file => !file.endsWith(".css") || !files.includes(file))) throw new PluginError("PLUGIN_INVALID");
    return { generation, files, styles };
}

/**
 * 安装记录；版本由 npm 包声明，清单与代码属于同一安装版本。
 */
export type InstalledPlugin = {
    package: PluginPackage;
    registry: string;
    enabled: boolean;
    installedAt: string;
    local?: boolean;
    clientFiles?: PluginClientFiles;
    /** 通过本地插件包安装，没有可继续更新的软件源。 */
    uploaded?: boolean;
    /** 浏览器安装时保存的公开展示内容。 */
    assets?: Partial<Record<"icon" | "readme", string>>;
    /** 恢复模式下本次不启动，不改变保存的启用意愿。 */
    startupSkipped?: boolean;
};

export type PluginStorage = {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
};

export const pluginErrorMessages = {
    PLUGIN_INVALID: "这个软件包不是可用的画布插件，请检查包名和版本。",
    PLUGIN_INCOMPATIBLE: "这个插件暂时没有适配当前软件版本的版本，请更新软件后再安装。",
    PLUGIN_DOWNLOAD_FAILED: "无法获取插件，请检查下载源地址和网络后重试。",
    PLUGIN_INSTALL_FAILED: "插件安装未完成，请检查插件名称、版本和下载源后重试。",
    PLUGIN_PACKAGE_TOO_LARGE: "插件包超过 30 MB，请精简素材后重试。",
    PLUGIN_PACKAGE_INVALID: "无法读取插件包，请确认上传的是 pnpm pack 生成的 .tgz 文件。",
    PLUGIN_LOAD_FAILED: "插件启动失败，请停用后重新启用，或更新插件。",
    PLUGIN_NOT_FOUND: "插件已不可用，请重新安装。",
    PLUGIN_TASK_UNAVAILABLE: "无法查看这项任务，请使用发起任务的插件并打开原作品。",
    PLUGIN_CHAT_BUSY: "会话正在使用。请先处理未发送的草稿，等回复和保存结束后重试。",
    PLUGIN_CONFLICT: "插件的功能标识与已有功能重复，请联系插件作者调整。",
    PLUGIN_CONTRACT_MISMATCH: "插件功能与当前版本不匹配，请更新相关插件。",
    PLUGIN_SCOPE_CLOSED: "当前页面已关闭，插件操作已取消。",
    PLUGIN_INACTIVE: "插件已停用，当前操作已取消。",
    PLUGIN_PROJECT_CHANGED: "画布已切换，当前操作已取消。",
    PLUGIN_OPERATION_FAILED: "插件操作未完成，请重试或联系插件作者。",
    PLUGIN_DEVELOPMENT_ONLY: "请在开发模式中加载本地插件。",
} as const;

export type PluginErrorCode = keyof typeof pluginErrorMessages;

export class PluginError extends Error {
    constructor(public code: PluginErrorCode, options?: ErrorOptions) { super(pluginErrorMessages[code], options); }
}

export function readPluginPackage(value: unknown): PluginPackage {
    const result = pluginPackageSchema.safeParse(value);
    if (result.success) return result.data;
    throw new PluginError("PLUGIN_INVALID");
}

export function getPluginErrorMessage(error: unknown) {
    return error instanceof PluginError ? pluginErrorMessages[error.code] : pluginErrorMessages.PLUGIN_OPERATION_FAILED;
}

/**
 * 浏览器与本地安装服务的公共能力，均使用 npm 包与明确版本。
 */
export interface PluginAdapter {
    list(): Promise<InstalledPlugin[]>;
    config(): Promise<PluginRegistryConfig & { skipThirdPartyPlugins?: boolean }>;
    /** 读取当前下载源的插件市场列表。 */
    index(): Promise<PluginIndex>;
    configure(config: PluginRegistryConfig): Promise<void>;
    /** 同名插件再次安装即更新；失败直接报错，不回滚。 */
    install(request: PluginInstall, signal?: AbortSignal): Promise<InstalledPlugin>;
    /** 读取上传的 npm 插件包，仅供管理操作识别目标插件，不写入安装记录。 */
    inspectPackage(bytes: Uint8Array): Promise<PluginPackageInfo>;
    installPackage(bytes: Uint8Array, signal?: AbortSignal): Promise<InstalledPlugin>;
    remove(id: string): Promise<void>;
    enable(id: string, enabled: boolean): Promise<void>;
    source(id: string, version: string, generation?: string): Promise<string>;
    asset(id: string, version: string, kind: "icon" | "readme", generation?: string): Promise<string>;
    clientFile?(record: InstalledPlugin, path: string): Promise<Blob>;
    clientBase?(record: InstalledPlugin, instance: string): string;
    /** 插件目录（已创建），手写的插件放在其下的 <插件id>/client.js；仅本地服务提供。 */
    localDirectory?(): Promise<string>;
}

export function assertPluginConflicts(records: InstalledPlugin[], candidate: InstalledPlugin) {
    const id = candidate.package.infiniteCanvas.id;
    for (const record of records) {
        if (record.package.infiniteCanvas.id === id) {
            if (record.package.name !== candidate.package.name) throw new PluginError("PLUGIN_CONFLICT");
        } else if (record.package.name === candidate.package.name) throw new PluginError("PLUGIN_CONFLICT");
    }
}

/** 插件 id 取 npm 包名去掉作用域和 canvas-plugin- 前缀后的部分，目录名即插件 id。 */
export function pluginIdFromName(name: string) {
    const id = name.replace(/^@[^/]+\//, "").replace(/^canvas-plugin-/, "");
    if (!pluginIdSchema.safeParse(id).success) throw new PluginError("PLUGIN_INVALID");
    return id;
}

/**
 * 按目录约定生成插件身份：入口为 dist/client.js 或 client.js，图标为 icon.svg/png/webp，说明为 GUIDE.md 或 README.md。
 * package.json 只提供 npm 标准的名称、版本、描述与作者，plugin.json 的同名字段优先；缺失时名称用目录名、版本用 local。
 */
export function createPluginPackage(source: { name: string; version?: string; description?: string; author?: string | { name: string } }, has: (file: string) => boolean, id = pluginIdFromName(source.name), meta?: PluginMeta): PluginPackage {
    const client = ["dist/client.js", "client.js"].find(has);
    if (!client) throw new PluginError("PLUGIN_INVALID");
    const author = meta?.author ?? (typeof source.author === "object" ? source.author.name : source.author);
    return readPluginPackage({
        name: source.name, version: meta?.version ?? source.version ?? "local", description: meta?.description ?? source.description, author,
        infiniteCanvas: { id, name: meta?.name ?? id, client, icon: ["icon.svg", "icon.png", "icon.webp"].find(has), readme: ["GUIDE.md", "README.md"].find(has) },
    });
}

/** 展示用版本；本地插件没有版本时为空。 */
export const pluginDisplayVersion = (pkg: PluginPackage) => pkg.version === "local" ? undefined : pkg.version;

/** 展开 npm 包 tar 条目为「包内路径 → 内容」，只接受 package/ 下的普通文件。 */
export function pluginArchiveFiles(entries: { header: { name: string; type?: string }; data?: Uint8Array }[]) {
    const files = new Map<string, Uint8Array>();
    for (const { header, data } of entries) {
        if (header.type !== "file") continue;
        const file = header.name.slice("package/".length);
        if (!header.name.startsWith("package/") || !data || !clientPath.safeParse(file).success || files.has(file)) throw new PluginError("PLUGIN_PACKAGE_INVALID");
        files.set(file, data);
    }
    if (!files.has("package.json")) throw new PluginError("PLUGIN_PACKAGE_INVALID");
    return files;
}

export function readPluginArchive(files: Map<string, Uint8Array>) {
    try {
        const read = (file: string) => JSON.parse(new TextDecoder().decode(files.get(file)));
        return createPluginPackage(read("package.json"), (file) => files.has(file), undefined, files.has("plugin.json") ? pluginMetaSchema.parse(read("plugin.json")) : undefined);
    }
    catch (error) { throw error instanceof PluginError ? error : new PluginError("PLUGIN_PACKAGE_INVALID", { cause: error }); }
}

type FetchResource = (url: string, signal?: AbortSignal) => Promise<Response>;

/** 读取下载源 index.json；图标路径转为完整地址。 */
export async function fetchPluginIndex(fetchResource: FetchResource, registry: string, signal?: AbortSignal) {
    const result = pluginIndexSchema.safeParse(await (await fetchResource(registry, signal)).json());
    if (!result.success) throw new PluginError("PLUGIN_DOWNLOAD_FAILED", { cause: result.error });
    return { ...result.data, plugins: result.data.plugins.map((entry) => ({ ...entry, icon: entry.icon && new URL(entry.icon, registry).href })) };
}

/** 插件版本是否适配当前软件版本与插件 API。 */
export const isPluginVersionCompatible = (entry: PluginIndexEntry["versions"][string], host: string) => entry.pluginApi === PLUGIN_API_VERSION && satisfies(host, entry.host, { includePrerelease: true });

/** 在适配当前软件的版本中选择最新版本；version 为 latest 或 semver 范围，没有则返回 undefined。 */
export function selectPluginVersion(entry: PluginIndexEntry, version: string, host: string) {
    const compatible = Object.keys(entry.versions).filter((item) => isPluginVersionCompatible(entry.versions[item], host));
    return maxSatisfying(compatible, version === "latest" ? "*" : version) ?? undefined;
}

/** 按 index.json 下载并校验指定版本的包（tgz 字节）。 */
export async function fetchPluginTarball(fetchResource: FetchResource, registry: string, request: PluginInstall, signal?: AbortSignal) {
    const entry = (await fetchPluginIndex(fetchResource, registry, signal)).plugins.find((item) => item.name === request.name);
    if (!entry) throw new PluginError("PLUGIN_INVALID");
    const version = selectPluginVersion(entry, request.version, request.host);
    if (!version) throw new PluginError("PLUGIN_INCOMPATIBLE");
    const selected = entry.versions[version];
    const bytes = new Uint8Array(await (await fetchResource(new URL(selected.tarball, registry).href, signal)).arrayBuffer());
    if (bytes.byteLength > PLUGIN_PACKAGE_MAX_BYTES) throw new PluginError("PLUGIN_PACKAGE_TOO_LARGE");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
    if (selected.integrity !== `sha512-${btoa(String.fromCharCode(...digest))}`) throw new PluginError("PLUGIN_INVALID");
    return { bytes, version };
}
