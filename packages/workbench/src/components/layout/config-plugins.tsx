import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { settings, syncTransports } from "@infinite-canvas/plugin-sdk/builtin";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@infinite-canvas/plugin-sdk/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@infinite-canvas/plugin-sdk/ui/alert-dialog";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@infinite-canvas/plugin-sdk/ui/tabs";
import { ArrowLeft, ChevronRight, Copy, Download, Puzzle, RefreshCw, Settings2, Trash2, Upload } from "lucide-react";
import { DEFAULT_PLUGIN_REGISTRY, PLUGIN_PACKAGE_MAX_BYTES, pluginDisplayVersion, getPluginErrorMessage, PluginError, pluginErrorMessages, type InstalledPlugin } from "@infinite-canvas/shared/plugins";
import { installPlugin, installPluginPackage, refreshPlugins, reloadDevelopmentPlugin, setPluginEnabled, uninstallPlugin } from "@workbench/lib/plugins/manager";
import { plugins as adapter } from "@workbench/services/plugins/runtime";
import { network } from "@workbench/services/network/runtime";
import { useCopyText } from "@workbench/hooks/use-copy-text";
import { pluginAiPrompt } from "@workbench/lib/plugins/ai-prompt";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { pluginRegistry } from "@workbench/lib/plugins/registry";
import { PluginDetails } from "@workbench/components/plugins/plugin-details";
import { PluginMarket } from "@workbench/components/layout/plugin-market";
import { PluginIcon } from "@workbench/components/plugins/plugin-icon";
import { PluginBoundary, PluginSettingsView } from "@workbench/components/plugins/plugin-contributions";

export function ConfigPlugins({ signal }: { signal: AbortSignal }) {
    usePluginStore((state) => state.revision);
    const plugins = usePluginStore((state) => state.plugins);
    const states = usePluginStore((state) => state.states);
    const [spec, setSpec] = useState("");
    const [registry, setRegistry] = useState(DEFAULT_PLUGIN_REGISTRY);
    const [registryOpen, setRegistryOpen] = useState(false);
    const [page, setPage] = useState("mine");
    const [sourceRevision, setSourceRevision] = useState(0);
    const registryEdited = useRef(false);
    const uploadInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<Record<string, number>>({});
    const actionSequence = useRef(0);
    const [error, setError] = useState<string | null>(null);
    const copyText = useCopyText();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("details");
    const selected = plugins.find((record) => record.package.infiniteCanvas.id === selectedId);
    useEffect(() => {
        let active = true;
        void Promise.all([
            adapter.config().then((config) => {
                if (active && !signal.aborted && !registryEdited.current) setRegistry(config.registry);
            }),
            refreshPlugins(),
        ]).catch((error) => { if (active && !signal.aborted) setError(getPluginErrorMessage(error)); });
        return () => { active = false; };
    }, [signal]);
    const run = async (id: string, action: () => Promise<unknown>, success: string) => {
        if (signal.aborted) return;
        const sequence = ++actionSequence.current;
        setBusy((current) => ({ ...current, [id]: sequence }));
        setError(null);
        try { await action(); if (!signal.aborted) toast.success(success); }
        catch (error) { if (!signal.aborted && !(error instanceof PluginError && error.code === "PLUGIN_INACTIVE")) setError(getPluginErrorMessage(error)); }
        finally { if (!signal.aborted) setBusy((current) => { if (current[id] !== sequence) return current; const next = { ...current }; delete next[id]; return next; }); }
    };
    const install = () => run("install", async () => {
        const response = await fetch(network.url(spec));
        if (!response.ok) throw new PluginError("PLUGIN_DOWNLOAD_FAILED");
        await installPluginPackage(new Uint8Array(await response.arrayBuffer()));
        if (!signal.aborted) setSpec("");
    }, "插件已安装");
    const uploadPackage = (file: File) => {
        if (file.size > PLUGIN_PACKAGE_MAX_BYTES) { setError(pluginErrorMessages.PLUGIN_PACKAGE_TOO_LARGE); return; }
        void run("install", async () => {
            await installPluginPackage(new Uint8Array(await file.arrayBuffer()));
        }, "插件已安装");
    };
    const setEnabled = (record: InstalledPlugin, enabled: boolean) => void run(record.package.infiniteCanvas.id, () => setPluginEnabled(record, enabled), enabled ? "已保存启用设置" : "已保存停用设置");
    const pluginTabs = (id: string) => [...pluginRegistry.getSnapshot(settings), ...pluginRegistry.getSnapshot(syncTransports)].filter((entry) => entry.pluginId === id).map((entry) => ({ entry, title: entry.value.title }));
    const statusMessage = (id: string) => states[id]?.error ? <p role="alert" className="text-xs">{pluginErrorMessages[states[id].error!]}</p> : null;
    const controls = (record: InstalledPlugin, detail = false) => {
        const id = record.package.infiniteCanvas.id;
        const status = states[id]?.status;
        return <div className="flex min-h-8 flex-nowrap items-center gap-1">
            <label htmlFor={`enable-plugin-${id}`} className="mr-auto flex shrink-0 items-center gap-2 pr-2 text-sm">启用插件<Switch id={`enable-plugin-${id}`} checked={record.enabled} disabled={Boolean(busy[id]) && !(record.enabled && status === "starting")} onCheckedChange={(enabled) => setEnabled(record, enabled)} /></label>
            {detail && status === "starting" ? <span className="text-xs text-muted-foreground">正在启动…</span> : null}
            {record.startupSkipped && record.enabled ? <Button variant="ghost" size="sm" disabled={Boolean(busy[id])} onClick={() => void run(id, () => setPluginEnabled(record, true), "插件已启用")}>启动插件</Button> : null}
            {!detail && pluginTabs(id).length ? <Button variant="ghost" size="sm" onClick={() => { setSelectedId(id); setActiveTab(pluginTabs(id)[0].entry.id); setError(null); }}><Settings2 className="size-4" />设置</Button> : null}
            {import.meta.env.DEV && record.local ? <Button variant="ghost" size="icon-sm" aria-label="重新加载" title="重新加载" disabled={Boolean(busy[id])} onClick={() => void run(id, () => reloadDevelopmentPlugin(record), "插件已重新加载")}><RefreshCw className="size-4" /></Button> : null}
            {!detail && !record.local ? <>
                {record.uploaded || record.package.version === "local" ? null : <Button variant="ghost" size="icon-sm" aria-label="更新" title="更新" disabled={Boolean(busy[id])} onClick={() => void run(id, () => installPlugin({ name: record.package.name, version: "latest" }), "插件已更新")}><RefreshCw className="size-4" /></Button>}
                <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="卸载" title="卸载" disabled={Boolean(busy[id])}><Trash2 className="size-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>卸载插件？</AlertDialogTitle><AlertDialogDescription>已生成的内容会保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void run(id, () => uninstallPlugin(id), "插件已卸载")}>卸载</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            </> : null}
        </div>;
    };
    if (selected) {
        const { infiniteCanvas: manifest } = selected.package;
        const tabs = pluginTabs(manifest.id);
        return <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="ghost" size="sm" onClick={() => { setSelectedId(null); setError(null); }}><ArrowLeft className="size-4" />返回插件列表</Button>
                {controls(selected, true)}
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {statusMessage(manifest.id)}
            <Tabs value={tabs.some(({ entry }) => entry.id === activeTab) ? activeTab : "details"} onValueChange={setActiveTab} className="gap-6">
                <TabsList variant="line" className="w-full justify-start gap-6 border-b">
                    <TabsTrigger value="details" className="flex-none">插件详情</TabsTrigger>
                    {tabs.map(({ entry, title }) => <TabsTrigger key={entry.id} value={entry.id} className="flex-none">{title}</TabsTrigger>)}
                </TabsList>
                <TabsContent value="details"><PluginBoundary pluginId={manifest.id} contributionId="details" callbackName="Content" resetKey={selected}><PluginDetails key={manifest.id} record={selected} /></PluginBoundary></TabsContent>
                {tabs.map(({ entry }) => activeTab === entry.id ? <TabsContent key={entry.id} value={entry.id}><PluginSettingsView key={entry.id} pluginId={manifest.id} entryId={entry.id} signal={signal} /></TabsContent> : null)}
            </Tabs>
        </div>;
    }
    return <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:px-8">
        <Tabs value={page} onValueChange={setPage} className="gap-6">
            <div className="flex items-center justify-between gap-2">
                <TabsList variant="line" className="justify-start gap-6">
                    <TabsTrigger value="mine" className="flex-none">我的插件</TabsTrigger>
                    <TabsTrigger value="install" className="flex-none">插件安装</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-1">
                    {page === "mine" && adapter.localDirectory ? <Button variant="ghost" size="sm" onClick={() => void adapter.localDirectory!().then((directory) => copyText(pluginAiPrompt(directory), "已复制，发给你的 AI 助手并补充想要的插件")).catch((reason) => setError(getPluginErrorMessage(reason)))}><Copy className="size-4" />让 AI 帮我写插件</Button> : null}
                    {page === "mine" && adapter.localDirectory ? <Button variant="ghost" size="sm" disabled={Boolean(busy.reload)} onClick={() => void run("reload", refreshPlugins, "已重新加载本地插件")}><RefreshCw className="size-4" />重新加载本地插件</Button> : null}
                    {page === "install" ? <Button variant="ghost" size="sm" onClick={() => setRegistryOpen(true)}><Settings2 className="size-4" />下载源设置</Button> : null}
                </div>
            </div>
        <Dialog open={registryOpen} onOpenChange={setRegistryOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>插件下载源</DialogTitle>
                    <DialogDescription>填写插件列表 index.json 的地址，安装和更新插件都按这个列表下载，一般无需修改。</DialogDescription>
                </DialogHeader>
                <Input aria-label="插件下载源" value={registry} disabled={Boolean(busy.registry)} onChange={(event) => { registryEdited.current = true; setRegistry(event.target.value); }} placeholder={DEFAULT_PLUGIN_REGISTRY} />
                <DialogFooter>
                    <Button variant="outline" onClick={() => setRegistryOpen(false)}>取消</Button>
                    <Button disabled={Boolean(busy.registry)} onClick={() => { registryEdited.current = true; void run("registry", async () => { await adapter.configure({ registry }); setSourceRevision((value) => value + 1); setRegistryOpen(false); }, "下载源已保存"); }}>保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <TabsContent value="mine">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
            {plugins.length ? plugins.map((record) => {
                const { infiniteCanvas: manifest } = record.package;
                return <article key={manifest.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-current/10 transition-colors hover:bg-current/[0.03]">
                    <button type="button" aria-label={`查看${manifest.name}详情`} className="group flex flex-1 cursor-pointer flex-col gap-3 px-5 pb-3 pt-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2" onClick={() => { setSelectedId(manifest.id); setActiveTab("details"); setError(null); }}>
                        <div className="flex w-full items-center gap-3">
                            <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-current/10 bg-current/5 [&_img]:size-6 [&_svg]:size-6"><PluginIcon record={record} /></span>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate font-medium">{manifest.name}</span>
                                <span className="truncate text-xs opacity-50">{[pluginDisplayVersion(record.package), record.package.author, record.local ? "开发中" : undefined, states[manifest.id]?.status === "starting" ? "正在启动…" : undefined].filter(Boolean).join(" · ")}</span>
                            </span>
                            <ChevronRight className="size-4 shrink-0 opacity-30 transition group-hover:translate-x-0.5 group-hover:opacity-60" />
                        </div>
                        <p className="m-0 line-clamp-2 min-h-10 text-sm leading-5 opacity-60">{record.package.description}</p>
                    </button>
                    <div className="space-y-2 pb-3 pl-5 pr-3 pt-1">
                        {statusMessage(manifest.id)}
                        {controls(record)}
                    </div>
                </article>;
            }) : <div className="col-span-full flex flex-col items-center gap-2 rounded-xl border border-dashed border-current/15 px-6 py-14 text-center">
                <Puzzle className="size-8 opacity-30" />
                <p className="m-0 text-sm font-medium">还没有安装插件</p>
                <p className="m-0 max-w-sm text-xs text-muted-foreground">到「插件安装」选择需要的插件，装好后可在这里启用、更新和设置。</p>
            </div>}
        </div>
            </TabsContent>
            <TabsContent value="install" className="space-y-6">
        <div className="flex flex-wrap gap-2">
            <Input aria-label="插件包地址" className="min-w-48 flex-1" disabled={Boolean(busy.install)} placeholder="输入插件包地址，例如 https://example.com/canvas-plugin-xxx-1.0.0.tgz" value={spec} onChange={(event) => setSpec(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && spec && !busy.install) void install(); }} />
            <Button disabled={!spec || Boolean(busy.install)} onClick={() => void install()}><Download className="size-4" />{busy.install ? "正在安装…" : "安装"}</Button>
            <input ref={uploadInput} type="file" accept=".tgz,.tar.gz,application/gzip" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) uploadPackage(file);
            }} />
            <Button variant="outline" title="支持 .tgz 插件文件，最大 30 MB" disabled={Boolean(busy.install)} onClick={() => uploadInput.current?.click()}><Upload className="size-4" />上传插件包</Button>
        </div>
                <PluginMarket key={sourceRevision} />
            </TabsContent>
        </Tabs>
    </div>;
}
