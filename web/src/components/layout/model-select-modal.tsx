import { App, Button, Checkbox, Input, Modal, Segmented, Tabs } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { capabilityFromModalities, type CatalogModel } from "@/lib/model-catalog";
import { formatModelPrice } from "@/lib/model-pricing";
import { channelSupportsKeylessCatalog, fetchChannelCatalog } from "@/lib/provider-presets";
import { guessCapability, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type CapabilityFilter = ModelCapability | "all";

// Channel model selector: fetch upstream models or add them manually, then include checked models in the channel list.
export function ModelSelectModal({ open, channel, selectedNames, onConfirm, onClose }: { open: boolean; channel: ModelChannel | null; selectedNames: string[]; onConfirm: (models: Array<string | CatalogModel>) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [existing, setExisting] = useState<string[]>([]);
    const [fetched, setFetched] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState("new");
    const [search, setSearch] = useState("");
    const [manual, setManual] = useState("");
    const [loading, setLoading] = useState(false);
    /** Metadata (modalities, pricing) keyed by model id, kept so a confirmed selection carries it forward. */
    const [catalog, setCatalog] = useState<Map<string, CatalogModel>>(new Map());
    const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all");

    useEffect(() => {
        if (!open) return;
        setExisting(selectedNames);
        setFetched([]);
        setSelected(new Set(selectedNames));
        setActiveTab(selectedNames.length ? "existing" : "new");
        setSearch("");
        setManual("");
        setCapabilityFilter("all");
    }, [open, selectedNames]);

    /** Capability we would store for a model id, mirroring normalizeChannelModels. */
    const capabilityOf = (name: string): ModelCapability => capabilityFromModalities(catalog.get(name)?.outputModalities) || guessCapability(name);

    const currentList = activeTab === "new" ? fetched : existing;
    const visibleList = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        const bySearch = keyword ? currentList.filter((name) => name.toLowerCase().includes(keyword)) : currentList;
        if (capabilityFilter === "all") return bySearch;
        return bySearch.filter((name) => (capabilityFromModalities(catalog.get(name)?.outputModalities) || guessCapability(name)) === capabilityFilter);
    }, [capabilityFilter, catalog, currentList, search]);
    const visibleSelectedCount = visibleList.filter((name) => selected.has(name)).length;

    const toggle = (name: string, checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });

    const selectVisible = (checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            visibleList.forEach((name) => (checked ? next.add(name) : next.delete(name)));
            return next;
        });

    const addManual = () => {
        const name = manual.trim();
        if (!name) return;
        if (!fetched.includes(name) && !existing.includes(name)) setFetched((current) => [name, ...current]);
        setSelected((current) => new Set(current).add(name));
        setManual("");
        setActiveTab("new");
    };

    const fetchModels = async () => {
        if (!channel) return;
        const keylessFetch = channelSupportsKeylessCatalog(channel);
        if (!keylessFetch && (!channel.baseUrl.trim() || !channel.apiKey.trim())) {
            message.error(t("config.modelSelect.missingConfig"));
            return;
        }
        setLoading(true);
        try {
            const models = await fetchChannelCatalog(channel);
            setCatalog(new Map(models.map((model) => [model.id, model])));
            setFetched(models.map((model) => model.id));
            setActiveTab("new");
            message.success(t("config.modelSelect.fetched", { count: models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.modelSelect.fetchFailed"));
        } finally {
            setLoading(false);
        }
    };

    const confirm = () => {
        const ordered = [...existing, ...fetched].filter((name, index, list) => list.indexOf(name) === index).filter((name) => selected.has(name));
        // Hand back the catalog entry where we have one, so declared modalities and pricing are stored.
        onConfirm(ordered.map((name) => catalog.get(name) || name));
        onClose();
    };

    return (
        <Modal
            open={open}
            width={880}
            centered
            onCancel={onClose}
            title={
                <span>
                    {t("config.modelSelect.title")} <span className="ml-2 text-xs font-normal text-stone-500">{t("config.modelSelect.selected", { selected: selected.size, total: new Set([...existing, ...fetched]).size })}</span>
                </span>
            }
            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    {t("common.cancel")}
                </Button>,
                <Button key="confirm" type="primary" onClick={confirm}>
                    {t("config.modelSelect.confirm")}
                </Button>,
            ]}
        >
            <div className="flex flex-wrap items-center gap-3">
                <Input className="min-w-[200px] flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("config.modelSelect.search")} prefix={<Search className="size-4 text-stone-400" />} allowClear />
                <Input className="min-w-[180px] flex-1" value={manual} onChange={(event) => setManual(event.target.value)} onPressEnter={addManual} placeholder={t("config.modelSelect.modelName")} />
                <Button onClick={addManual}>{t("config.modelSelect.add")}</Button>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void fetchModels()}>
                    {t("config.modelSelect.fetch")}
                </Button>
            </div>
            <div className="mt-2 text-xs text-stone-500">{t("config.modelSelect.description")}</div>

            <Tabs
                className="mt-3"
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    { key: "new", label: t("config.modelSelect.fetchedTab", { count: fetched.length }) },
                    { key: "existing", label: t("config.modelSelect.existingTab", { count: existing.length }) },
                ]}
            />

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Segmented
                    size="small"
                    value={capabilityFilter}
                    onChange={(value) => setCapabilityFilter(value as CapabilityFilter)}
                    options={(["all", "image", "video", "text", "audio"] as CapabilityFilter[]).map((value) => ({
                        label: value === "all" ? t("config.modelSelect.filterAll") : t(`config.channelEditor.capabilities.${value}`),
                        value,
                    }))}
                />
                <span className="text-xs text-stone-500">{t("config.modelSelect.visibleSelected", { selected: visibleSelectedCount, total: visibleList.length })}</span>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        {t("config.modelSelect.selectVisible")}
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        {t("config.modelSelect.clearVisible")}
                    </Button>
                </div>
            </div>

            {visibleList.length ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                    {visibleList.map((name) => {
                        const price = formatModelPrice(catalog.get(name)?.pricing, capabilityOf(name));
                        return (
                            <Checkbox key={name} checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)} className="min-w-0">
                                <span className="flex min-w-0 items-baseline gap-2">
                                    <span className="min-w-0 flex-1 truncate" title={name}>
                                        {name}
                                    </span>
                                    {price ? <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">{price}</span> : null}
                                </span>
                            </Checkbox>
                        );
                    })}
                </div>
            ) : (
                <div className="py-8 text-center text-sm text-stone-500">{t(activeTab === "new" ? "config.modelSelect.fetchedEmpty" : "config.modelSelect.existingEmpty")}</div>
            )}
        </Modal>
    );
}
