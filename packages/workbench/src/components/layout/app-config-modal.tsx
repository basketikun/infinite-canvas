import { Bot, CircleAlert, Download, HardDrive, MessageSquareText, Network, Palette, Pencil, Puzzle, Server, Settings2, SlidersHorizontal, Upload, X } from "lucide-react";
import { Dialog, Tabs } from "radix-ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { layouts, themes } from "@infinite-canvas/plugin-sdk/builtin";
import { applicationBinding, pluginRegistry } from "@workbench/lib/plugins/registry";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { network } from "@workbench/services/network/runtime";
import { exportAppConfig, importAppConfig } from "@workbench/services/config-file";
import { workspaceConfigWrites } from "@workbench/stores/use-workspace-config-store";
import { getModelConfigIssue, modelOptionLabel, useConfigStore, channelWrites } from "@workbench/stores/use-config-store";
import { listCallScripts, useCallScriptStore } from "@workbench/stores/use-call-script-store";
import { ConfigAppearance } from "./config-appearance";
import { ConfigChannels } from "./config-channels";
import { ConfigExternalAgent } from "./config-external-agent";
import { ConfigLocalProxy } from "./config-local-proxy";
import { ConfigLocalStorage } from "./config-local-storage";
import { ConfigObjectStorage } from "./config-object-storage";
import { ConfigPlugins } from "./config-plugins";
import { ConfigPreferences } from "./config-preferences";
import { ConfigPromptSources } from "./config-prompt-sources";
import styles from "./app-config-modal.module.css";

type SettingsTab = { id: string; title: string; icon: ReactNode; page?: boolean; hidden?: boolean; Content: (props: { signal: AbortSignal }) => ReactNode };
const allTabs: SettingsTab[] = [
    { id: "builtin:channels", title: "渠道", icon: <SlidersHorizontal className="size-[18px]" />, page: true, Content: ConfigChannels },
    { id: "builtin:external-agent", title: "Agent配置", icon: <Bot className="size-[18px]" />, Content: ConfigExternalAgent },
    { id: "builtin:plugins", title: "插件", icon: <Puzzle className="size-[18px]" />, page: true, Content: ConfigPlugins },
    { id: "builtin:appearance", title: "外观", icon: <Palette className="size-[18px]" />, Content: ConfigAppearance },
    { id: "builtin:local-proxy", title: "本地代理", icon: <Network className="size-[18px]" />, hidden: network.kind !== "browser", Content: ConfigLocalProxy },
    { id: "builtin:object-storage", title: "对象存储", icon: <Server className="size-[18px]" />, Content: ConfigObjectStorage },
    { id: "builtin:preferences", title: "偏好设置", icon: <Settings2 className="size-[18px]" />, Content: ConfigPreferences },
    { id: "builtin:prompt-sources", title: "提示词来源", icon: <MessageSquareText className="size-[18px]" />, Content: ConfigPromptSources },
    { id: "builtin:local-storage", title: "本地存储", icon: <HardDrive className="size-[18px]" />, Content: ConfigLocalStorage },
].filter((tab) => !tab.hidden);

function AppConfigPanel() {
    const configInputRef = useRef<HTMLInputElement>(null);
    const [view, setView] = useState<{ tabId: string; scope: PluginScope } | null>(null);
    const open = useConfigStore((state) => state.isConfigOpen);
    const selection = useConfigStore((state) => state.configSelection);
    const config = useConfigStore((state) => state.config);
    const configModel = useConfigStore((state) => state.configModel);
    usePluginStore((state) => state.revision);
    const appearanceEmpty = !pluginRegistry.query(themes, applicationBinding).length && !pluginRegistry.query(layouts, applicationBinding).length;
    const appTabs = allTabs.filter((tab) => tab.id !== "builtin:appearance" || !appearanceEmpty);
    const current = appTabs.find((tab) => tab.id === selection.tab) ?? appTabs[0];
    const activeId = current.id;
    useLayoutEffect(() => {
        if (!open) return;
        if (useConfigStore.getState().configSelection.tab !== activeId) useConfigStore.setState({ configSelection: { tab: activeId } });
        const scope = new PluginScope();
        setView({ tabId: activeId, scope });
        return () => {
            scope.cancel();
            void scope.close().catch((error) => console.error("[settings] view cleanup failed", error));
        };
    }, [open, activeId]);
    const scripts = useCallScriptStore((state) => state.scripts);
    const removedBuiltinIds = useCallScriptStore((state) => state.removedBuiltinIds);
    const pluginScripts = useCallScriptStore((state) => state.pluginScripts);
    const configIssue = configModel !== null ? getModelConfigIssue(config, configModel, listCallScripts(scripts, removedBuiltinIds, pluginScripts)) : null;

    const loadConfigFile = async (file: File) => {
        if (!view || view.scope.signal.aborted) return;
        try {
            await importAppConfig(file);
            if (view.scope.signal.aborted) return;
            useConfigStore.setState({ configSelection: { tab: "builtin:channels" } });
            toast.success("配置与用户偏好已导入", workbenchMessageOptions.success);
        } catch {
            if (!view.scope.signal.aborted) toast.error("配置文件读取失败", workbenchMessageOptions.error);
        }
    };

    const configNotice = configIssue ? (
        <div role="alert" className={`${styles.settingsWarning} mb-5 flex gap-3 rounded-xl border px-4 py-3`}>
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-(--channel-warning)" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-base font-semibold">暂时无法生成</span>
                        {configModel ? <span className="min-w-0 text-xs text-(--channel-secondary) [overflow-wrap:anywhere]">{`本次模型：${modelOptionLabel(config, configModel)}`}</span> : null}
                    </div>
                    <p className="m-0 mt-1 text-sm leading-6 [overflow-wrap:anywhere]">{configIssue.message}</p>
                </div>
                {configIssue.channelId ? <Button type="button" variant="ghost" size="xs" className="shrink-0 self-start sm:self-center" onClick={() => useConfigStore.setState({ configSelection: { tab: "builtin:channels", channelId: configIssue.channelId!, groupId: configIssue.groupId } })}><Pencil aria-hidden className="size-3.5" />编辑此分组</Button> : null}
            </div>
        </div>
    ) : null;

    const ready = view?.tabId === activeId && !view.scope.signal.aborted ? view : undefined;
    const content = ready ? <current.Content signal={ready.scope.signal} /> : null;

    return <Tabs.Root orientation="vertical" className="flex h-[min(740px,calc(100dvh_-_128px))] min-h-0" value={activeId} onValueChange={(tab) => useConfigStore.setState({ configSelection: { tab } })}>
        <div className="flex w-16 min-h-0 shrink-0 flex-col border-r border-(--channel-line) px-2 py-4 sm:w-42 sm:px-3 sm:py-5 lg:w-44">
            <Tabs.List aria-label="设置页签" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {appTabs.map((tab) => <Tabs.Trigger key={tab.id} value={tab.id} title={tab.title} className={styles.settingsTab}>
                    {tab.icon}<span className="sr-only sm:not-sr-only">{tab.title}</span>
                </Tabs.Trigger>)}
            </Tabs.List>
            <div className="mt-4 shrink-0 border-t border-(--channel-line) pt-3">
                <div className="grid grid-cols-2 sm:gap-1">
                    <Button type="button" variant="ghost" className="h-9 min-w-0 px-1 sm:px-2" title="导入配置" aria-label="导入配置" onClick={() => configInputRef.current?.click()}><Upload aria-hidden className="size-4" /><span className="hidden sm:inline">导入</span></Button>
                    <Button type="button" variant="ghost" className="h-9 min-w-0 px-1 sm:px-2" title="导出配置" aria-label="导出配置" onClick={() => {
                        void exportAppConfig().catch(() => { if (view && !view.scope.signal.aborted) toast.error("配置导出失败，请重试", workbenchMessageOptions.error); });
                    }}><Download aria-hidden className="size-4" /><span className="hidden sm:inline">导出</span></Button>
                </div>
                <p className="m-0 hidden pt-2 text-center text-xs leading-5 whitespace-nowrap text-(--channel-tertiary) sm:block">含密钥，请妥善保管</p>
            </div>
        </div>
        <Tabs.Content key={activeId} value={activeId} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {current.page ? <>
                {configNotice ? <div className="shrink-0 px-4 pt-4">{configNotice}</div> : null}
                {content}
            </> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:px-8">
                <h2 className="m-0 mb-6 text-base font-semibold">{current.title}</h2>
                {configNotice}
                {content}
            </div>}
        </Tabs.Content>
        <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void loadConfigFile(file);
        }} />
    </Tabs.Root>;
}

export function AppConfigModal({ noticeOpen }: { noticeOpen: boolean }) {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const returnFocus = useRef<HTMLElement | null>(null);
    const dialog = useRef<HTMLDivElement>(null);
    return <Dialog.Root open={isConfigOpen} onOpenChange={(next) => {
        if (next || noticeOpen) return;
        const { config, configModel, configSelection, shouldPromptContinue, clearPromptContinue, setConfigDialogOpen } = useConfigStore.getState();
        setConfigDialogOpen(false);
        void Promise.all([channelWrites.flush(), workspaceConfigWrites.flush()]).then(() => {
            const current = useConfigStore.getState();
            if (!current.isConfigOpen && current.configSelection === configSelection && shouldPromptContinue && configModel !== null && !getModelConfigIssue(config, configModel)) toast.success("配置已保存，请继续刚才的请求", workbenchMessageOptions.success);
        }).catch(() => undefined);
        clearPromptContinue();
    }}>
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-black/45 px-2">
                <Dialog.Content ref={dialog} aria-describedby={undefined} className={`${styles.settings} ${styles.channels} workbench-dialog relative w-full max-w-[1320px] rounded-2xl bg-(--workbench-elevated-panel) text-(--workbench-elevated-text) outline-none`}
                    onOpenAutoFocus={() => { if (document.activeElement instanceof HTMLElement && !dialog.current?.contains(document.activeElement)) returnFocus.current = document.activeElement; }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (useConfigStore.getState().isConfigOpen) return;
                        const target = returnFocus.current;
                        returnFocus.current = null;
                        if (target?.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) target.focus({ preventScroll: true });
                    }}
                    onEscapeKeyDown={(event) => {
                        const target = event.target instanceof Element ? event.target : null;
                        const owner = target?.closest('[role="dialog"]');
                        if (noticeOpen || (owner && owner !== dialog.current) || target?.closest('[role="combobox"][aria-expanded="true"]')) event.preventDefault();
                        else event.stopPropagation();
                    }}
                    onPointerDownOutside={(event) => { if (noticeOpen) event.preventDefault(); }}>
                    <header className="flex items-center justify-between border-b border-(--channel-line) py-[18px] pr-3 pl-6">
                        <Dialog.Title className="m-0 text-base leading-6 font-semibold">设置</Dialog.Title>
                        <Dialog.Close aria-label="关闭" className="absolute top-3.5 right-3.5 grid size-8 cursor-pointer place-items-center rounded text-(--channel-tertiary) hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></Dialog.Close>
                    </header>
                    {isConfigOpen && <AppConfigPanel />}
                </Dialog.Content>
            </Dialog.Overlay>
        </Dialog.Portal>
    </Dialog.Root>;
}

