import { usePluginStore } from "@workbench/stores/use-plugin-store";
import type { ChannelModel, ModelChannel, ModelGroup, ModelListFormat } from "@infinite-canvas/shared/channels";
import { ModelExecutionError, modelErrorMessages } from "@infinite-canvas/shared/model-http";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { modelCapabilityLabels } from "@workbench/constant/labels";
import { Button as SettingsButton } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input as SettingsInput } from "@infinite-canvas/plugin-sdk/ui/input";
import { ChevronRight, CircleAlert, CircleX, CodeXml, LoaderCircle, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ModelIcon } from "@workbench/components/model-icon";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { defaultCallScriptId, detectChannelModel } from "@workbench/lib/model-utils";
import { channels } from "@workbench/services/channels/runtime";
import { channelWrites, createModelGroup, useConfigStore } from "@workbench/stores/use-config-store";
import { listCallScripts, useCallScriptStore } from "@workbench/stores/use-call-script-store";
import { modelCapabilities } from "@infinite-canvas/shared/models";
import { ModelCallSelectModal } from "./model-call-select-modal";
import { ModelSelectModal, type FetchedModelList } from "./model-select-modal";
import { ChannelRemoveConfirmation } from "./channel-remove-confirmation";
import { ChannelSegments } from "./channel-segments";
import { SettingsPasswordInput } from "./settings-network-controls";
import styles from "./app-config-modal.module.css";

export function ChannelEditorPanel({ channel, groupId, onChange, newChannel, sponsors }: { channel: ModelChannel; groupId?: string; onChange: (channel: ModelChannel) => void; newChannel?: boolean; sponsors?: ReactNode }) {
    usePluginStore((state) => state.revision);
    const savedScripts = useCallScriptStore((state) => state.scripts);
    const removedBuiltinIds = useCallScriptStore((state) => state.removedBuiltinIds);
    const pluginScripts = useCallScriptStore((state) => state.pluginScripts);
    const scripts = listCallScripts(savedScripts, removedBuiltinIds, pluginScripts);
    const [search, setSearch] = useState("");
    const searchInput = useRef<HTMLInputElement>(null);
    const [selected, setSelected] = useState(() => new Set<string>());
    const [manual, setManual] = useState("");
    const [listFormat, setListFormat] = useState<ModelListFormat>("openai");
    const [loading, setLoading] = useState(false);
    const [fetched, setFetched] = useState<FetchedModelList | null>(null);
    const request = useRef<AbortController | null>(null);
    const [callTarget, setCallTarget] = useState<{ model: ChannelModel; trigger: HTMLButtonElement } | null>(null);
    const group = channel.groups.find((item) => item.id === groupId);
    const keyInputId = useId();
    const [keyDraft, setKeyDraft] = useState<string>();
    const visibleModels = group?.models.filter((model) => model.name.toLowerCase().includes(search.toLowerCase()));
    const selectedCount = visibleModels?.filter((model) => selected.has(model.name)).length;

    useEffect(() => {
        setFetched(null);
        setLoading(false);
        return () => request.current?.abort();
    }, [channel.baseUrl]);

    const fetchButton = useRef<HTMLButtonElement>(null);
    const autoFetch = useConfigStore((state) => state.autoFetchGroupId === groupId);
    useEffect(() => {
        if (!autoFetch || !fetchButton.current) return;
        useConfigStore.setState({ autoFetchGroupId: null });
        void fetchModels(fetchButton.current);
    }, [autoFetch]);

    const patchGroup = (value: Partial<ModelGroup>) => {
        if (value.apiKey !== undefined) {
            request.current?.abort();
            setFetched(null);
            setLoading(false);
        }
        onChange({ ...channel, groups: group ? channel.groups.map((item) => item.id === groupId ? { ...item, ...value } : item) : [createModelGroup({ name: "默认分组", ...value })] });
    };
    const updateModel = (model: ChannelModel) => patchGroup({ models: group!.models.map((current) => current.name === model.name ? model : current) });
    const selectModels = (names: string[], checked: boolean) => {
        setSelected((current) => {
            const next = new Set(current);
            names.forEach((name) => checked ? next.add(name) : next.delete(name));
            return next;
        });
    };
    const removeModels = (names: Set<string>) => {
        patchGroup({ models: group!.models.filter((model) => !names.has(model.name)) });
        setSelected((current) => new Set([...current].filter((name) => !names.has(name))));
    };
    const addModels = (names: string[]) => {
        const current = useConfigStore.getState().config.channels.find((item) => item.id === channel.id)!;
        onChange({ ...current, groups: current.groups.map((item) => item.id === groupId ? { ...item, models: [...item.models, ...names.filter((name) => !item.models.some((model) => model.name === name)).map(detectChannelModel)] } : item) });
        setSearch("");
    };
    const addManual = () => {
        if (!manual) return;
        addModels([manual]);
        setManual("");
    };
    const fetchModels = async (trigger: HTMLButtonElement) => {
        if (!channel.baseUrl || (!group?.apiKey && !group?.hasApiKey)) {
            toast.error("请先填写渠道服务地址和此分组的 API Key", workbenchMessageOptions.error);
            return;
        }
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        try {
            await channelWrites.flush();
            const models = [...new Set(await channels.listModels(channel, group!, listFormat, controller.signal))];
            if (controller.signal.aborted) return;
            if (!models.length) {
                toast.info("未获取到可用模型", workbenchMessageOptions.info);
            } else if (models.length > 5) {
                setFetched({ models, trigger, signal: controller.signal });
            } else {
                addModels(models);
                toast.success(`已拉取 ${models.length} 个模型`, workbenchMessageOptions.success);
            }
        } catch (error) {
            if (!controller.signal.aborted) toast.error(error instanceof ModelExecutionError ? modelErrorMessages[error.code] : error instanceof StorageError ? error.message : modelErrorMessages.MODEL_LIST_FAILED, workbenchMessageOptions.error);
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    };

    const keyField = <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex h-6 items-center">
            <label htmlFor={keyInputId} className="text-xs font-medium">API Key</label>
        </div>
        <SettingsPasswordInput id={keyInputId} label="密钥" value={keyDraft ?? group?.apiKey ?? ""} onChange={(event) => setKeyDraft(event.target.value)} onBlur={() => {
            if (keyDraft !== undefined && keyDraft !== (group?.apiKey ?? "")) patchGroup({ apiKey: keyDraft, hasApiKey: Boolean(keyDraft) });
            setKeyDraft(undefined);
        }} placeholder={group?.hasApiKey ? "已保存，输入新密钥可替换" : "填写此分组的密钥"} />
    </div>;
    const formatControl = <div className="flex shrink-0 items-center gap-2">
        <span className="whitespace-nowrap text-(--channel-secondary)">列表格式</span>
        <Select value={listFormat} onValueChange={(value) => setListFormat(value as ModelListFormat)} disabled={loading}>
            <SelectTrigger aria-label="列表格式" className={`${styles.channelSelect} w-40 flex-none!`}><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="openai">/v1/models</SelectItem>
                <SelectItem value="gemini">/v1beta/models</SelectItem>
            </SelectContent>
        </Select>
    </div>;
    const fetchControl = <SettingsButton ref={fetchButton} type="button" className="shrink-0" variant="ghost" aria-disabled={loading} aria-busy={loading} onClick={(event) => { if (!loading) void fetchModels(event.currentTarget); }}>
        {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}拉取模型列表
    </SettingsButton>;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {newChannel ? (
                    <div className="channel-models settings-network generation-workspace-controls flex min-h-0 flex-1 flex-col gap-4 max-lg:flex-none">
                        <div className="flex flex-wrap items-end gap-3">
                            {keyField}
                            {formatControl}
                            {fetchControl}
                        </div>
                        {sponsors}
                    </div>
                ) : group ? (
                    <div className="channel-models settings-network generation-workspace-controls flex min-h-0 flex-1 flex-col gap-4 max-lg:flex-none">
                        <>
                            <div className="channel-connection settings-network generation-workspace-controls grid min-w-0 shrink-0 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                                <label className="grid min-w-0 gap-1.5 text-xs font-medium">
                                    <span className="flex h-6 items-center">分组名称</span>
                                    <SettingsInput className="settings-network-field text-sm! font-normal!" value={group.name} onChange={(event) => patchGroup({ name: event.target.value })} placeholder="例如：个人账号、团队账号" />
                                </label>
                                {keyField}
                            </div>
                            {group.models.length ? <div className="mt-2 flex shrink-0 flex-wrap items-center gap-3">
                                <span className="shrink-0 text-sm font-semibold">分组模型 <span className="ml-1 text-xs font-normal text-(--channel-secondary)">{group.models.length}</span></span>
                                <label className="flex shrink-0 items-center gap-2 pr-2 has-disabled:text-muted-foreground">
                                    <input type="checkbox" className="workbench-checkbox size-4" checked={Boolean(visibleModels?.length && selectedCount === visibleModels.length)}
                                        ref={(input) => { if (input) input.indeterminate = Boolean(selectedCount && selectedCount !== visibleModels?.length); }}
                                        disabled={!visibleModels?.length} onChange={(event) => selectModels(visibleModels!.map((model) => model.name), event.target.checked)} />全选当前列表
                                </label>
                                <div className="settings-network-field ml-auto flex min-w-32 max-w-56 flex-1 items-center gap-1">
                                    <Search aria-hidden className="size-4 shrink-0 text-(--channel-tertiary)" />
                                    <SettingsInput ref={searchInput} aria-label="搜索分组模型" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型" />
                                    <button type="button" className={search ? undefined : "invisible"} aria-label="清空搜索" onClick={() => { setSearch(""); searchInput.current?.focus(); }}><CircleX aria-hidden className="size-3" /></button>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    {selected.size ? <SettingsButton type="button" variant="ghost" size="xs" onClick={() => setSelected(new Set())}>取消选择</SettingsButton> : null}
                                    <ChannelRemoveConfirmation question={`移除选中的 ${selected.size} 个模型？`} action="移除" fallbackFocus={searchInput} onConfirm={() => removeModels(selected)}>
                                        <SettingsButton type="button" variant="ghost" size="xs" className={styles.channelDelete} disabled={!selected.size}><Trash2 aria-hidden className="size-3.5" />批量移除{selected.size ? `（${selected.size}）` : ""}</SettingsButton>
                                    </ChannelRemoveConfirmation>
                                </div>
                            </div> : null}
                            <div className="flex shrink-0 flex-wrap items-center gap-3">
                                <SettingsInput className="settings-network-field min-w-0 flex-1" aria-label="输入模型名称" value={manual} onChange={(event) => setManual(event.target.value)}
                                    onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) addManual(); }} placeholder="输入模型名称" />
                                <SettingsButton type="button" className="shrink-0" variant="ghost" disabled={!manual} onClick={addManual}><Plus aria-hidden className="size-4" />增加模型</SettingsButton>
                                {formatControl}
                                {fetchControl}
                            </div>
                            {group.models.length ? <div className="thin-scrollbar grid min-h-0 min-w-0 flex-1 content-start gap-2 overflow-auto overscroll-contain">
                                {visibleModels?.length ? visibleModels.map((model) => {
                                    const script = scripts.find((item) => item.id === (model.scriptId ?? defaultCallScriptId(model.name, model.capability)) && item.capability === model.capability);
                                    return (
                                        <article key={model.name} className="grid min-w-[32rem] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border border-(--channel-line) px-3 py-2.5">
                                            <span className="flex min-w-0 items-center gap-2.5">
                                                <input type="checkbox" className="workbench-checkbox size-4 shrink-0" aria-label={`选择模型 ${model.name}`} checked={selected.has(model.name)} onChange={(event) => selectModels([model.name], event.target.checked)} />
                                                <ModelIcon model={model.name} className="size-5" />
                                                <span className="min-w-0 truncate text-sm font-semibold" title={model.name}>{model.name}</span>
                                            </span>
                                            <SettingsButton type="button" size="xs" variant="ghost" className="min-w-0 justify-start" style={script ? undefined : { color: "var(--channel-warning)" }} aria-haspopup="dialog" aria-label={`${model.name} 选择调用方式`} title={script?.name ?? "选择调用方式"} onClick={(event) => setCallTarget({ model, trigger: event.currentTarget })}>
                                                {script?.logo ? <img src={script.logo} alt="" className={`size-4 shrink-0 object-contain ${script.invertInDark ? "dark:invert" : ""}`} /> : script ? <CodeXml aria-hidden="true" className="size-4 shrink-0" /> : <CircleAlert aria-hidden="true" className="size-4 shrink-0" />}
                                                <span className="min-w-0 flex-1 truncate text-left text-xs">{script?.name ?? "选择调用方式"}</span>
                                                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
                                            </SettingsButton>
                                            <ChannelSegments label={`${model.name} 的用途`} options={modelCapabilities} labels={modelCapabilityLabels} value={model.capability} onChange={(capability) => updateModel({ ...model, capability, scriptId: defaultCallScriptId(model.name, capability) })} />
                                            <ChannelRemoveConfirmation question={`移除模型「${model.name}」？`} action="移除" fallbackFocus={searchInput} onConfirm={() => removeModels(new Set([model.name]))}>
                                                <SettingsButton type="button" variant="ghost" size="xs" className={styles.channelDelete} aria-label={`移除模型 ${model.name}`}><Trash2 aria-hidden className="size-3.5" />移除</SettingsButton>
                                            </ChannelRemoveConfirmation>
                                        </article>
                                    );
                                }) : <div className="py-8 text-center text-xs text-(--channel-secondary)">没有匹配的模型，请调整搜索词。</div>}
                            </div> : <div className="py-6 text-center text-xs text-(--channel-secondary)">填写 API Key 后点击「拉取模型列表」，拉取到的模型会显示在这里；也可以直接输入模型名称添加。</div>}
                        </>
                    </div>
                ) : <div className="py-8 text-center text-sm text-(--channel-secondary)">选择或新增 Key 分组，填写密钥并管理模型。</div>}
            </div>
            {fetched && group ? <ModelSelectModal group={group} {...fetched} onConfirm={addModels} onClose={() => setFetched(null)} /> : null}
            {callTarget ? <ModelCallSelectModal {...callTarget} onSelect={updateModel} onClose={() => setCallTarget(null)} /> : null}
        </div>
    );
}
