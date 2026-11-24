import { SyncTransportError, type PluginSyncProgress, type PluginSyncTransport, type SyncTransportProbe, type SyncTransportSession } from "@infinite-canvas/plugin-sdk";
import type { RegisteredContribution } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { PluginError, pluginErrorMessages } from "@infinite-canvas/shared/plugins";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import type { SyncConnectionConfig } from "@infinite-canvas/shared/workspace-config";
import { network } from "@workbench/services/network/runtime";
import { confirmSyncConnection, readSyncConnection, saveSyncConnection } from "@workbench/stores/use-workspace-config-store";
import { pluginRegistry } from "./registry";
import { getPluginPackageName } from "./runtime";

type Entry = RegisteredContribution<PluginSyncTransport>;
type Counts = { id: string; title: string; count: number }[];
const probeMethods = new Set(["GET", "HEAD", "OPTIONS", "MKCOL", "PROPFIND"]);

function packageName(entry: Entry) {
    return getPluginPackageName(entry.pluginId);
}

const blockedPath = (part: string) => !part || part === "." || part === ".." || /[/\\]/.test(part);

/** 每个驱动只能通过这次操作访问所选连接的目录，测试只取得目录状态。 */
function connectionOperation(config: SyncConnectionConfig, scope: PluginScope) {
    const url = URL.canParse(config.url) ? new URL(config.url) : null;
    const directory = Object.freeze(config.directory.split("/").filter(Boolean));
    if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || directory.some(blockedPath)) throw new PluginError("PLUGIN_INVALID");
    const base = url.href.replace(/\/+$/, "");
    const common = { url: config.url, directory, values: Object.freeze({ ...config.values }), signal: scope.signal };
    async function send(path: readonly string[], init: RequestInit, probe: boolean) {
        scope.assertActive();
        const method = (init.method ?? "GET").toUpperCase();
        const inside = directory.every((part, index) => part === path[index]);
        const ancestor = path.length <= directory.length && path.every((part, index) => part === directory[index]);
        if (path.some(blockedPath) || (probe ? !ancestor || !probeMethods.has(method) : !inside && !(ancestor && ["MKCOL", "PROPFIND"].includes(method)))) throw new PluginError("PLUGIN_INVALID");
        const target = base + "/" + path.map(encodeURIComponent).join("/");
        const mapped = network.url(target, "sync");
        if (network.kind === "server" && mapped === target && typeof location !== "undefined" && url.origin === location.origin) throw new PluginError("PLUGIN_INVALID");
        const signal = init.signal ? AbortSignal.any([scope.signal, init.signal]) : scope.signal;
        signal.throwIfAborted();
        const headers = new Headers(init.headers);
        const response = await fetch(mapped, { method, headers, body: init.body, cache: init.cache, signal, redirect: "manual", credentials: network.kind === "server" && mapped !== target ? "same-origin" : "omit" });
        signal.throwIfAborted();
        // 跳转一律停止，避免认证信息被带到其他地址；单独提示用户改填跳转后的地址。
        if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400 && response.status !== 304)) {
            await response.body?.cancel();
            throw new SyncTransportError("REDIRECT", response.status ? `HTTP ${response.status}` : undefined);
        }
        if (mapped !== target && response.headers.get("x-canvas-sync-proxy") !== "1") {
            await response.body?.cancel();
            throw new PluginError("PLUGIN_OPERATION_FAILED");
        }
        if (!inside) {
            await response.body?.cancel();
            return new Response(null, { status: response.status });
        }
        return response;
    }
    const probe: SyncTransportProbe = { ...common, probe: (path, method, headers, signal) => scope.track(async () => {
        const response = await send(path, { method, headers, signal }, true);
        await response.body?.cancel();
        return response.status;
    }) };
    const session: SyncTransportSession = { ...common, request: (path, init) => scope.track(() => send(path, init, false)) };
    return { probe, session };
}

/** 由宿主的插件配置视图持有。目录、插件上下文和能力列表都不公开这份操作许可。 */
export function openSyncSettings(entry: Entry, view: PluginScope) {
    const check = () => { entry.assertActive(); view.assertActive(); };
    let running = false;
    const defaults = () => ({ url: "", directory: entry.value.defaultDirectory ?? "", values: Object.fromEntries(entry.value.fields.map(({ key }) => [key, ""])), lastSyncedAt: "" });
    return {
        async load() {
            return view.track(async () => {
                check();
                const saved = await readSyncConnection(entry.id, packageName(entry));
                check();
                if (!saved) return defaults();
                return { ...saved, values: Object.fromEntries(entry.value.fields.map(({ key }) => [key, saved.values[key] ?? ""])) };
            });
        },
        async run(action: "save" | "test" | "sync", input: SyncConnectionConfig, progress?: (event: PluginSyncProgress) => void): Promise<{ connection: SyncConnectionConfig; domains?: Counts }> {
            check();
            if (running) throw new PluginError("PLUGIN_CONFLICT");
            const config = structuredClone(input);
            if (Object.keys(config.values).some((key) => !entry.value.fields.some((field) => field.key === key))) throw new PluginError("PLUGIN_INVALID");
            const operation = new PluginScope();
            const source = AbortSignal.any([view.signal, entry.signal]);
            const cancel = () => operation.cancel();
            source.addEventListener("abort", cancel, { once: true });
            running = true;
            const execute = async () => {
                check();
                await saveSyncConnection(entry.id, packageName(entry), config);
                check();
                const saved = await readSyncConnection(entry.id, packageName(entry));
                check();
                if (!saved || saved.url !== config.url || saved.directory !== config.directory ||
                    Object.keys(saved.values).length !== Object.keys(config.values).length || Object.entries(config.values).some(([key, value]) => saved.values[key] !== value)) throw new PluginError("PLUGIN_CONFLICT");
                if (action === "save") return { connection: saved };
                const { probe, session } = connectionOperation(saved, operation);
                if (action === "test") {
                    await entry.value.test(probe);
                    check();
                    return { connection: saved };
                }
                const { syncWorkspaceData } = await import("@workbench/services/app-sync");
                const driver = await entry.value.open(session);
                check();
                const result = await syncWorkspaceData(driver, operation.signal, progress);
                check();
                await confirmSyncConnection(entry.id, packageName(entry), saved, result.syncedAt);
                check();
                return { connection: { ...saved, lastSyncedAt: result.syncedAt }, domains: result.domains };
            };
            const tracked = async () => {
                try { return await execute(); } finally { await operation.close(); }
            };
            try { return await view.track(() => pluginRegistry.track(entry, tracked)); }
            finally {
                source.removeEventListener("abort", cancel);
                await operation.close();
                running = false;
            }
        },
    };
}

export function syncStatusMessage(error: unknown) {
    const message = syncFailureMessage(error);
    // 插件可能自带 SDK 副本，按字段读取远端原因，不依赖 instanceof。
    const detail = error && typeof error === "object" && "detail" in error && typeof error.detail === "string" ? error.detail : "";
    return detail ? `${message}原因：${detail}` : message;
}

function syncFailureMessage(error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    switch (code) {
        case "REDIRECT": return "服务地址发生了跳转，请填写跳转后的完整服务地址。";
        case "AUTH": return "认证失败，请检查账号、密码和目录权限。";
        case "DIRECTORY": return "无法创建远程目录，请检查目录和写入权限。";
        case "TEST": return "连接测试失败，请检查地址和目录权限。";
        case "READ": return "读取远程文件失败，请检查连接后重试。";
        case "WRITE": return "上传失败，请检查剩余空间和写入权限。";
        case "REMOTE_CONFLICT": return "另一台设备已更新远端清单。请再次同步以合并最新内容。";
        case "REVISION_UNAVAILABLE": return "无法确认远端清单的版本。请检查同步服务是否支持按版本写入，以及浏览器是否有权读取版本信息。";
        case "PLUGIN_INVALID": return "请检查服务地址、远程目录和连接设置。";
        case "STORAGE_CHAT_PROJECT_MISSING": case "STORAGE_WORK_TIME_MISSING": return new StorageError(code).message;
        case "STORAGE_INVALID": return "同步未完成。请补齐缺失或损坏的原文件后重试。若远程目录来自旧版本，请保留旧目录，改用新的空目录。";
        case "PLUGIN_CONTRACT_MISMATCH": return "插件不支持这份数据的版本。请保留原目录，使用支持该版本的插件后再同步。";
        case "PLUGIN_INACTIVE": case "PLUGIN_SCOPE_CLOSED": return "同步期间启用的插件已变更，请重新同步。";
        case "PLUGIN_CHAT_BUSY": return pluginErrorMessages.PLUGIN_CHAT_BUSY;
        case "PLUGIN_CONFLICT": return "同步遇到冲突。请等两端编辑保存后重试；正在编辑的独立作品请先关闭。如果两端的文件内容不同，请保留两份原件，在其中一端重新导入并更新引用。";
        case "STORAGE_UNAVAILABLE": return "本机数据未能读取或保存。请确认工作区可用，保存修改后重试。";
        default: return "操作未完成，请检查连接、目录和剩余空间后重试。";
    }
}
