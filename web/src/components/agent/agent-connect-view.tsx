import { Button, Input } from "antd";
import { KeyRound, Link2, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

export function AgentConnectView({
    theme,
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 text-base font-semibold leading-6">{t("agent.connect.title")}</span>
                            <span
                                className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                            >
                                <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                <span className="truncate">{statusText}</span>
                            </span>
                        </div>
                        <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                            {t("agent.connect.description")}
                        </div>
                    </div>
                    <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                        {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                    </Button>
                </div>
                <div className="grid gap-2.5">
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                            <Link2 className="size-3.5" />
                            {t("agent.connect.address")}
                        </span>
                        <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                    </label>
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                            <KeyRound className="size-3.5" />
                            {t("agent.connect.token")}
                        </span>
                        <Input.Password
                            size="large"
                            prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                            value={token}
                            onChange={(event) => onTokenChange(event.target.value)}
                            placeholder={t("agent.connect.tokenPlaceholder")}
                        />
                    </label>
                    {connectError ? (
                        <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                            {connectError}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
