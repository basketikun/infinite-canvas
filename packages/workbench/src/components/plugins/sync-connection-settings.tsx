import { useLayoutEffect, useRef, useState } from "react";
import type { PluginSyncProgress, PluginSyncTransport } from "@infinite-canvas/plugin-sdk";
import type { RegisteredContribution } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import type { SyncConnectionConfig } from "@infinite-canvas/shared/workspace-config";
import { openSyncSettings, syncStatusMessage } from "@workbench/lib/plugins/sync-transport";

export function SyncConnectionSettings({ entry, scope }: { entry: RegisteredContribution<PluginSyncTransport>; scope: PluginScope }) {
    const active = useRef<ReturnType<typeof openSyncSettings> | null>(null);
    const pending = useRef<ReturnType<typeof openSyncSettings> | null>(null);
    const [config, setConfig] = useState<SyncConnectionConfig>();
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<Record<string, PluginSyncProgress>>({});
    useLayoutEffect(() => {
        if (scope.signal.aborted || entry.signal.aborted) return;
        const view = new PluginScope();
        const api = openSyncSettings(entry, view);
        setConfig(undefined); setStatus(""); setBusy(false); setProgress({});
        active.current = api;
        const release = scope.add(() => view.close());
        const signal = AbortSignal.any([scope.signal, entry.signal]);
        const close = () => {
            if (active.current === api) active.current = null;
            view.cancel();
            void release().catch((error) => console.error("[sync] settings close", error));
        };
        if (signal.aborted) close();
        else {
            signal.addEventListener("abort", close, { once: true });
            void api.load().then((value) => { if (active.current === api) setConfig(value); }, () => {
                if (active.current === api) setStatus("读取同步设置失败，请重新打开。");
            });
        }
        return () => { signal.removeEventListener("abort", close); close(); };
    }, [entry, scope]);

    async function run(action: "save" | "test" | "sync") {
        const api = active.current;
        if (!api || !config || pending.current === api) return;
        pending.current = api;
        setBusy(true); setStatus(""); setProgress({});
        try {
            const result = await api.run(action, config, (event) => {
                if (active.current !== api) return;
                setStatus(event.stage);
                if (event.domain) setProgress((previous) => ({ ...previous, [event.domain!]: event }));
            });
            if (active.current !== api) return;
            setConfig(result.connection);
            setStatus(result.domains ? ["同步完成", ...result.domains.map(({ title, count }) => `${title} ${count} 条`)].join("，") + "。" : action === "test" ? "连接可用" : "已保存");
        } catch (error) { if (active.current === api) setStatus(syncStatusMessage(error)); }
        finally {
            if (pending.current === api) pending.current = null;
            if (active.current === api) setBusy(false);
        }
    }
    return <section className="space-y-3" aria-label={entry.value.title}>
        {config && <>
            <label className="block">服务地址<Input disabled={busy} value={config.url} onChange={(event) => setConfig({ ...config, url: event.target.value })} /></label>
            <label className="block">远程目录<Input disabled={busy} value={config.directory} onChange={(event) => setConfig({ ...config, directory: event.target.value })} /></label>
            {entry.value.fields.map(({ key, title, secret }) =>
                <label key={key} className="block">{title}<Input type={secret ? "password" : "text"} disabled={busy} value={config.values[key]} onChange={(event) => setConfig({ ...config, values: { ...config.values, [key]: event.target.value } })} /></label>)}
            <div className="flex flex-wrap gap-2">
                <Button disabled={busy} variant="outline" onClick={() => void run("save")}>保存设置</Button>
                <Button disabled={busy || !config.url} variant="outline" onClick={() => void run("test")}>测试连接</Button>
                <Button disabled={busy || !config.url} onClick={() => void run("sync")}>立即同步</Button>
            </div>
            {config.lastSyncedAt && <p>上次同步 {new Date(config.lastSyncedAt).toLocaleString("zh-CN")}</p>}
        </>}
        {Object.values(progress).map((item) => <p key={item.domain}>{item.label} · {item.stage} {item.total ? `${item.current}/${item.total}` : ""}</p>)}
        <p role="status">{status || (!config ? "正在读取同步设置…" : "")}</p>
    </section>;
}
