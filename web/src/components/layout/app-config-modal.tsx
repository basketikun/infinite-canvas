"use client";

import { App, Button, Form, Input, Modal, Segmented, Select } from "antd";
import { useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { fetchImageModels } from "@/services/api/image";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { applyFetchedModelsToConfig, channelModeAllowed, isNewApiConfig, resolveAllowedChannelMode, useConfigStore, useEffectiveConfig, type AiConfig, type ChannelMode, type ModelCapability } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
type ModelChannelSettings = NonNullable<ReturnType<typeof useConfigStore.getState>["publicSettings"]>["modelChannel"];

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

export function AppConfigModal() {
    const { message } = App.useApp();
    const [loadingModels, setLoadingModels] = useState(false);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const effectiveConfig = useEffectiveConfig();
    const modelChannel = publicSettings?.modelChannel;
    const channelModeOptions = buildChannelModeOptions(modelChannel);
    const effectiveMode = resolveAllowedChannelMode(config.channelMode, modelChannel);
    const modelConfig = effectiveMode === "remote" ? effectiveConfig : config;
    const modelOptions = config.models.map((model) => ({ label: model, value: model }));

    const finishConfig = () => {
        setConfigDialogOpen(false);
        if (!effectiveMode) return;
        if (effectiveMode === "local" && (!config.baseUrl.trim() || !config.apiKey.trim())) return;
        if (effectiveMode === "newapi" && (!config.baseUrl.trim() || !config.newApiGroup.trim())) return;
        if (!modelConfig.imageModel.trim() || !modelConfig.videoModel.trim() || !modelConfig.textModel.trim()) return;
        if (effectiveMode !== config.channelMode) updateConfig("channelMode", effectiveMode);
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const refreshModels = async () => {
        if (!effectiveMode || effectiveMode === "remote") return;
        const fetchConfig = { ...config, channelMode: effectiveMode };
        if (!isModelFetchConfigReady(fetchConfig)) {
            message.error(effectiveMode === "newapi" ? "请先填写 Base URL 和分组" : "请先填写 Base URL 和 API Key");
            return;
        }
        setLoadingModels(true);
        try {
            const models = await fetchImageModels(fetchConfig);
            const nextConfig = applyFetchedModelsToConfig(fetchConfig, models);
            applyConfigPatch(updateConfig, config, nextConfig);
            message.success("模型列表已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingModels(false);
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models);
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">模型、渠道和画布默认行为</div>
                </div>
            }
            open={isConfigOpen}
            width={960}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 18 } }}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    完成
                </Button>
            }
        >
            <div className="pt-1">
                <Form layout="vertical" requiredMark={false}>
                    {channelModeOptions.length ? (
                        <Form.Item label="渠道模式" className="mb-5">
                            <Segmented block size="middle" value={effectiveMode} onChange={(value) => updateConfig("channelMode", value as AiConfig["channelMode"])} options={channelModeOptions} />
                        </Form.Item>
                    ) : (
                        <div className="mb-5 rounded-lg border border-stone-200 p-3 text-sm text-stone-500 dark:border-stone-800">管理员未开放可用渠道，请联系管理员在后台设置中开启至少一种渠道。</div>
                    )}
                    {!effectiveMode ? null : effectiveMode === "local" || effectiveMode === "newapi" ? (
                        <>
                            <div className="grid gap-4 md:grid-cols-2">
                                <Form.Item
                                    label="Base URL"
                                    extra={
                                        effectiveMode === "local"
                                            ? "浏览器直连要求接口支持 CORS/OPTIONS；HTTPS 页面不能直连 HTTP 地址。若出现网络错误，可改用后端渠道。"
                                            : "跨域免 Key 请求要求接口允许当前站点来源并支持携带 Cookie。"
                                    }
                                    className="mb-4"
                                >
                                    <Input value={config.baseUrl} onChange={(event) => updateConfig("baseUrl", event.target.value)} />
                                </Form.Item>
                                {effectiveMode === "newapi" ? (
                                    <Form.Item label="New API 默认分组" extra="未单独配置能力分组时使用。" className="mb-4">
                                        <Input value={config.newApiGroup} onChange={(event) => updateConfig("newApiGroup", event.target.value)} />
                                    </Form.Item>
                                ) : (
                                    <Form.Item label="API Key" className="mb-4">
                                        <Input.Password value={config.apiKey} onChange={(event) => updateConfig("apiKey", event.target.value)} />
                                    </Form.Item>
                                )}
                            </div>
                            {effectiveMode === "newapi" ? (
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="文本分组" className="mb-4">
                                        <Input placeholder="默认分组" value={config.newApiTextGroup} onChange={(event) => updateConfig("newApiTextGroup", event.target.value)} />
                                    </Form.Item>
                                    <Form.Item label="生图分组" className="mb-4">
                                        <Input placeholder="默认分组" value={config.newApiImageGroup} onChange={(event) => updateConfig("newApiImageGroup", event.target.value)} />
                                    </Form.Item>
                                    <Form.Item label="音频分组" className="mb-4">
                                        <Input placeholder="默认分组" value={config.newApiAudioGroup} onChange={(event) => updateConfig("newApiAudioGroup", event.target.value)} />
                                    </Form.Item>
                                    <Form.Item label="视频分组" className="mb-4">
                                        <Input placeholder="默认分组" value={config.newApiVideoGroup} onChange={(event) => updateConfig("newApiVideoGroup", event.target.value)} />
                                    </Form.Item>
                                </div>
                            ) : null}
                            <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium">模型列表</div>
                                    <div className="mt-1 text-xs text-stone-500">当前已保存 {config.models.length} 个模型</div>
                                </div>
                                <Button size="small" loading={loadingModels} onClick={() => void refreshModels()}>
                                    拉取模型列表
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="mb-5 rounded-lg border border-stone-200 p-3 text-sm text-stone-500 dark:border-stone-800">
                            <div className="font-medium text-stone-900 dark:text-stone-100">后端渠道</div>
                            <div className="mt-1">由系统后台渠道转发请求，当前可用 {modelChannel?.availableModels.length || 0} 个模型。</div>
                        </div>
                    )}
                    {effectiveMode === "local" || effectiveMode === "newapi" ? (
                        <section className="mb-5 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="mb-3">
                                <div className="text-sm font-semibold">模型可选项</div>
                                <div className="mt-1 text-xs text-stone-500">从已拉取模型中选择哪些模型可进入各类下拉。</div>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                {modelGroups.map((group) => (
                                    <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                        <Select
                                            mode="multiple"
                                            showSearch
                                            allowClear
                                            maxTagCount="responsive"
                                            placeholder={config.models.length ? `请选择${group.optionsLabel}` : "请先拉取模型列表"}
                                            value={config[group.modelsKey]}
                                            options={modelOptions}
                                            onChange={(models) => updateCapabilityModels(group, models)}
                                        />
                                    </Form.Item>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {effectiveMode ? (
                        <>
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                {modelGroups.map((group) => (
                                    <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-4">
                                        <ModelPicker config={modelConfig} value={modelConfig[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                    </Form.Item>
                                ))}
                            </div>
                            <div className="grid gap-4 md:grid-cols-4">
                                <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={15}
                                        value={config.canvasImageCount}
                                        onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                        onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                    />
                                </Form.Item>
                                <Form.Item label="默认音频声音" className="mb-4">
                                    <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                </Form.Item>
                                <Form.Item label="默认音频格式" className="mb-4">
                                    <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                </Form.Item>
                                <Form.Item label="默认音频语速" className="mb-4">
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
                            <Form.Item label="默认音频指令" className="mb-4">
                                <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                            </Form.Item>
                            {effectiveMode === "local" ? (
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={3} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            ) : null}
                        </>
                    ) : null}
                </Form>
            </div>
        </Modal>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function applyConfigPatch(updateConfig: UpdateAiConfig, current: AiConfig, next: AiConfig) {
    (Object.keys(next) as Array<keyof AiConfig>).forEach((key) => {
        if (current[key] !== next[key]) updateConfig(key, next[key]);
    });
}

function buildChannelModeOptions(modelChannel: ModelChannelSettings | null | undefined) {
    const modes: Array<{ label: string; value: ChannelMode }> = [
        { label: "本地直连", value: "local" },
        { label: "New API 免 Key", value: "newapi" },
        { label: "后端渠道", value: "remote" },
    ];
    return modes.filter((mode) => channelModeAllowed(modelChannel, mode.value));
}

function isModelFetchConfigReady(config: AiConfig) {
    if (!config.baseUrl.trim()) return false;
    if (isNewApiConfig(config)) return Boolean(config.newApiGroup.trim());
    return Boolean(config.apiKey.trim());
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}
