import { App, Button, Form, Input, Modal, Progress, Select, Tabs } from "antd";
import type { TFunction } from "i18next";
import { Cloud, Download, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { CanvasProviderModelPicker } from "@/components/canvas/canvas-provider-model-picker";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigLocalProxy } from "@/components/layout/config-local-proxy";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import type { AppLocale } from "@/i18n";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import {
    createModelChannel,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    selectableModelsByCapability,
    useConfigStore,
    type AiConfig,
    type ApiCallFormat,
    type ConfigTabKey,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";
import { useCanvasAccountStore } from "@/stores/use-canvas-account-store";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

type WebdavDomainProgress = {
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const canvasAccountStatus = useCanvasAccountStore((state) => state.status);
    const canvasAccount = useCanvasAccountStore((state) => state.account);
    const canvasProviders = useCanvasProviderStore((state) => state.providers);
    const canvasCatalog = useCanvasProviderStore((state) => state.catalog);
    const canvasProviderStatus = useCanvasProviderStore((state) => state.status);
    const canvasProviderError = useCanvasProviderStore((state) => state.error);
    const selectedCanvasProviderId = useCanvasProviderStore((state) => state.selectedProviderId);
    const canvasProviderModels = useCanvasProviderStore((state) => state.modelsByProvider);
    const modelsLoadingProviderId = useCanvasProviderStore((state) => state.modelsLoadingProviderId);
    const selectCanvasProvider = useCanvasProviderStore((state) => state.select);
    const loadCanvasProviders = useCanvasProviderStore((state) => state.load);
    const loadCanvasCatalog = useCanvasProviderStore((state) => state.loadCatalog);
    const loadCanvasModels = useCanvasProviderStore((state) => state.loadModels);
    const createCanvasProvider = useCanvasProviderStore((state) => state.create);
    const updateCanvasProvider = useCanvasProviderStore((state) => state.update);
    const [selectedCatalogKeyId, setSelectedCatalogKeyId] = useState("");
    const [canvasProviderName, setCanvasProviderName] = useState("");
    const [canvasProviderSource, setCanvasProviderSource] = useState<"sub2api" | "direct">("sub2api");
    const [canvasProviderBaseUrl, setCanvasProviderBaseUrl] = useState("");
    const [canvasProviderSecret, setCanvasProviderSecret] = useState("");
    const [savingCanvasProvider, setSavingCanvasProvider] = useState(false);
    const locale = i18n.resolvedLanguage as AppLocale;
    useEffect(() => setActiveTab(initialTab), [initialTab]);

    useEffect(() => {
        if (activeTab !== "channels" || canvasAccountStatus !== "authenticated") return;
        void loadCanvasProviders();
        void loadCanvasCatalog();
    }, [activeTab, canvasAccountStatus, loadCanvasCatalog, loadCanvasProviders]);

    useEffect(() => {
        if (canvasAccountStatus !== "authenticated" || !selectedCanvasProviderId || canvasProviderModels[selectedCanvasProviderId]) return;
        void loadCanvasModels(selectedCanvasProviderId).catch(() => undefined);
    }, [canvasAccountStatus, canvasProviderModels, loadCanvasModels, selectedCanvasProviderId]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "config.savedContinue" : "config.saved"));
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const saveCanvasProvider = async () => {
        const catalogKey = canvasCatalog?.keys.find((item) => item.id === selectedCatalogKeyId);
        if (canvasProviderSource === "sub2api" && !catalogKey) return;
        if (canvasProviderSource === "direct" && (!canvasProviderBaseUrl.trim() || !canvasProviderSecret.trim())) return;
        setSavingCanvasProvider(true);
        try {
            const provider = await createCanvasProvider({
                name: canvasProviderName.trim() || catalogKey?.name || new URL(canvasProviderBaseUrl).hostname,
                ...(canvasProviderSource === "sub2api" ? {
                    catalogKeyId: catalogKey?.id,
                    providerType: catalogKey?.providerType,
                    model: catalogKey?.model,
                    group: catalogKey?.group,
                    channel: catalogKey?.channel,
                } : {
                    providerType: "openai-compatible",
                    baseUrl: canvasProviderBaseUrl.trim(),
                    secret: canvasProviderSecret.trim(),
                }),
            });
            const models = await loadCanvasModels(provider.id);
            if (!provider.model && models[0]) await updateCanvasProvider(provider.id, { model: models[0] });
            setSelectedCatalogKeyId("");
            setCanvasProviderName("");
            setCanvasProviderBaseUrl("");
            setCanvasProviderSecret("");
            message.success(t("config.account.providerSaved", { defaultValue: "Provider saved" }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.account.providerSaveFailed", { defaultValue: "Provider could not be saved" }));
        } finally {
            setSavingCanvasProvider(false);
        }
    };

    const saveCanvasProviderModel = async (providerId: string, model: string) => {
        try {
            await updateCanvasProvider(providerId, { model });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Không thể lưu model nhà cung cấp");
        }
    };

    const addChannel = () => {
        const channel = createModelChannel({ name: t("config.channels.numberedName", { count: config.channels.length + 1 }) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.keepOne"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("config.webdav.available"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.webdav.testFailed"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus(t("config.webdav.preparing"));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(t("config.webdav.completed", { projects: result.projects, assets: result.assets, records: result.imageLogs + result.videoLogs, files: result.uploadedFiles, bytes: formatBytes(result.uploadedBytes) }));
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : t("config.webdav.failed"));
            message.error(error instanceof Error ? error.message : t("config.webdav.failed"));
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="text-xs text-stone-500">{t("config.fileSecurity")}</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>
                        {t("config.import")}
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={exportAppConfig}>
                        {t("config.export")}
                    </Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: t("config.tabs.channels"),
                        children: (
                            <div>
                                <section className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <ShieldCheck className="size-4" />
                                                {t("config.account.title", { defaultValue: "Canvas account" })}
                                            </div>
                                            {canvasAccountStatus === "authenticated" && canvasAccount ? (
                                                <div className="mt-1 text-xs text-stone-500">
                                                    {t("config.account.signedInAs", { defaultValue: "Signed in through Sub2API as {{name}}", name: canvasAccount.displayName })}
                                                    {canvasAccount.email ? ` · ${canvasAccount.email}` : ""}
                                                </div>
                                            ) : canvasAccountStatus === "loading" ? (
                                                <div className="mt-1 text-xs text-stone-500">{t("config.account.loading", { defaultValue: "Verifying Canvas session…" })}</div>
                                            ) : (
                                                <div className="mt-1 text-xs text-stone-500">{t("config.account.unauthenticated", { defaultValue: "Open Canvas from the Sub2API custom menu to sign in." })}</div>
                                            )}
                                        </div>
                                        {canvasAccountStatus === "authenticated" ? (
                                            <Button
                                                size="small"
                                                icon={<RefreshCw className="size-3.5" />}
                                                loading={canvasProviderStatus === "loading"}
                                                onClick={() => {
                                                    void loadCanvasProviders();
                                                    void loadCanvasCatalog();
                                                }}
                                            >
                                                {t("config.account.refresh", { defaultValue: "Refresh" })}
                                            </Button>
                                        ) : null}
                                    </div>
                                    {canvasAccountStatus === "authenticated" ? (
                                        <>
                                            {canvasProviderError ? (
                                                <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:text-red-300">
                                                    <span>{canvasProviderError}</span>
                                                    <Button
                                                        size="small"
                                                        icon={<RefreshCw className="size-3.5" />}
                                                        onClick={() => {
                                                            void loadCanvasProviders();
                                                            void loadCanvasCatalog();
                                                        }}
                                                    >
                                                        {t("common.retry")}
                                                    </Button>
                                                </div>
                                            ) : null}
                                            <div className="mt-3 text-xs font-medium text-stone-600 dark:text-stone-300">{t("config.account.savedProviders", { defaultValue: "Canvas providers" })}</div>
                                            {canvasProviders.length ? (
                                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                    <Form.Item label={t("config.account.providerLabel", { defaultValue: "Provider" })} className="mb-0">
                                                        <Select
                                                            className="w-full"
                                                            value={selectedCanvasProviderId || undefined}
                                                            options={canvasProviders.map((provider) => ({ value: provider.id, label: `${provider.name}${provider.maskedKey ? ` · ${provider.maskedKey}` : ""}` }))}
                                                            onChange={selectCanvasProvider}
                                                        />
                                                    </Form.Item>
                                                    <Form.Item label={t("config.account.modelLabel", { defaultValue: "Model" })} className="mb-0">
                                                        <Select
                                                            className="w-full"
                                                            value={canvasProviders.find((provider) => provider.id === selectedCanvasProviderId)?.model || undefined}
                                                            placeholder={t("config.account.selectModel", { defaultValue: "Select model" })}
                                                            loading={selectedCanvasProviderId ? modelsLoadingProviderId === selectedCanvasProviderId : false}
                                                            options={(selectedCanvasProviderId ? canvasProviderModels[selectedCanvasProviderId] || [] : []).map((model) => ({ value: model, label: model }))}
                                                            onDropdownVisibleChange={(open) => {
                                                                if (open && selectedCanvasProviderId && !canvasProviderModels[selectedCanvasProviderId]) void loadCanvasModels(selectedCanvasProviderId).catch(() => undefined);
                                                            }}
                                                            onChange={(model) => {
                                                                if (selectedCanvasProviderId) void saveCanvasProviderModel(selectedCanvasProviderId, model);
                                                            }}
                                                        />
                                                    </Form.Item>
                                                </div>
                                            ) : (
                                                <div className="mt-1 text-xs text-stone-500">{t("config.account.emptyProviders", { defaultValue: "No Canvas providers saved yet." })}</div>
                                            )}
                                            <div className="mt-3 grid gap-2 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                                                <Form.Item label="Nguồn" className="mb-0">
                                                    <Select className="w-full" value={canvasProviderSource} onChange={setCanvasProviderSource} options={[{ value: "sub2api", label: "Sub2API" }, { value: "direct", label: "Third-party" }]} />
                                                </Form.Item>
                                                {canvasProviderSource === "sub2api" ? <Form.Item label={t("config.account.selectKey", { defaultValue: "Sub2API API Key" })} className="mb-0">
                                                    <Select
                                                        className="w-full"
                                                        value={selectedCatalogKeyId || undefined}
                                                        placeholder={t("config.account.selectKeyPlaceholder", { defaultValue: "Choose a key" })}
                                                        loading={canvasProviderStatus === "loading"}
                                                        options={(canvasCatalog?.keys || []).map((item) => ({ value: item.id, label: `${item.name}${item.maskedKey ? ` · ${item.maskedKey}` : ""}` }))}
                                                        onChange={setSelectedCatalogKeyId}
                                                        notFoundContent={t("config.account.emptyCatalog", { defaultValue: "No API keys available" })}
                                                    />
                                                </Form.Item> : <Form.Item label="Endpoint API" className="mb-0"><Input value={canvasProviderBaseUrl} placeholder="https://api.example.com" onChange={(event) => setCanvasProviderBaseUrl(event.target.value)} /></Form.Item>}
                                                <Form.Item label={t("config.account.providerName", { defaultValue: "Provider name" })} className="mb-0">
                                                    <Input value={canvasProviderName} placeholder={t("config.channels.newName")} onChange={(event) => setCanvasProviderName(event.target.value)} />
                                                </Form.Item>
                                                {canvasProviderSource === "direct" ? <Form.Item label="API key" className="mb-0"><Input.Password value={canvasProviderSecret} placeholder="sk-..." onChange={(event) => setCanvasProviderSecret(event.target.value)} /></Form.Item> : null}
                                                <Button type="primary" disabled={canvasProviderSource === "sub2api" ? !selectedCatalogKeyId : !canvasProviderBaseUrl.trim() || !canvasProviderSecret.trim()} loading={savingCanvasProvider} onClick={() => void saveCanvasProvider()}>
                                                    {t("config.account.saveProvider", { defaultValue: "Save provider" })}
                                                </Button>
                                            </div>
                                            <div className="mt-5 border-t border-stone-200 pt-4 dark:border-stone-800">
                                                <div>
                                                    <div className="text-sm font-semibold">{t("config.account.studioDefaultsTitle", { defaultValue: "Studio defaults" })}</div>
                                                    <div className="mt-1 text-xs text-stone-500">
                                                        {t("config.account.studioDefaultsDescription", { defaultValue: "These choices are applied when a Studio opens for the first time. You can change the provider or model at any time inside Studio." })}
                                                    </div>
                                                </div>
                                                <div className="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
                                                    <div className="grid gap-3 py-3 first:pt-0 md:grid-cols-[minmax(9rem,0.55fr)_minmax(0,1.45fr)] md:items-center">
                                                        <div>
                                                            <div className="text-sm font-medium">{t("config.account.studioImageLabel", { defaultValue: "Image Studio" })}</div>
                                                            <div className="mt-1 text-xs text-stone-500">{t("config.account.studioImageDescription", { defaultValue: "Provider and model used for image generation." })}</div>
                                                        </div>
                                                        <CanvasProviderModelPicker capability="image" value={config.imageModel} showLabels onChange={(model) => updateConfig("imageModel", model)} />
                                                    </div>
                                                    <div className="grid gap-3 py-3 last:pb-0 md:grid-cols-[minmax(9rem,0.55fr)_minmax(0,1.45fr)] md:items-center">
                                                        <div>
                                                            <div className="text-sm font-medium">{t("config.account.studioVideoLabel", { defaultValue: "Video Studio" })}</div>
                                                            <div className="mt-1 text-xs text-stone-500">{t("config.account.studioVideoDescription", { defaultValue: "Provider and model used for video generation." })}</div>
                                                        </div>
                                                        <CanvasProviderModelPicker capability="video" value={config.videoModel} showLabels onChange={(model) => updateConfig("videoModel", model)} />
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    ) : null}
                                </section>
                                {canvasAccountStatus !== "authenticated" ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">{t("config.channels.description")}</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        {t("config.channels.add")}
                                    </Button>
                                </div> : null}
                                {canvasAccountStatus !== "authenticated" ? <div className="space-y-2">
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{channel.name || t("config.channels.unnamed")}</div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {apiFormatLabel(channel.apiFormat)} · {t("config.channels.modelCount", { count: channel.models.length })} · {channel.baseUrl || t("config.channels.missingUrl")}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                                    {t("common.edit")}
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                            </div>
                                        </div>
                                    ))}
                                </div> : null}
                            </div>
                        ),
                    },
                    {
                        key: "local-proxy",
                        label: t("config.tabs.localProxy"),
                        children: <ConfigLocalProxy />,
                    },
                    {
                        key: "preferences",
                        label: t("config.tabs.preferences"),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                {canvasAccountStatus !== "authenticated" ? <>
                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                </> : null}
                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.generation")}</div>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label={t("config.preferences.audioInstructions")} className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "prompt-sources",
                        label: t("config.tabs.promptSources"),
                        children: <ConfigPromptSources />,
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                {t("config.webdav.title")}
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">{t("config.webdav.description")}</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? t("config.webdav.lastSynced", { time: formatWebdavTime(webdav.lastSyncedAt, locale) }) : t("config.webdav.neverSynced")}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label={t("config.webdav.url")} className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.directory")} extra={t("config.webdav.directoryDescription", { manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.username")} className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.password")} className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            {t("config.webdav.test")}
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {t(syncingWebdav ? "config.webdav.syncing" : "config.webdav.syncNow")}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{syncStageLabel(webdavSyncStatus, t)}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} t={t} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "local-storage",
                        label: t("config.tabs.localStorage"),
                        children: <ConfigLocalStorage active={activeTab === "local-storage"} />,
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        {t("common.done")}
                    </Button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("config.modalDescription")}</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    return "OpenAI";
}

function formatWebdavTime(value: string, locale: AppLocale) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress, t }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress>; t: TFunction }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t(`config.webdav.domains.${domainTranslationKey(key)}`)}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {syncStageLabel(item.stage, t)}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function domainTranslationKey(domain: AppSyncDomainKey) {
    if (domain === "image-workbench") return "imageWorkbench";
    if (domain === "video-workbench") return "videoWorkbench";
    return domain;
}

function syncStageLabel(stage: string, t: TFunction) {
    if (stage === "等待本地数据加载") return t("config.webdav.stages.localWaiting");
    if (stage === "同步完成") return t("config.webdav.stages.syncComplete");
    if (stage === "等待同步") return t("config.webdav.stages.waiting");
    if (stage === "读取远端清单") return t("config.webdav.stages.remoteManifest");
    if (stage === "读取本地数据") return t("config.webdav.stages.localData");
    if (stage === "下载缺失媒体") return t("config.webdav.stages.downloadMedia");
    if (stage === "写入本地合并结果") return t("config.webdav.stages.writeMerge");
    if (stage === "上传新增媒体") return t("config.webdav.stages.uploadMedia");
    if (stage === "媒体已齐全") return t("config.webdav.stages.mediaReady");
    if (stage === "媒体无需上传") return t("config.webdav.stages.mediaSkipped");
    if (stage === "检查缺失媒体") return t("config.webdav.stages.checkMissingMedia");
    if (stage === "下载媒体") return t("config.webdav.stages.downloadMediaFile");
    if (stage === "检查本地媒体") return t("config.webdav.stages.checkLocalMedia");
    if (stage.startsWith("上传媒体 ")) return t("config.webdav.stages.uploadMediaFile", { size: stage.slice(5) });
    if (stage === "完成") return t("config.webdav.stages.complete");
    if (stage.startsWith("上传清单 ")) return t("config.webdav.stages.uploadManifest", { size: stage.slice(5) });
    return stage;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
