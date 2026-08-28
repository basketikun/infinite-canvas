import { App, Button, Drawer, Empty, Input, Segmented, Select, Space, Tag } from "antd";
import { ListPlus, Plug, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogModel } from "@/lib/model-catalog";
import { describeModelPrice, formatModelPrice } from "@/lib/model-pricing";
import { connectChannel } from "@/lib/provider-presets";
import { channelIsConnected, defaultBaseUrlForApiFormat, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type CapabilityFilter = ModelCapability | "all";

const CAPABILITIES: ModelCapability[] = ["image", "video", "text", "audio"];
/** The per-model list is for overrides, not for browsing 400 rows; keep what it renders short. */
const MODEL_LIST_LIMIT = 60;

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [filter, setFilter] = useState<CapabilityFilter>("all");
    const [search, setSearch] = useState("");
    // Fingerprint of the endpoint+key we already auto-imported, so re-renders while typing in
    // other fields cannot re-trigger the fetch.
    const autoConnectedRef = useRef("");
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = CAPABILITIES.map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
        if (!open) {
            autoConnectedRef.current = "";
            setFilter("all");
            setSearch("");
        }
    }, [open, channel]);

    const counts = useMemo(() => {
        const result: Record<ModelCapability, number> = { image: 0, video: 0, text: 0, audio: 0 };
        for (const model of draft?.models || []) result[model.capability] += 1;
        return result;
    }, [draft?.models]);

    const visibleModels = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return (draft?.models || []).filter((model) => (filter === "all" || model.capability === filter) && (!keyword || model.name.toLowerCase().includes(keyword)));
    }, [draft?.models, filter, search]);

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    /** Pull the provider's whole catalog. Which model to use is chosen in the studio pickers. */
    const connect = async (target: ModelChannel, silent = false) => {
        setConnecting(true);
        try {
            const models = await connectChannel(target);
            setDraft((current) => (current && current.id === target.id ? { ...current, models } : current));
            message.success(t("config.channelEditor.connected", { count: models.length }));
        } catch (error) {
            // A silent run is the automatic one; it must not shout at a user who is still typing a key.
            if (!silent) message.error(error instanceof Error ? error.message : t("config.channelEditor.connectFailed"));
        } finally {
            setConnecting(false);
        }
    };

    // Pasting a key is the whole setup step: import the catalog as soon as one is present.
    useEffect(() => {
        if (!open || !draft || connecting) return;
        const fingerprint = `${draft.id}:${draft.baseUrl.trim()}:${draft.apiKey.trim()}`;
        if (!channelIsConnected(draft) || autoConnectedRef.current === fingerprint) return;
        autoConnectedRef.current = fingerprint;
        void connect(draft, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, draft?.id, draft?.baseUrl, draft?.apiKey]);

    if (!draft) return null;

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    /** Manual additions, for providers with no /models endpoint. Configured models stay untouched. */
    const applySelection = (selection: Array<string | CatalogModel>) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        const idOf = (item: string | CatalogModel) => (typeof item === "string" ? item : item.id);
        setModels(selection.flatMap((item) => map.get(idOf(item)) || normalizeChannelModels([item])));
    };

    // An explicit choice here is authoritative and must survive reloads, so it is stamped as such.
    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability, capabilitySource: "user" as const } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>
            </div>

            <div className="mt-6 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                        <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                    </div>
                    <Button type="primary" icon={<Plug className="size-4" />} loading={connecting} disabled={!channelIsConnected(draft)} onClick={() => void connect(draft)}>
                        {t(draft.models.length ? "config.channelEditor.refresh" : "config.channelEditor.connect")}
                    </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {CAPABILITIES.map((capability) => (
                        <Tag key={capability} color={counts[capability] ? "processing" : "default"} className="m-0">
                            {t(`config.channelEditor.capabilities.${capability}`)} · {counts[capability]}
                        </Tag>
                    ))}
                </div>
                {channelIsConnected(draft) ? null : <div className="mt-3 text-xs text-amber-600 dark:text-amber-500">{t("config.channelEditor.needsKey")}</div>}
            </div>

            <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-2">
                <Segmented
                    size="small"
                    value={filter}
                    onChange={(value) => setFilter(value as CapabilityFilter)}
                    options={(["all", ...CAPABILITIES] as CapabilityFilter[]).map((value) => ({ label: value === "all" ? t("config.modelSelect.filterAll") : t(`config.channelEditor.capabilities.${value}`), value }))}
                />
                <div className="flex items-center gap-2">
                    <Input size="small" className="w-44" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("config.modelSelect.search")} prefix={<Search className="size-3.5 text-stone-400" />} allowClear />
                    <Button size="small" icon={<ListPlus className="size-3.5" />} onClick={() => setSelectOpen(true)}>
                        {t("config.channelEditor.addManually")}
                    </Button>
                </div>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {visibleModels.length ? (
                    <>
                        {visibleModels.slice(0, MODEL_LIST_LIMIT).map((model) => (
                            <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="min-w-0 truncate text-sm" title={model.label ? `${model.name} · ${model.label}` : model.name}>
                                        {model.name}
                                    </span>
                                    {formatModelPrice(model.pricing, model.capability) ? (
                                        <span className="truncate text-xs tabular-nums text-stone-500 dark:text-stone-400" title={describeModelPrice(model.pricing)}>
                                            {formatModelPrice(model.pricing, model.capability)}
                                        </span>
                                    ) : null}
                                </span>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                    <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                        {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                    </Button>
                                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                                </div>
                            </div>
                        ))}
                        {visibleModels.length > MODEL_LIST_LIMIT ? <div className="px-2 py-2 text-center text-xs text-stone-500">{t("config.channelEditor.listTruncated", { shown: MODEL_LIST_LIMIT, total: visibleModels.length })}</div> : null}
                    </>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-sm text-stone-500">{t(draft.models.length ? "config.channelEditor.noMatch" : "config.channelEditor.empty")}</span>} />
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
