import type { ChannelModel } from "@infinite-canvas/shared/channels";
import { modelCapabilityLabels } from "@workbench/constant/labels";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Check, CircleX, CodeXml, Download, Pencil, Plus, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import { Dialog, DropdownMenu } from "radix-ui";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { defaultCallScriptId } from "@workbench/lib/model-utils";
import { builtinCallScripts } from "@infinite-canvas/model-runtime/call-scripts/builtin";
import { createCallScriptSource } from "@infinite-canvas/model-runtime/call-scripts/template";
import { callScriptsReady, listCallScripts, useCallScriptStore } from "@workbench/stores/use-call-script-store";
import { useConfigStore } from "@workbench/stores/use-config-store";
import { modelCapabilities, type CallScript, type ModelCapability } from "@infinite-canvas/shared/models";
import { ModelScriptEditor } from "./model-script-editor";
import { ChannelSegments } from "./channel-segments";
import { ChannelRemoveConfirmation } from "./channel-remove-confirmation";
import { ListEmpty } from "@workbench/components/ui/list-empty";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import styles from "./app-config-modal.module.css";

export function ModelCallSelectModal({ model, trigger, onSelect, onClose }: { model: ChannelModel; trigger: HTMLButtonElement; onSelect: (model: ChannelModel) => void; onClose: () => void }) {
    const saved = useCallScriptStore((state) => state.scripts);
    const removedBuiltinIds = useCallScriptStore((state) => state.removedBuiltinIds);
    const pluginScripts = useCallScriptStore((state) => state.pluginScripts);
    const channels = useConfigStore((state) => state.config.channels);
    const [category, setCategory] = useState<"all" | "builtin" | "plugin" | "custom">("all");
    const [capability, setCapability] = useState<ModelCapability>(model.capability);
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<CallScript | null>(null);
    const [transferring, setTransferring] = useState(false);
    const uploadRef = useRef<HTMLInputElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [panel, setPanel] = useState<HTMLDivElement | null>(null);
    const dismissed = useRef(false);
    const editorTrigger = useRef<HTMLButtonElement>(null);
    const activeView = useRef(false);
    useLayoutEffect(() => {
        activeView.current = true;
        return () => { activeView.current = false; };
    }, []);
    const dismiss = () => {
        dismissed.current = true;
        activeView.current = false;
        onClose();
    };
    useLayoutEffect(() => {
        if (editing || !editorTrigger.current) return;
        const origin = editorTrigger.current;
        editorTrigger.current = null;
        const active = document.activeElement;
        if (active === document.body || panel?.contains(active)) {
            (origin.isConnected ? origin : searchRef.current)?.focus({ preventScroll: true });
        }
    }, [editing, panel]);
    const options = listCallScripts(saved, removedBuiltinIds, pluginScripts);
    const sourceOf = (id: string) => builtinCallScripts.some((item) => item.id === id) ? "builtin" : pluginScripts.some((item) => item.id === id) ? "plugin" : "custom";
    const selected = model.scriptId ?? defaultCallScriptId(model.name, model.capability);
    const current = options.find((option) => option.id === selected && option.capability === model.capability);
    const visible = options.filter((option) => option.capability === capability && (category === "all" || sourceOf(option.id) === category) && `${option.name} ${option.description}`.toLowerCase().includes(search.toLowerCase()));

    const exportScripts = async (scripts: CallScript[]) => {
        setTransferring(true);
        try {
            const { createCallScriptArchive } = await import("@workbench/lib/call-script-archive");
            saveAs(await createCallScriptArchive(scripts), "call-scripts.zip");
        } catch {
            if (activeView.current) toast.error("脚本包导出失败，请检查 Logo 是否可读取后重试", workbenchMessageOptions.error);
        } finally {
            if (activeView.current) setTransferring(false);
        }
    };
    const importScripts = async (file: File) => {
        setTransferring(true);
        let scripts: CallScript[];
        try {
            await callScriptsReady;
            const { readCallScriptArchive } = await import("@workbench/lib/call-script-archive");
            scripts = await readCallScriptArchive(file);
        } catch {
            if (activeView.current) {
                toast.error("脚本包无法读取，请使用完整的脚本 ZIP 包", workbenchMessageOptions.error);
                setTransferring(false);
            }
            return;
        }
        if (!activeView.current) return;
        try {
            await useCallScriptStore.getState().importScripts(scripts);
            if (!activeView.current) return;
            setCategory("custom");
            setCapability(scripts[0].capability);
            setSearch("");
            toast.success(`已导入 ${scripts.length} 个脚本，请选择需要使用的调用方式`, workbenchMessageOptions.success);
        } catch {
            if (activeView.current) toast.error("脚本未导入，请重试", workbenchMessageOptions.error);
        } finally {
            if (activeView.current) setTransferring(false);
        }
    };
    const changeVisibility = async (id: string, restore: boolean) => {
        try {
            const directory = useCallScriptStore.getState();
            await (restore ? directory.restore(id) : directory.remove(id));
        } catch {
            if (activeView.current) toast.error("脚本列表未保存，请重试", workbenchMessageOptions.error);
        }
    };

    return (
        <Dialog.Root open onOpenChange={(next) => { if (!next) dismiss(); }}>
            <Dialog.Portal container={trigger.closest<HTMLElement>('[role="dialog"]')}>
                <Dialog.Overlay className="pointer-events-auto fixed inset-0 z-[1100] flex flex-col overflow-y-auto bg-black/45 p-2 md:px-4">
                    <Dialog.Content ref={setPanel} aria-describedby={undefined} className={`${styles.channels} model-call-picker workbench-dialog generation-workspace-controls settings-network relative m-auto w-full max-w-[880px] shrink-0 rounded-lg bg-(--workbench-elevated-panel) px-6 py-5 outline-none`}
                        onEscapeKeyDown={(event) => {
                            if (editing) event.preventDefault();
                            else event.stopPropagation();
                        }} onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            if (dismissed.current && trigger.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) trigger.focus({ preventScroll: true });
                        }}>
                        <Dialog.Close aria-label="关闭" className="absolute top-3 right-3 grid size-8 cursor-pointer place-items-center rounded text-(--channel-tertiary) hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></Dialog.Close>
                        <header className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pr-8">
                            <div className="flex min-w-48 flex-1 items-center gap-3">
                                <Dialog.Title className="shrink-0 text-base leading-6 font-semibold">选择调用方式</Dialog.Title>
                                <span className="min-w-0 truncate text-xs text-(--channel-secondary)" title={model.name}>{model.name}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 font-normal">
                                {removedBuiltinIds.length > 0 && <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild><Button type="button" size="xs" variant="ghost"><RotateCcw aria-hidden className="size-4" />恢复已隐藏的内置脚本</Button></DropdownMenu.Trigger>
                                    <DropdownMenu.Portal container={panel}>
                                        <DropdownMenu.Content align="start" sideOffset={4} className="workbench-dialog z-[1101] max-h-(--radix-dropdown-menu-content-available-height) max-w-[calc(100vw_-_16px)] overflow-y-auto rounded-lg bg-(--workbench-elevated-panel) p-1 shadow-lg" onEscapeKeyDown={(event) => event.stopPropagation()}>
                                            {builtinCallScripts.filter((item) => removedBuiltinIds.includes(item.id)).map((item) => <DropdownMenu.Item key={item.id} className="cursor-pointer rounded px-3 py-1.5 text-sm text-(--workbench-elevated-text) outline-none data-highlighted:bg-(--call-option-hover)" onSelect={() => void changeVisibility(item.id, true)}>{item.name}</DropdownMenu.Item>)}
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                </DropdownMenu.Root>}
                                <ChannelRemoveConfirmation question="只导入来源可信的脚本包" description="调用方式会在本机运行，可以读取所选渠道的密钥并访问网络。请确认脚本来自你信任的作者。" fallbackFocus={searchRef} onConfirm={() => uploadRef.current?.click()}>
                                    <Button type="button" size="xs" variant="ghost" disabled={transferring}><Upload aria-hidden className="size-4" />导入脚本包</Button>
                                </ChannelRemoveConfirmation>
                                <Button type="button" size="xs" variant="ghost" disabled={transferring || !options.length} onClick={() => void exportScripts(options)}><Download aria-hidden className="size-4" />导出全部</Button>
                            </div>
                        </header>
                        <div className="flex max-h-[65vh] flex-col gap-3">
                            <div className="flex shrink-0 flex-wrap items-center gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="shrink-0 text-xs text-(--channel-secondary)">模型类型</span>
                                    <ChannelSegments label="模型类型" options={modelCapabilities} labels={modelCapabilityLabels} value={capability} onChange={setCapability} />
                                </div>
                                <ChannelSegments label="调用方式分类" options={["all", "builtin", "plugin", "custom"] as const} labels={{ all: "全部", builtin: "内置", plugin: "插件", custom: "自定义" }} value={category} onChange={setCategory} />
                                <div className="settings-network-field flex min-w-40 flex-1 items-center gap-1">
                                    <Search aria-hidden className="size-3.5 shrink-0 text-(--channel-secondary)" />
                                    <Input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索调用方式或说明" aria-label="搜索调用方式或说明" />
                                    <button type="button" aria-label="清空搜索" className={search ? undefined : "invisible"} onClick={() => { setSearch(""); searchRef.current?.focus(); }}><CircleX aria-hidden className="size-3" /></button>
                                </div>
                            </div>
                            <input ref={uploadRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void importScripts(file);
                            }} />
                            <div className="thin-scrollbar min-h-0 overflow-y-auto py-1 pl-1 pr-2">
                                {!visible.length && <ListEmpty className="" text="没有找到匹配的调用方式，请调整关键词、分类或模型类型" />}
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {visible.map((option) => {
                                        const active = option.id === current?.id;
                                        const source = sourceOf(option.id), readonly = source !== "custom";
                                        const inUse = option.id === selected || channels.some((channel) => channel.groups.some((group) => group.models.some((item) => (item.scriptId ?? defaultCallScriptId(item.name, item.capability)) === option.id)));
                                        return <article key={option.id} data-active={active} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-(--channel-line) transition-colors duration-150 hover:bg-(--call-option-hover) data-[active=true]:bg-(--call-option-hover) motion-reduce:transition-none">
                                            <button type="button" aria-label={`使用${option.name}`} aria-pressed={active} disabled={!option.source} className="flex min-h-36 min-w-0 flex-1 cursor-pointer flex-col gap-3 rounded-t-xl p-4 text-left outline-(--channel-secondary) focus-visible:outline-1 focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { onSelect({ ...model, capability: option.capability, scriptId: option.id }); dismiss(); }}>
                                                <span className="flex w-full items-start gap-3">
                                                    {option.logo ? <img src={option.logo} alt="" className={`mt-0.5 size-6 shrink-0 object-contain ${option.invertInDark ? "dark:invert" : ""}`} /> : <CodeXml aria-hidden="true" className="mt-0.5 size-6 shrink-0" />}
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-[13px] font-semibold leading-5 [overflow-wrap:anywhere]">{option.name}</span>
                                                        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-(--channel-secondary)">
                                                            <span>{modelCapabilityLabels[option.capability]}</span><span aria-hidden="true">·</span><span>{{ builtin: "内置", plugin: "插件", custom: "自定义" }[source]}</span>
                                                        </span>
                                                    </span>
                                                </span>
                                                <span className="max-w-full text-xs leading-5 whitespace-pre-line text-(--channel-secondary) [overflow-wrap:anywhere]">{option.description}</span>
                                            </button>
                                            <div className="mx-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-(--channel-line) py-2">
                                                <span className="flex shrink-0 items-center gap-1 text-[11px] text-(--channel-secondary)">{active && <><Check aria-hidden="true" className="size-3.5" />当前使用</>}</span>
                                                <div className="-mr-1 ml-auto flex items-center gap-0.5">
                                                    <Button type="button" size="xs" variant="ghost" onClick={(event) => {
                                                        editorTrigger.current = event.currentTarget;
                                                        setEditing(readonly ? { ...option, id: nanoid(), name: `${option.name}（自定义）` } : option);
                                                    }}><Pencil aria-hidden className="size-3.5" />{readonly ? "另存修改" : "编辑"}</Button>
                                                    <Button type="button" size="xs" variant="ghost" className="w-6 px-0!" title="导出脚本" aria-label={`导出${option.name}`} disabled={transferring} onClick={() => void exportScripts([option])}><Download aria-hidden className="size-3.5" /></Button>
                                                    {source !== "plugin" && <ChannelRemoveConfirmation question={`删除「${option.name}」？`} description={inUse ? "有模型正在使用此脚本。删除后需要重新选择调用方式才能继续生成。" : undefined} fallbackFocus={searchRef} onConfirm={() => changeVisibility(option.id, false)}>
                                                        <Button type="button" size="xs" variant="ghost" className="w-6 px-0!" title="删除" aria-label="删除"><Trash2 aria-hidden className="size-3.5" /></Button>
                                                    </ChannelRemoveConfirmation>}
                                                </div>
                                            </div>
                                        </article>;
                                    })}
                                    <button type="button" className="col-span-full flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-(--channel-line) bg-transparent px-4 py-3 text-xs text-(--channel-secondary) transition-colors duration-150 hover:bg-(--call-option-hover) focus-visible:outline-1 focus-visible:outline-offset-[-2px] motion-reduce:transition-none" onClick={(event) => {
                                        editorTrigger.current = event.currentTarget;
                                        setEditing({ id: nanoid(), name: "", description: "", capability, source: createCallScriptSource(capability) });
                                    }}>
                                        <Plus className="size-4" aria-hidden="true" />
                                        <span>新增脚本</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <footer className="mt-3 flex justify-end"><Dialog.Close asChild><Button type="button" variant="outline" aria-label="取消">取 消</Button></Dialog.Close></footer>
                        {editing && panel && <ModelScriptEditor value={editing} modelName={model.name} container={panel} onSave={(script) => {
                            setEditing(null);
                            setCategory(builtinCallScripts.some((item) => item.id === script.id) ? "builtin" : "custom");
                            setCapability(script.capability);
                            setSearch("");
                            toast.success("脚本已保存，可在列表中选择使用", workbenchMessageOptions.success);
                        }} onClose={() => setEditing(null)} />}
                    </Dialog.Content>
                </Dialog.Overlay>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
