import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, InputNumber, Select, Switch, message } from "antd";
import { Clapperboard, ExternalLink, LoaderCircle, LogIn, RefreshCw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { checkDreaminaLogin, fetchDreaminaCapabilities, fetchDreaminaStatus, startDreaminaLogin, type DreaminaCapability, type DreaminaStatus } from "@/services/api/canvas-agent";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type Props = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string, prompt: string) => void;
    onStop: (nodeId: string) => void;
};

type DreaminaLoginFlow = { verificationUri: string; userCode: string; deviceCode: string };

export function CanvasDreaminaNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStop }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const connected = useAgentStore((state) => state.connected);
    const agentUrl = useAgentStore((state) => state.url);
    const agentToken = useAgentStore((state) => state.token);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const defaultDreaminaModel = useConfigStore((state) => state.config.dreaminaModel);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const endpoint = agentUrl.trim().replace(/\/$/, "");
    const [status, setStatus] = useState<DreaminaStatus | null>(null);
    const [capabilities, setCapabilities] = useState<DreaminaCapability[]>([]);
    const [loading, setLoading] = useState(false);
    const [signingIn, setSigningIn] = useState(false);
    const [loginFlow, setLoginFlow] = useState<DreaminaLoginFlow | null>(null);
    const [error, setError] = useState("");
    const prompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const selectedCommand = node.metadata?.dreaminaCommand || "auto";
    const referenceCount = inputSummary.imageCount + inputSummary.videoCount + inputSummary.audioCount;
    const resolvedCommand = useMemo(() => {
        if (selectedCommand !== "auto") return selectedCommand;
        if (inputSummary.videoCount || inputSummary.audioCount) return "multimodal2video";
        if (inputSummary.imageCount > 1) return "multiframe2video";
        if (inputSummary.imageCount === 1) return "image2video";
        return "text2video";
    }, [inputSummary.audioCount, inputSummary.imageCount, inputSummary.videoCount, selectedCommand]);
    const selectedCapability = capabilities.find((item) => item.command === resolvedCommand);
    const nodeDreaminaModel = node.metadata?.dreaminaModel || "";
    const selectedDreaminaModel = selectedCapability?.models.includes(nodeDreaminaModel)
        ? nodeDreaminaModel
        : selectedCapability?.models.includes(defaultDreaminaModel) ? defaultDreaminaModel : "__default__";
    const chipStyle = { color: theme.node.text, borderColor: theme.node.stroke, background: theme.node.fill };

    const refresh = useCallback(async (signal?: AbortSignal, checkLogin = false) => {
        if (!connected || !endpoint || !agentToken) return;
        setLoading(true);
        setError("");
        try {
            if (checkLogin && loginFlow) {
                const loginResult = await checkDreaminaLogin(endpoint, agentToken, loginFlow.deviceCode);
                if (signal?.aborted) return;
                if (loginResult.authorized) {
                    setLoginFlow(null);
                    message.success(t("canvas.dreamina.loginComplete"));
                } else {
                    message.info(t("canvas.dreamina.loginPending"));
                }
            }
            const [statusResult, capabilityResult] = await Promise.allSettled([
                fetchDreaminaStatus(endpoint, agentToken),
                fetchDreaminaCapabilities(endpoint, agentToken, checkLogin),
            ]);
            if (statusResult.status === "rejected") throw statusResult.reason;
            const nextStatus = statusResult.value;
            if (signal?.aborted) return;
            setStatus(nextStatus);
            onConfigChange(node.id, {
                ...(typeof nextStatus.creditsRemaining === "number" ? { dreaminaCreditsRemaining: nextStatus.creditsRemaining } : {}),
                dreaminaCreditRefreshDate: nextStatus.creditRefreshDate,
            });
            if (!nextStatus.installed) {
                setCapabilities([]);
                return;
            }
            if (capabilityResult.status === "rejected") throw capabilityResult.reason;
            const nextCapabilities = capabilityResult.value;
            if (!signal?.aborted) setCapabilities(nextCapabilities.data || []);
        } catch (requestError) {
            if (!signal?.aborted) setError(requestError instanceof Error ? requestError.message : t("canvas.dreamina.connectionFailed"));
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [agentToken, connected, endpoint, loginFlow, node.id, onConfigChange, t]);

    useEffect(() => {
        const controller = new AbortController();
        void refresh(controller.signal);
        return () => controller.abort();
    }, [refresh]);

    const handleLogin = async () => {
        if (!connected || !endpoint || !agentToken) return openAgentPanel();
        const popup = window.open("about:blank", "_blank");
        if (popup) popup.opener = null;
        setSigningIn(true);
        setError("");
        try {
            const result = await startDreaminaLogin(endpoint, agentToken);
            if (!result.verificationUri || !result.userCode || !result.deviceCode) throw new Error(t("canvas.dreamina.loginFailed"));
            setLoginFlow({ verificationUri: result.verificationUri, userCode: result.userCode, deviceCode: result.deviceCode });
            if (popup) popup.location.replace(result.verificationUri);
        } catch (requestError) {
            popup?.close();
            setError(requestError instanceof Error ? requestError.message : t("canvas.dreamina.loginFailed"));
        } finally {
            setSigningIn(false);
        }
    };

    const generationOptions = capabilities.map((item) => ({ value: item.command, label: t(`canvas.dreamina.commands.${item.command}`) }));
    const modelOptions = [
        { value: "__default__", label: t("canvas.dreamina.defaultModel") },
        ...(selectedCapability?.models || []).map((model) => ({ value: model, label: model })),
    ];
    const canGenerate = connected && Boolean(status?.installed && status.loggedIn) && Boolean(prompt.trim() || inputSummary.textCount) && Boolean(selectedCapability) && !loading;

    return (
        <div className="flex h-full w-full cursor-move flex-col gap-3 overflow-y-auto px-3 pb-3 pt-3 text-sm thin-scrollbar" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold"><Clapperboard className="size-4" />{t("canvas.dreamina.title")}</div>
                <Button type="text" size="small" icon={loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} onMouseDown={(event) => event.stopPropagation()} onClick={() => void refresh(undefined, true)} disabled={loading} aria-label={t("canvas.dreamina.refresh")} />
            </div>

            {!connected ? (
                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <span>{t("canvas.dreamina.agentRequired")}</span>
                    <Button size="small" onMouseDown={(event) => event.stopPropagation()} onClick={openAgentPanel}>{t("agent.state.connect")}</Button>
                </div>
            ) : status?.installed ? (
                <>
                    <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                        <span className="min-w-0 truncate" title={status.path}>{status.loggedIn ? t("canvas.dreamina.connected") : t("canvas.dreamina.notLoggedIn")}</span>
                        {!status.loggedIn ? <Button size="small" icon={<LogIn className="size-3.5" />} loading={signingIn} onMouseDown={(event) => event.stopPropagation()} onClick={() => void handleLogin()}>{t("canvas.dreamina.login")}</Button> : null}
                    </div>
                    {status.loggedIn ? (
                        <div className="space-y-1 text-xs" style={{ color: theme.node.muted }}>
                            <div>{t("canvas.dreamina.creditRemaining", { credits: node.metadata?.dreaminaCreditsRemaining ?? status.credits ?? "—" })}</div>
                            <div>{t("canvas.dreamina.creditRefreshDate", { date: node.metadata?.dreaminaCreditRefreshDate || t("canvas.dreamina.creditRefreshUnavailable") })}</div>
                            {typeof node.metadata?.dreaminaCreditsDelta === "number" ? <div>{t("canvas.dreamina.creditBalanceDelta", { delta: node.metadata.dreaminaCreditsDelta > 0 ? `+${node.metadata.dreaminaCreditsDelta}` : node.metadata.dreaminaCreditsDelta })}</div> : null}
                        </div>
                    ) : null}
                </>
            ) : status && !status.installed ? (
                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <span>{t("canvas.dreamina.cliMissing")}</span>
                    <a href="https://github.com/simonjiang99/dreamina-cli" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sky-500">{t("canvas.dreamina.installGuide")}<ExternalLink className="size-3" /></a>
                </div>
            ) : (
                <div className="text-xs" style={{ color: theme.node.muted }}>{loading ? t("canvas.dreamina.checking") : t("canvas.dreamina.agentRequired")}</div>
            )}
            {error || status?.error ? <div className="rounded-lg border border-red-500/40 px-2.5 py-2 text-xs text-red-500">{error || status?.error}</div> : null}
            {loginFlow ? (
                <div className="rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                    <div>{t("canvas.dreamina.loginInstruction")}</div>
                    <div className="my-2 flex items-center gap-2">
                        <span style={{ color: theme.node.muted }}>{t("canvas.dreamina.loginCode")}</span>
                        <code className="select-all text-sm font-semibold">{loginFlow.userCode}</code>
                    </div>
                    <a href={loginFlow.verificationUri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-500" onMouseDown={(event) => event.stopPropagation()}>
                        {t("canvas.dreamina.openLoginPage")}<ExternalLink className="size-3" />
                    </a>
                </div>
            ) : null}

            <Input.TextArea
                value={prompt}
                rows={4}
                placeholder={t("canvas.dreamina.promptPlaceholder")}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => onConfigChange(node.id, { composerContent: event.target.value })}
            />

            <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md border px-2 py-1" style={chipStyle}>{t("canvas.dreamina.textInputs", { count: inputSummary.textCount })}</span>
                <span className="rounded-md border px-2 py-1" style={chipStyle}>{t("canvas.dreamina.references", { count: referenceCount })}</span>
            </div>

            <div data-canvas-no-zoom className="grid grid-cols-2 gap-2" onMouseDown={(event) => event.stopPropagation()}>
                <Select
                    value={selectedCommand}
                    options={[{ value: "auto", label: t("canvas.dreamina.autoMode") }, ...generationOptions]}
                    onChange={(value) => onConfigChange(node.id, { dreaminaCommand: value })}
                    className="canvas-compact-control"
                    aria-label={t("canvas.dreamina.mode")}
                />
                {selectedCapability && selectedCapability.flags.includes("model_version") ? (
                    selectedCapability.models.length ? (
                        <Select
                            value={selectedDreaminaModel}
                            options={modelOptions}
                            onChange={(value) => {
                                const model = value === "__default__" ? "" : value;
                                onConfigChange(node.id, { dreaminaModel: model });
                                updateConfig("dreaminaModel", model);
                            }}
                            className="canvas-compact-control"
                            aria-label={t("canvas.dreamina.model")}
                        />
                    ) : (
                        <Input
                            value={node.metadata?.dreaminaModel || ""}
                            placeholder={t("canvas.dreamina.defaultModel")}
                            className="canvas-compact-control"
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => onConfigChange(node.id, { dreaminaModel: event.target.value })}
                            aria-label={t("canvas.dreamina.model")}
                        />
                    )
                ) : null}
                {selectedCapability?.flags.includes("duration") ? (
                    <div className="flex items-center gap-1"><InputNumber value={node.metadata?.dreaminaDuration ?? selectedCapability.durations?.[0] ?? 5} min={selectedCapability.durations?.[0] ?? 1} max={selectedCapability.durations?.[1]} controls={false} className="canvas-compact-control w-full" onChange={(value) => value !== null && onConfigChange(node.id, { dreaminaDuration: value })} aria-label={t("canvas.dreamina.duration")} /><span className="text-xs" style={{ color: theme.node.muted }}>s</span></div>
                ) : null}
                {selectedCapability?.ratios.length ? (
                    <Select value={node.metadata?.dreaminaRatio || selectedCapability.ratios[0]} options={selectedCapability.ratios.map((ratio) => ({ value: ratio, label: ratio }))} onChange={(value) => onConfigChange(node.id, { dreaminaRatio: value })} className="canvas-compact-control" aria-label={t("canvas.dreamina.ratio")} />
                ) : null}
                {selectedCapability?.resolutions.length ? (
                    <Select value={node.metadata?.dreaminaResolution || selectedCapability.resolutions[0]} options={selectedCapability.resolutions.map((resolution) => ({ value: resolution, label: resolution }))} onChange={(value) => onConfigChange(node.id, { dreaminaResolution: value })} className="canvas-compact-control" aria-label={t("canvas.dreamina.resolution")} />
                ) : null}
                {selectedCapability?.flags.includes("generate_audio") ? (
                    <label className="col-span-2 flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs" style={chipStyle}>
                        <span>{t("canvas.dreamina.generateAudio")}</span>
                        <Switch size="small" checked={node.metadata?.dreaminaGenerateAudio ?? true} onChange={(checked) => onConfigChange(node.id, { dreaminaGenerateAudio: checked })} />
                    </label>
                ) : null}
            </div>
            {capabilities.length && !selectedCapability ? <div className="text-xs text-amber-500">{t("canvas.dreamina.modeUnavailable")}</div> : null}

            <div className="mt-auto flex items-center justify-between gap-3">
                <span className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.dreamina.creditNotice")}</span>
                <Button type="primary" danger={isRunning} disabled={!isRunning && !canGenerate} onMouseDown={(event) => event.stopPropagation()} onClick={() => isRunning ? onStop(node.id) : onGenerate(node.id, prompt)}>
                    {isRunning ? <><Square className="mr-1 size-3.5 fill-current" />{t("canvas.dreamina.stop")}</> : t("canvas.dreamina.generate")}
                </Button>
            </div>
        </div>
    );
}
