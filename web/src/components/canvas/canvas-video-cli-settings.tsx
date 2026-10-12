import { useEffect, useState } from "react";
import { Button, InputNumber, Popover, Select, Switch, Tooltip } from "antd";
import { LoaderCircle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fetchLibTvProjects, fetchVideoCliModels, fetchVideoCliSchema, type VideoCliModel, type VideoCliSchema } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";
import { type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type VideoCliResources = { models: VideoCliModel[]; projects: Array<{ id: string; name: string }> };
const resourceCache = new Map<string, VideoCliResources>();
const resourceRequests = new Map<string, Promise<VideoCliResources>>();
const schemaCache = new Map<string, VideoCliSchema>();
const schemaRequests = new Map<string, Promise<VideoCliSchema>>();

function loadVideoCliResources(endpoint: string, token: string, provider: AiConfig["videoProvider"]) {
    const key = `${endpoint}:${token}:${provider}`;
    const cached = resourceCache.get(key);
    if (cached) return Promise.resolve(cached);
    let request = resourceRequests.get(key);
    if (!request) {
        request = Promise.all([
            fetchVideoCliModels(endpoint, token, provider as "dreamina" | "libtv"),
            provider === "libtv" ? fetchLibTvProjects(endpoint, token) : Promise.resolve({ data: [] }),
        ]).then(([modelResponse, projectResponse]) => {
            const resources = { models: modelResponse.data?.models || [], projects: projectResponse.data || [] };
            resourceCache.set(key, resources);
            return resources;
        }).finally(() => resourceRequests.delete(key));
        resourceRequests.set(key, request);
    }
    return request;
}

function loadVideoCliModelSchema(endpoint: string, token: string, provider: "dreamina" | "libtv", model: string) {
    const key = `${endpoint}:${token}:${provider}:${model}`;
    const cached = schemaCache.get(key);
    if (cached) return Promise.resolve(cached);
    let request = schemaRequests.get(key);
    if (!request) {
        request = fetchVideoCliSchema(endpoint, token, provider, model).then(({ data }) => {
            if (!data) throw new Error("无法读取所选视频模型参数");
            schemaCache.set(key, data);
            return data;
        }).finally(() => schemaRequests.delete(key));
        schemaRequests.set(key, request);
    }
    return request;
}

type CanvasVideoCliSettingsProps = {
    config: AiConfig;
    onAvailabilityChange: (key: string, ready: boolean) => void;
    onConfigChange: (patch: { videoProvider?: AiConfig["videoProvider"]; videoCliModel?: string; videoCliProjectId?: string; videoCliSettings?: AiConfig["videoCliSettings"] }) => void;
};

export function CanvasVideoCliSettings({ config, onAvailabilityChange, onConfigChange }: CanvasVideoCliSettingsProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const endpoint = useAgentStore((state) => state.url.trim().replace(/\/$/, ""));
    const token = useAgentStore((state) => state.token.trim());
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const [models, setModels] = useState<VideoCliModel[]>([]);
    const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
    const [schema, setSchema] = useState<VideoCliSchema | null>(null);
    const [loadedSchemaKey, setLoadedSchemaKey] = useState("");
    const [loadingModels, setLoadingModels] = useState(false);
    const [loadingSchema, setLoadingSchema] = useState(false);
    const [error, setError] = useState("");
    const provider = config.videoProvider;

    useEffect(() => {
        setModels([]);
        setProjects([]);
        setSchema(null);
        setError("");
        if (provider === "api") { setLoadingModels(false); return; }
        if (!endpoint || !token) {
            setError(t("canvas.videoCli.agentRequired"));
            return;
        }
        let active = true;
        const key = `${endpoint}:${token}:${provider}`;
        const cached = resourceCache.get(key);
        if (cached) {
            setModels(cached.models);
            setProjects(cached.projects);
            setLoadingModels(false);
            return;
        }
        setLoadingModels(true);
        void loadVideoCliResources(endpoint, token, provider).then((resources) => {
            if (active) { setModels(resources.models); setProjects(resources.projects); }
        }).catch((cause) => {
            if (active) setError(cause instanceof Error ? cause.message : t("canvas.videoCli.readModelsFailed"));
        }).finally(() => { if (active) setLoadingModels(false); });
        return () => { active = false; };
    }, [endpoint, provider, token]);

    useEffect(() => {
        setSchema(null);
        setLoadedSchemaKey("");
        if (provider === "api" || !config.videoCliModel || !endpoint || !token) { setLoadingSchema(false); return; }
        setError("");
        const key = `${endpoint}:${token}:${provider}:${config.videoCliModel}`;
        const schemaKey = `${provider}:${config.videoCliModel}:${endpoint}`;
        const cached = schemaCache.get(key);
        if (cached) {
            setSchema(cached);
            setLoadedSchemaKey(schemaKey);
            setError(cached.mode ? "" : t("canvas.videoCli.unsupportedMode"));
            const current = config.videoCliSettings || {};
            const defaults = Object.fromEntries(cached.settings.filter((setting) => current[setting.key] === undefined && setting.defaultValue !== undefined).map((setting) => [setting.key, setting.defaultValue as string | number | boolean]));
            if (Object.keys(defaults).length) onConfigChange({ videoCliSettings: { ...current, ...defaults } });
            setLoadingSchema(false);
            return;
        }
        let active = true;
        setLoadingSchema(true);
        void loadVideoCliModelSchema(endpoint, token, provider, config.videoCliModel)
            .then((data) => {
                if (!active) return;
                setSchema(data);
                setLoadedSchemaKey(`${provider}:${config.videoCliModel}:${endpoint}`);
                setError(data.mode ? "" : t("canvas.videoCli.unsupportedMode"));
                const current = config.videoCliSettings || {};
                const defaults = Object.fromEntries(data.settings.filter((setting) => current[setting.key] === undefined && setting.defaultValue !== undefined).map((setting) => [setting.key, setting.defaultValue as string | number | boolean]));
                if (Object.keys(defaults).length) onConfigChange({ videoCliSettings: { ...current, ...defaults } });
            })
            .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("canvas.videoCli.readModelsFailed")); })
            .finally(() => { if (active) setLoadingSchema(false); });
        return () => { active = false; };
        // The selected model and endpoint determine the schema; node metadata is read when the request starts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.videoCliModel, endpoint, provider, token]);

    useEffect(() => {
        const key = `${provider}:${config.videoCliModel}`;
        const schemaKey = `${provider}:${config.videoCliModel}:${endpoint}`;
        onAvailabilityChange(key, provider === "api" || Boolean(config.videoCliModel && loadedSchemaKey === schemaKey && schema?.mode && (provider !== "libtv" || config.videoCliProjectId)));
    }, [config.videoCliModel, config.videoCliProjectId, endpoint, loadedSchemaKey, onAvailabilityChange, provider, schema]);

    const displaySettings = (schema?.settings || []).map((setting) => {
        const value = config.videoCliSettings?.[setting.key] ?? setting.defaultValue;
        if (setting.type === "select") return <label key={setting.key} className="block space-y-1.5 text-xs"><span className="opacity-70">{setting.label}</span><Select size="small" className="w-full" value={value as string | number | undefined} options={setting.options || []} onChange={(next) => onConfigChange({ videoCliSettings: { ...config.videoCliSettings, [setting.key]: next } })} /></label>;
        if (setting.type === "switch") {
            const onValue = typeof setting.defaultValue === "number" ? 1 : typeof setting.defaultValue === "boolean" ? true : "on";
            const offValue = typeof setting.defaultValue === "number" ? 0 : typeof setting.defaultValue === "boolean" ? false : "off";
            return <label key={setting.key} className="flex items-center justify-between gap-3 text-xs"><span className="opacity-70">{setting.label}</span><Switch size="small" checked={String(value) === String(onValue)} onChange={(next) => onConfigChange({ videoCliSettings: { ...config.videoCliSettings, [setting.key]: next ? onValue : offValue } })} /></label>;
        }
        const numberValue = typeof value === "number" ? value : Number(value);
        return <label key={setting.key} className="flex items-center justify-between gap-3 text-xs"><span className="opacity-70">{setting.label}</span><InputNumber size="small" className="w-24" min={setting.min} max={setting.max} step={setting.step || 1} value={Number.isFinite(numberValue) ? numberValue : setting.min ?? 0} onChange={(next) => next !== null && onConfigChange({ videoCliSettings: { ...config.videoCliSettings, [setting.key]: next } })} /></label>;
    });
    const settingsLabel = Object.values(config.videoCliSettings || {}).join(" · ") || t("canvas.videoCli.settings");
    const loading = loadingModels || loadingSchema;
    const popoverContent = <div className="w-64 space-y-3" style={{ color: theme.node.text }}>
        {provider === "libtv" ? <label className="block space-y-1.5 text-xs"><span className="opacity-70">{t("canvas.videoCli.project")}</span><Select size="small" className="w-full" placeholder={t("canvas.videoCli.chooseProject")} value={config.videoCliProjectId || undefined} options={projects.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => onConfigChange({ videoCliProjectId: value })} /></label> : null}
        <div className="text-xs opacity-60">{t("canvas.videoCli.textToVideo")} · {t("canvas.videoCli.parameterHint")}</div>
        {displaySettings.length ? displaySettings : <div className="text-xs opacity-55">{schema ? t("canvas.videoCli.unsupportedMode") : t("canvas.videoCli.selectModel")}</div>}
        {error ? <div className="text-xs text-red-500">{error}</div> : null}
    </div>;

    return <div className="flex min-w-0 items-center gap-1.5">
        <Select
            size="small"
            className="w-[96px] shrink-0"
            value={provider}
            options={[
                { value: "api", label: t("canvas.videoCli.providerApi") },
                { value: "dreamina", label: t("canvas.videoCli.providerDreamina") },
                { value: "libtv", label: t("canvas.videoCli.providerLibTv") },
            ]}
            onChange={(value: AiConfig["videoProvider"]) => onConfigChange({ videoProvider: value, videoCliModel: "", videoCliSettings: {} })}
        />
        {provider === "api" ? null : <>
            <Tooltip title={error}>
                <Select
                    size="small"
                    loading={loading}
                    className="max-w-[158px] min-w-[104px] flex-1"
                    placeholder={loading ? t("canvas.videoCli.loadingModels") : t("canvas.videoCli.modelPlaceholder")}
                    value={config.videoCliModel || undefined}
                    options={models.map((item) => ({ value: item.id, label: item.label }))}
                    onChange={(value) => onConfigChange({ videoCliModel: value, videoCliSettings: {} })}
                    notFoundContent={error ? <button type="button" className="text-xs text-red-500" onClick={openAgentPanel}>{error} · {t("canvas.videoCli.openAgent")}</button> : undefined}
                />
            </Tooltip>
            {loading ? <LoaderCircle className="size-4 shrink-0 animate-spin opacity-55" /> : <Popover trigger="click" placement="topRight" content={popoverContent}>
                <Button size="small" type="text" className="!h-8 !max-w-[126px] !min-w-8 !shrink-0 !rounded-full !px-2" style={{ color: theme.node.text, background: theme.node.fill }} icon={<Settings2 className="size-3.5" />} disabled={!config.videoCliModel}>
                    <span className="truncate">{settingsLabel}</span>
                </Button>
            </Popover>}
        </>}
    </div>;
}
