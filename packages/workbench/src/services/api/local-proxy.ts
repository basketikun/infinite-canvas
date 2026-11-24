import { parse } from "semver";
import { LOCAL_PROXY_PACKAGE, normalizeLocalProxyUrl } from "@workbench/stores/use-config-store";

/** The proxy answers its root path with its own identity payload, which doubles as a reachability check. */
export async function testLocalProxy(proxyUrl: string, signal: AbortSignal) {
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base) throw new Error("请先填写本地代理地址。");
    const response = await fetch(`${base}/`, { cache: "no-store", signal }).catch((cause) => {
        signal.throwIfAborted();
        throw new Error("无法连接本地代理，请先运行上方命令，并确认代理地址正确后重试。", { cause });
    });
    const data = response.ok ? await response.json().catch(() => null) : null;
    signal.throwIfAborted();
    const version = typeof data?.version === "string" ? parse(data.version) : null;
    if (data?.app !== "infinite-canvas" || data.proxy !== LOCAL_PROXY_PACKAGE || !version) throw new Error("无法连接本地代理，请确认命令已启动且地址填写正确。");
    return `${LOCAL_PROXY_PACKAGE} v${version.major}.${version.minor}.${version.patch}`;
}
