import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Copy, LoaderCircle, Network, Wifi } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useCopyText } from "@workbench/hooks/use-copy-text";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { testLocalProxy } from "@workbench/services/api/local-proxy";
import { DEFAULT_LOCAL_PROXY_URL, LOCAL_PROXY_PACKAGE, normalizeLocalProxyUrl, useConfigStore } from "@workbench/stores/use-config-store";
import { SettingsNetworkSwitch } from "./settings-network-controls";
import "./config-network.css";

export function ConfigLocalProxy({ signal }: { signal: AbortSignal }) {
    const copyText = useCopyText();
    const [testing, setTesting] = useState(false);
    const pending = useRef<AbortController | null>(null);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const address = config.proxyUrl;
    const command = localProxyCommand(address);
    useLayoutEffect(() => {
        setTesting(false);
        return () => { pending.current?.abort(); pending.current = null; };
    }, [signal, address]);

    const testProxy = async () => {
        if (signal.aborted || pending.current) return;
        const request = new AbortController();
        const requestSignal = AbortSignal.any([signal, request.signal]);
        pending.current = request;
        setTesting(true);
        try {
            const result = await testLocalProxy(config.proxyUrl, requestSignal);
            if (!requestSignal.aborted) toast.success(`本地代理连接正常（${result}）`, workbenchMessageOptions.success);
        } catch {
            if (!requestSignal.aborted) toast.error("无法连接本地代理，请确认命令已启动且地址填写正确。", workbenchMessageOptions.error);
        } finally {
            if (pending.current === request) pending.current = null;
            if (!requestSignal.aborted) setTesting(false);
        }
    };

    return (
        <div className="settings-network generation-workspace-controls">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div id="local-proxy-title" className="flex items-center gap-2 text-sm font-semibold">
                        <Network aria-hidden className="size-4" />
                        本地代理
                    </div>
                    <div className="mt-1 text-xs text-stone-500">部分服务无法从网页直接访问时，可开启本地代理来连接模型、同步文件和读取远程素材。</div>
                </div>
                <SettingsNetworkSwitch aria-labelledby="local-proxy-title" checked={config.proxyEnabled} onCheckedChange={(checked) => updateConfig("proxyEnabled", checked)} />
            </div>
            <div className="mt-3 rounded-md bg-stone-100 px-3 py-2 dark:bg-stone-900">
                <div className="mb-1 text-xs text-stone-500">先在终端运行下面的命令，并在使用画布期间保持运行：</div>
                <div className="flex items-center justify-between gap-3">
                    <code className="min-w-0 truncate text-xs">{command}</code>
                    <Button type="button" variant="ghost" size="xs" className="settings-command-copy" aria-label="复制代理启动命令" title="复制代理启动命令" onClick={() => void copyText(command)}><Copy aria-hidden className="size-3.5" /></Button>
                </div>
            </div>
            <div className="mb-6">
                <label htmlFor="local-proxy-address" className="mb-2 block w-fit">代理地址</label>
                <Input
                    id="local-proxy-address"
                    className="settings-network-field"
                    aria-describedby="local-proxy-address-hint"
                    value={address}
                    placeholder={DEFAULT_LOCAL_PROXY_URL}
                    onChange={(event) => updateConfig("proxyUrl", event.target.value)}
                    onBlur={(event) => {
                        updateConfig("proxyUrl", normalizeLocalProxyUrl(event.target.value) || DEFAULT_LOCAL_PROXY_URL);
                    }}
                />
                <p id="local-proxy-address-hint" className="min-h-6 text-muted-foreground">需要和上面命令启动后打印的地址一致。</p>
            </div>
            <Button type="button" variant="outline" className="mt-3" aria-busy={testing} aria-disabled={testing} onClick={() => void testProxy()}>
                {testing ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Wifi aria-hidden className="size-4" />}测试连接
            </Button>
            <div className="mt-3 text-xs text-stone-500">渠道和 WebDAV 仍填写真实地址，不要填代理地址；关闭开关即可恢复直连。</div>
        </div>
    );
}

function localProxyCommand(proxyUrl: string) {
    // Pinned to @latest because npx otherwise reuses whatever version it already cached.
    const command = `pnpm dlx ${LOCAL_PROXY_PACKAGE}@latest`;
    try {
        const port = new URL(normalizeLocalProxyUrl(proxyUrl) || DEFAULT_LOCAL_PROXY_URL).port;
        return port && port !== new URL(DEFAULT_LOCAL_PROXY_URL).port ? `${command} --port ${port}` : command;
    } catch {
        return command;
    }
}
