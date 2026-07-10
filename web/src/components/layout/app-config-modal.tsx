import { App, Button, Form, Input, Modal, Progress, Select, Tabs } from "antd";
import { CircleAlert, Cloud, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { useMemo, useState } from "react";

import { useTranslation } from "@/components/layout/locale-provider";
import { ModelPicker } from "@/components/model-picker";
import type { TranslationKey } from "@/i18n";
import { formatLocaleDateTime } from "@/lib/format-locale";
import { fetchChannelModels } from "@/services/api/image";
import { syncAppDataToWebdav, APP_SYNC_STAGE, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { createModelChannel, defaultBaseUrlForApiFormat, filterModelsByCapability, modelOptionLabel, modelOptionsFromChannels, normalizeModelOptionValue, useConfigStore, type AiConfig, type ApiCallFormat, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import type { TranslateFn } from "@/i18n";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

type WebdavStageId =
    | "waitLocalData"
    | "syncDone"
    | "syncFailed"
    | "waiting"
    | "preparing"
    | "readingRemoteManifest"
    | "readingLocalData"
    | "downloadingMedia"
    | "writingLocalMerge"
    | "uploadingMedia"
    | "mediaComplete"
    | "mediaNoUpload"
    | "uploadingManifest"
    | "checkingMissingMedia"
    | "downloadingMediaProgress"
    | "checkingLocalMedia"
    | "uploadingMediaProgress"
    | "done"
    | "unknown";

const webdavStageSourceMap: Record<string, WebdavStageId> = {
    [APP_SYNC_STAGE.waitLocalData]: "waitLocalData",
    [APP_SYNC_STAGE.syncDone]: "syncDone",
    [APP_SYNC_STAGE.syncFailed]: "syncFailed",
    [APP_SYNC_STAGE.readingRemoteManifest]: "readingRemoteManifest",
    [APP_SYNC_STAGE.readingLocalData]: "readingLocalData",
    [APP_SYNC_STAGE.downloadingMedia]: "downloadingMedia",
    [APP_SYNC_STAGE.writingLocalMerge]: "writingLocalMerge",
    [APP_SYNC_STAGE.uploadingMedia]: "uploadingMedia",
    [APP_SYNC_STAGE.mediaComplete]: "mediaComplete",
    [APP_SYNC_STAGE.mediaNoUpload]: "mediaNoUpload",
    [APP_SYNC_STAGE.done]: "done",
    [APP_SYNC_STAGE.checkingMissingMedia]: "checkingMissingMedia",
    [APP_SYNC_STAGE.downloadingMediaProgress]: "downloadingMediaProgress",
    [APP_SYNC_STAGE.checkingLocalMedia]: "checkingLocalMedia",
};

const webdavStageTranslationKeys: Partial<Record<WebdavStageId, TranslationKey>> = {
    waitLocalData: "errors.appSync.waitLocalData",
    syncDone: "errors.appSync.syncDone",
    syncFailed: "errors.appSync.syncFailed",
    waiting: "config.webdav.stages.waiting",
    preparing: "config.webdav.stages.preparing",
    readingRemoteManifest: "config.webdav.stages.readingRemoteManifest",
    readingLocalData: "config.webdav.stages.readingLocalData",
    downloadingMedia: "config.webdav.stages.downloadingMedia",
    writingLocalMerge: "config.webdav.stages.writingLocalMerge",
    uploadingMedia: "config.webdav.stages.uploadingMedia",
    mediaComplete: "config.webdav.stages.mediaComplete",
    mediaNoUpload: "config.webdav.stages.mediaNoUpload",
    uploadingManifest: "config.webdav.stages.uploadingManifest",
    done: "errors.appSync.done",
    checkingMissingMedia: "errors.appSync.checkMissingMedia",
    downloadingMediaProgress: "errors.appSync.downloadMedia",
    checkingLocalMedia: "errors.appSync.checkLocalMedia",
};

function getWebdavDomainLabel(t: TranslateFn, key: AppSyncDomainKey) {
    return t(webdavDomainLabelKeys[key]);
}

function createWebdavDomainProgress(t: TranslateFn): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: getWebdavDomainLabel(t, key), stage: t("config.webdav.stages.waiting") },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];

const webdavDomainLabelKeys: Record<AppSyncDomainKey, TranslationKey> = {
    canvas: "config.webdav.domains.canvas",
    assets: "config.webdav.domains.assets",
    "image-workbench": "config.webdav.domains.imageWorkbench",
    "video-workbench": "config.webdav.domains.videoWorkbench",
};

function getWebdavStageId(stage: string): WebdavStageId {
    if (webdavStageSourceMap[stage]) return webdavStageSourceMap[stage];
    if (stage.startsWith(`${APP_SYNC_STAGE.uploadingManifest}:`)) return "uploadingManifest";
    if (stage.startsWith(`${APP_SYNC_STAGE.uploadingMediaProgress}:`)) return "uploadingMediaProgress";
    return "unknown";
}

function translateWebdavStage(t: TranslateFn, stage: string) {
    const stageId = getWebdavStageId(stage);
    if (stageId === "uploadingManifest") {
        const size = stage.includes(":") ? stage.slice(stage.indexOf(":") + 1) : "";
        return size ? t("errors.appSync.uploadManifest", { size }) : t("config.webdav.stages.uploadingManifest");
    }
    if (stageId === "uploadingMediaProgress") {
        const size = stage.includes(":") ? stage.slice(stage.indexOf(":") + 1) : "";
        return size ? t("errors.appSync.uploadMedia", { size }) : t("config.webdav.stages.uploadingMedia");
    }
    const key = webdavStageTranslationKeys[stageId];
    return key ? t(key) : stage;
}

function createModelGroups(t: TranslateFn): ModelGroup[] {
    return [
        { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: t("config.models.defaultImageModel"), optionsLabel: t("config.models.imageModelOptions") },
        { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: t("config.models.defaultVideoModel"), optionsLabel: t("config.models.videoModelOptions") },
        { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: t("config.models.defaultTextModel"), optionsLabel: t("config.models.textModelOptions") },
        { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: t("config.models.defaultAudioModel"), optionsLabel: t("config.models.audioModelOptions") },
    ];
}

export function AppConfigModal() {
    const { message } = App.useApp();
    const { locale, t } = useTranslation();
    const [activeTab, setActiveTab] = useState("channels");
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState<Record<AppSyncDomainKey, WebdavDomainProgress>>(() => createWebdavDomainProgress(t));
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const modelOptions = config.models.map((model) => ({ label: modelOptionLabel(config, model), value: model }));
    const webdavReady = Boolean(webdav.url.trim());
    const modelGroups = useMemo(() => createModelGroups(t), [t]);
    const apiFormatOptions = useMemo(
        () => [
            { label: t("config.apiFormat.openai"), value: "openai" as ApiCallFormat },
            { label: t("config.apiFormat.gemini"), value: "gemini" as ApiCallFormat },
        ],
        [t],
    );

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? t("config.messages.savedContinue") : t("config.messages.saved"));
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[]) => {
        const nextConfig = withChannels(config, channels);
        saveConfig(nextConfig);
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateChannel(channel.id, { apiFormat, baseUrl });
    };

    const addChannel = () => {
        updateChannels([...config.channels, createModelChannel({ name: t("config.channels.channelNameDefault", { index: config.channels.length + 1 }) })]);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.messages.keepOneChannel"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error(t("config.channels.messages.fillBaseUrlAndKey"));
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const models = await fetchChannelModels(channel);
            updateChannels(config.channels.map((item) => (item.id === channel.id ? { ...item, models } : item)));
            message.success(t("config.channels.messages.modelsUpdated", { name: channel.name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("errors.image.readModelsFailed"));
        } finally {
            setLoadingChannelId("");
        }
    };

    const refreshAllModels = async () => {
        const runnable = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
        if (!runnable.length) {
            message.error(t("config.channels.messages.fillAtLeastOneChannel"));
            return;
        }
        setLoadingChannelId("all");
        try {
            const entries = await Promise.all(runnable.map(async (channel) => [channel.id, await fetchChannelModels(channel)] as const));
            const modelMap = new Map(entries);
            updateChannels(config.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || [] } : channel)));
            message.success(t("config.channels.messages.allModelsUpdated"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("errors.image.readModelsFailed"));
        } finally {
            setLoadingChannelId("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter(Boolean));
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.messages.fillUrl"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("config.webdav.messages.connectionOk"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("errors.webdav.connectionTestFailed"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(translateWebdavStage(t, event.stage));
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || getWebdavDomainLabel(t, event.domain as AppSyncDomainKey),
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.messages.fillUrl"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress(t));
        setWebdavSyncStatus(t("config.webdav.stages.preparing"));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(
                t("config.webdav.messages.syncComplete", {
                    projects: result.projects,
                    assets: result.assets,
                    logs: result.imageLogs + result.videoLogs,
                    files: result.uploadedFiles,
                    size: formatBytes(result.uploadedBytes),
                }),
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("config.webdav.messages.syncFailed");
            setWebdavSyncStatus(errorMessage);
            message.error(errorMessage);
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("config.subtitle")}</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    {t("config.done")}
                </Button>
            }
        >
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    {
                        key: "channels",
                        label: t("config.tabs.channels"),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                                            <CircleAlert className="size-3.5 shrink-0" />
                                            <span className="font-semibold">{t("config.channels.importantPrefix")}</span>
                                            <span>{t("config.channels.importantMessage")}</span>
                                            <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold text-amber-900 dark:text-amber-100" onClick={() => setActiveTab("models")}>
                                                {t("config.channels.goToModels")}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <Button icon={<RefreshCw className="size-4" />} loading={Boolean(loadingChannelId)} onClick={() => void refreshAllModels()}>
                                            {t("config.channels.refreshAll")}
                                        </Button>
                                        <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                            {t("config.channels.addChannel")}
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    {config.channels.map((channel) => (
                                        <section key={channel.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold">{channel.name || t("config.channels.unnamedChannel")}</div>
                                                    <div className="mt-1 text-xs text-stone-500">
                                                        {apiFormatLabel(channel.apiFormat, t)} · {t("config.channels.savedModels", { count: channel.models.length })}
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 gap-2">
                                                    <Button size="small" loading={loadingChannelId === channel.id} onClick={() => void refreshChannelModels(channel)}>
                                                        {t("config.channels.refreshModels")}
                                                    </Button>
                                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                                </div>
                                            </div>
                                            <div className="grid gap-4 md:grid-cols-2">
                                                <Form.Item label={t("config.channels.channelName")} className="mb-0">
                                                    <Input value={channel.name} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label={t("config.channels.apiFormat")} className="mb-0">
                                                    <Select value={channel.apiFormat} options={apiFormatOptions} onChange={(value: ApiCallFormat) => updateChannelApiFormat(channel, value)} />
                                                </Form.Item>
                                                <Form.Item label={t("config.channels.baseUrl")} className="mb-0">
                                                    <Input value={channel.baseUrl} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label={t("config.channels.apiKey")} className="mb-0">
                                                    <Input.Password value={channel.apiKey} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label={t("config.channels.modelList")} className="mb-0 md:col-span-2">
                                                    <Select mode="tags" showSearch allowClear maxTagCount="responsive" placeholder={t("config.channels.modelListPlaceholder")} value={channel.models} onChange={(models) => updateChannel(channel.id, { models })} />
                                                </Form.Item>
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "models",
                        label: t("config.tabs.models"),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="text-sm font-semibold">{t("config.models.sectionTitle")}</div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500">{t("config.models.sectionDescription")}</div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                            <Select
                                                mode="tags"
                                                showSearch
                                                allowClear
                                                maxTagCount="responsive"
                                                placeholder={config.models.length ? t("config.models.selectOrInput", { label: group.optionsLabel }) : t("config.models.addModelsInChannels")}
                                                value={config[group.modelsKey]}
                                                options={modelOptions}
                                                onChange={(models) => updateCapabilityModels(group, models)}
                                            />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "preferences",
                        label: t("config.tabs.preferences"),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountExtra")} className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.defaultAudioVoice")} className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.defaultAudioFormat")} className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.defaultAudioSpeed")} className="mb-4">
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
                                <Form.Item label={t("config.preferences.defaultAudioInstructions")} className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.defaultAudioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "webdav",
                        label: t("config.tabs.webdav"),
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
                                        <div className="text-xs text-stone-500">
                                            {webdav.lastSyncedAt
                                                ? t("config.webdav.lastSynced", {
                                                      time: formatLocaleDateTime(webdav.lastSyncedAt, locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
                                                  })
                                                : t("config.webdav.notSynced")}
                                        </div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label={t("config.webdav.url")} className="mb-4">
                                            <Input value={webdav.url} placeholder={t("config.webdav.urlPlaceholder")} onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.directory")} extra={t("config.webdav.directoryExtra", { manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
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
                                            {t("config.webdav.testConnection")}
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? t("config.webdav.syncing") : t("config.webdav.syncNow")}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                ]}
            />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = keepOrSuggest(config.imageModels, filterModelsByCapability(models, "image"), models);
    const videoModels = keepOrSuggest(config.videoModels, filterModelsByCapability(models, "video"), models);
    const textModels = keepOrSuggest(config.textModels, filterModelsByCapability(models, "text"), models);
    const audioModels = keepOrSuggest(config.audioModels, filterModelsByCapability(models, "audio"), models);
    return {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function keepOrSuggest(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = uniqueModels(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

function normalizeDefaultModel(value: string, options: string[]) {
    if (options.includes(value)) return value;
    return options[0] || value;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function apiFormatLabel(apiFormat: ApiCallFormat, t: TranslateFn) {
    return apiFormat === "gemini" ? t("config.apiFormat.gemini") : t("config.apiFormat.openai");
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    const { t } = useTranslation();

    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                const stageLabel = translateWebdavStage(t, item.stage);
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {stageLabel}
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

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    const stageId = getWebdavStageId(item.stage);
    if (stageId === "waiting") return 0;
    if (stageId === "readingRemoteManifest") return 12;
    if (stageId === "readingLocalData") return 24;
    if (stageId === "downloadingMedia") return 36;
    if (stageId === "writingLocalMerge") return 58;
    if (stageId === "uploadingMedia") return 66;
    if (stageId === "mediaComplete" || stageId === "mediaNoUpload") return 74;
    if (stageId === "uploadingManifest") return 90;
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
