import { useEffect, useState } from "react";
import { Alert, Button, Switch } from "antd";
import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { resolveModelForCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { disconnectChatGPTPlan, fetchChatGPTPlanModels, fetchChatGPTPlanSession, fetchCodexSkills, startChatGPTPlanSignIn, type AgentSkillSummary, type ChatGPTPlanModel, type ChatGPTPlanSession } from "@/services/api/canvas-agent";
import { useAgentStore, type CanvasAgentProvider } from "@/stores/use-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type Props = { node: CanvasNodeData; onChange: (patch: { agentMode?: boolean; agentProvider?: CanvasAgentProvider; agentSkillName?: string; skillName?: string; model?: string }) => void };

export function CanvasAgentStepSettings({ node, onChange }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const connected = useAgentStore((state) => state.connected);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const canvasAgentDefaults = useAgentStore((state) => state.canvasAgentDefaults);
    const setCanvasAgentDefaultProvider = useAgentStore((state) => state.setCanvasAgentDefaultProvider);
    const setCanvasAgentDefaultModel = useAgentStore((state) => state.setCanvasAgentDefaultModel);
    const url = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const endpoint = url.trim().replace(/\/$/, "");
    const isSkillNode = node.type === CanvasNodeType.Skill;
    const enabled = isSkillNode || node.metadata?.agentMode === true || (node.metadata?.agentMode == null && Boolean(node.metadata?.agentSkillName));
    const selectedName = (isSkillNode ? node.metadata?.skillName : node.metadata?.agentSkillName) || "";
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [planSession, setPlanSession] = useState<ChatGPTPlanSession>({ connected: false });
    const [planModels, setPlanModels] = useState<ChatGPTPlanModel[]>([]);
    const [planLoading, setPlanLoading] = useState(false);
    const [planError, setPlanError] = useState("");
    const [authUrl, setAuthUrl] = useState("");
    const [signingIn, setSigningIn] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const provider: CanvasAgentProvider = node.metadata?.agentProvider || canvasAgentDefaults.provider;

    useEffect(() => {
        let active = true;
        if (!enabled || !connected || !endpoint || !token) {
            setSkills([]);
            setLoading(false);
            setLoadError("");
            return () => { active = false; };
        }
        setLoading(true);
        setLoadError("");
        void fetchCodexSkills(endpoint, token, true).then((response) => {
            if (!active) return;
            setSkills(response.data || []);
        }).catch((error: unknown) => {
            if (active) setLoadError(error instanceof Error ? error.message : t("canvas.agentStep.skillsUnavailable"));
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [connected, enabled, endpoint, skillsRefreshKey, token, t]);

    useEffect(() => {
        let active = true;
        if (!enabled || provider !== "chatgpt-plan") {
            setPlanSession({ connected: false });
            setPlanModels([]);
            setPlanError("");
            setAuthUrl("");
            return () => { active = false; };
        }
        if (!connected || !endpoint || !token) {
            setPlanSession({ connected: false });
            setPlanModels([]);
            setPlanLoading(false);
            setPlanError("");
            return () => { active = false; };
        }
        const refresh = async () => {
            setPlanLoading(true);
            setPlanError("");
            try {
                const session = await fetchChatGPTPlanSession(endpoint, token);
                if (!active) return;
                setPlanSession(session);
                if (!session.connected) {
                    setPlanModels([]);
                    return;
                }
                const response = await fetchChatGPTPlanModels(endpoint, token);
                if (active) setPlanModels(response.data || []);
            } catch (error) {
                if (active) setPlanError(error instanceof Error ? error.message : t("canvas.agentStep.chatgptRequestFailed"));
            } finally {
                if (active) setPlanLoading(false);
            }
        };
        void refresh();
        window.addEventListener("focus", refresh);
        return () => { active = false; window.removeEventListener("focus", refresh); };
    }, [connected, enabled, endpoint, provider, token]);

    const connectChatGPT = async () => {
        const popup = window.open("about:blank", "_blank");
        if (popup) popup.opener = null;
        setSigningIn(true);
        setPlanError("");
        setAuthUrl("");
        try {
            const response = await startChatGPTPlanSignIn(endpoint, token);
            if (!response.url) throw new Error(t("canvas.agentStep.chatgptRequestFailed"));
            if (popup) popup.location.replace(response.url);
            else setAuthUrl(response.url);
        } catch (error) {
            if (popup && !popup.closed) {
                try {
                    popup.document.title = "Infinite Canvas";
                    popup.document.body.textContent = error instanceof Error ? error.message : t("canvas.agentStep.chatgptSignInFailed");
                } catch {}
            }
            setPlanError(error instanceof Error ? error.message : t("canvas.agentStep.chatgptRequestFailed"));
        } finally {
            setSigningIn(false);
        }
    };

    const disconnectChatGPT = async () => {
        setDisconnecting(true);
        setPlanError("");
        try {
            const response = await disconnectChatGPTPlan(endpoint, token);
            setPlanSession({ connected: false });
            setPlanModels([]);
            setAuthUrl("");
            if (!response.revoked) setPlanError(t("canvas.agentStep.chatgptRevocationUnconfirmed"));
        } catch (error) {
            setPlanError(error instanceof Error ? error.message : t("canvas.agentStep.chatgptRequestFailed"));
        } finally {
            setDisconnecting(false);
        }
    };

    const available = skills.filter((skill) => skill.managed && skill.enabled);
    const selectedAvailable = available.some((skill) => skill.name === selectedName);
    const showSkillSelector = isSkillNode || Boolean(node.metadata?.agentSkillName);
    const warning = isSkillNode
        ? !selectedName || !connected || loading || Boolean(loadError) || !selectedAvailable
        : selectedName && (!connected || loading || Boolean(loadError) || !selectedAvailable);
    const warningMessage = !connected
        ? t("canvas.agentStep.skillsUnavailable")
        : loadError
          ? loadError
          : loading
            ? t("canvas.agentStep.checkingSkill")
            : !selectedName
              ? t("canvas.agentStep.chooseSkill")
              : t(isSkillNode ? "canvas.agentStep.missingSkillNode" : "canvas.agentStep.missingSkill", { name: selectedName });
    const options: AgentSelectOption[] = [
        { value: "", label: t(isSkillNode ? "canvas.agentStep.chooseSkill" : "canvas.agentStep.noSkill") },
        ...available.map((skill) => ({ value: skill.name, label: skill.interface?.displayName || skill.name })),
        ...(selectedName && !selectedAvailable ? [{ value: selectedName, label: `${selectedName} · ${t("canvas.agentStep.unavailable")}`, disabled: true }] : []),
    ];

    return (
        <div className="mt-2 rounded-xl border px-3 py-2" style={{ borderColor: theme.toolbar.border }}>
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">{t(isSkillNode ? "canvas.agentStep.skillSettings" : "canvas.agentStep.label")}</span>
                {isSkillNode ? null : <Switch size="small" checked={enabled} aria-label={t("canvas.agentStep.label")} onChange={(agentMode) => onChange({ agentMode })} />}
            </div>
            {enabled ? (
                <>
                    <div className="mt-1 text-[10px]" style={{ color: theme.node.muted }}>{t("canvas.agentStep.defaultsTip")}</div>
                    <div className="mt-2 grid gap-1">
                        <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.agentStep.provider")}</span>
                        <AgentSelect
                            value={provider}
                            options={[{ value: "openai-compatible", label: t("canvas.agentStep.openAICompatible") }, { value: "chatgpt-plan", label: t("canvas.agentStep.chatgptPlan") }]}
                            ariaLabel={t("canvas.agentStep.provider")}
                            theme={theme}
                            onChange={(value) => {
                                const agentProvider = value as CanvasAgentProvider;
                                setCanvasAgentDefaultProvider(agentProvider);
                                const model = isSkillNode
                                    ? agentProvider === "chatgpt-plan"
                                        ? canvasAgentDefaults.models[agentProvider] || planModels[0]?.model
                                        : resolveModelForCapability(config, canvasAgentDefaults.models[agentProvider], "text")
                                    : undefined;
                                onChange({ agentProvider, model: model || undefined });
                            }}
                        />
                    </div>
                    {provider === "chatgpt-plan" ? (
                        <div className="mt-2 grid gap-2">
                            <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.agentStep.chatgptPlanHint")}</span>
                            {!connected ? (
                                <Alert type="info" showIcon message={t("canvas.agentStep.connectLocalAgent")} action={<Button type="link" size="small" onClick={openAgentPanel}>{t("canvas.agentStep.openLocalAgent")}</Button>} />
                            ) : planSession.connected ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: theme.toolbar.panel }}>
                                    <span className="min-w-0 truncate text-xs">{t("canvas.agentStep.chatgptConnected", { email: planSession.email || "" })}</span>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <a className="text-xs underline" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">{t("canvas.agentStep.manageUsage")}</a>
                                        <Button type="text" size="small" loading={disconnecting} onClick={() => void disconnectChatGPT()}>{t("canvas.agentStep.disconnect")}</Button>
                                    </div>
                                </div>
                            ) : (
                                <Button size="small" loading={signingIn} onClick={() => authUrl ? window.open(authUrl, "_blank", "noopener,noreferrer") : void connectChatGPT()}>
                                    {t("canvas.agentStep.continueWithChatgpt")}
                                </Button>
                            )}
                            {connected ? (
                                <div className="grid gap-1">
                                    <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.agentStep.model")}</span>
                                    <AgentSelect
                                        value={planModels.some((item) => item.model === (node.metadata?.model || canvasAgentDefaults.models["chatgpt-plan"])) ? node.metadata?.model || canvasAgentDefaults.models["chatgpt-plan"] : ""}
                                        disabled={!planSession.connected || planLoading || !planModels.length}
                                        placeholder={t("canvas.agentStep.chatgptChooseModel")}
                                        options={planModels.map((item) => ({ value: item.model, label: item.displayName }))}
                                        ariaLabel={t("canvas.agentStep.model")}
                                        loading={planLoading}
                                        theme={theme}
                                        onChange={(model) => {
                                            setCanvasAgentDefaultProvider("chatgpt-plan");
                                            setCanvasAgentDefaultModel("chatgpt-plan", model);
                                            onChange({ agentProvider: "chatgpt-plan", model });
                                        }}
                                    />
                                </div>
                            ) : null}
                            {planError ? <Alert type="warning" showIcon message={planError} /> : null}
                        </div>
                    ) : (
                        <div className="mt-2 grid gap-1">
                            <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.agentStep.model")}</span>
                            <ModelPicker
                                config={config}
                                value={resolveModelForCapability(config, node.metadata?.model || canvasAgentDefaults.models["openai-compatible"], "text")}
                                capability="text"
                                fullWidth
                                onChange={(model) => {
                                    setCanvasAgentDefaultProvider("openai-compatible");
                                    setCanvasAgentDefaultModel("openai-compatible", model);
                                    onChange({ agentProvider: "openai-compatible", model });
                                }}
                                onMissingConfig={() => openConfigDialog(true, "channels")}
                            />
                        </div>
                    )}
                    {showSkillSelector ? (
                        <div className="mt-2 flex items-center gap-2">
                            <span className="shrink-0 text-xs" style={{ color: theme.node.muted }}>{t("canvas.agentStep.skill")}</span>
                            <AgentSelect
                                className="min-w-0 flex-1"
                                value={selectedName}
                                disabled={!connected || loading || Boolean(loadError)}
                                options={options}
                                ariaLabel={t("canvas.agentStep.skill")}
                                loading={loading}
                                theme={theme}
                                onChange={(skillName) => {
                                    if (!isSkillNode) {
                                        onChange({ agentSkillName: skillName || undefined });
                                        return;
                                    }
                                    const model = node.metadata?.model || (provider === "chatgpt-plan"
                                        ? canvasAgentDefaults.models[provider] || planModels[0]?.model
                                        : resolveModelForCapability(config, canvasAgentDefaults.models[provider], "text"));
                                    onChange({ skillName: skillName || undefined, agentProvider: provider, model: model || undefined });
                                }}
                            />
                            <Button type="text" size="small" className="!h-7 !w-7 !min-w-7 !p-0" disabled={!connected || loading} loading={loading} aria-label={t("agent.skills.reloadSkill")} title={t("agent.skills.reloadSkill")} onClick={() => setSkillsRefreshKey((key) => key + 1)} icon={loading ? undefined : <RefreshCw className="size-3.5" />} />
                        </div>
                    ) : null}
                    {warning ? <Alert className="mt-2" type="warning" showIcon message={warningMessage} action={!connected ? <Button type="link" size="small" onClick={openAgentPanel}>{t("canvas.agentStep.openLocalAgent")}</Button> : undefined} /> : null}
                </>
            ) : null}
        </div>
    );
}

type AgentSelectOption = { value: string; label: string; disabled?: boolean };

function AgentSelect({
    value,
    options,
    onChange,
    theme,
    ariaLabel,
    placeholder,
    disabled = false,
    loading = false,
    className = "w-full",
}: {
    value: string;
    options: AgentSelectOption[];
    onChange: (value: string) => void;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    ariaLabel: string;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    className?: string;
}) {
    return (
        <div className={`relative min-w-0 ${className}`}>
            <select
                className="h-7 w-full appearance-none rounded-md border px-2.5 pr-8 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                value={value}
                disabled={disabled}
                aria-label={ariaLabel}
                onChange={(event) => onChange(event.target.value)}
            >
                {placeholder ? <option value="" disabled>{placeholder}</option> : null}
                {options.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </option>
                ))}
            </select>
            {loading ? <LoaderCircle className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 animate-spin opacity-70" /> : <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 opacity-70" />}
        </div>
    );
}
