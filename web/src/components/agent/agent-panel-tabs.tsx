import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

export function AgentPanelTabs<T extends string>({ value, items, theme, leading, right, onChange }: { value: T; items: { value: T; label: string; icon?: ReactNode; count?: number }[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; leading?: ReactNode; right?: ReactNode; onChange: (value: T) => void }) {
    const { t } = useTranslation();
    return (
        <div className="@container border-b px-2" style={{ borderColor: theme.node.stroke }}>
            <div className="flex h-12 items-center gap-1">
                {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
                <nav className="flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-hidden text-sm @min-[560px]:gap-3" role="tablist" aria-label={t("agent.panel.content")}>
                    {items.map((item) => {
                        const count = item.count ? (item.count > 99 ? "99+" : String(item.count)) : "";
                        return (
                        <Tooltip key={item.value} title={`${item.label}${count ? ` ${count}` : ""}`} placement="bottom">
                            <button type="button" role="tab" aria-label={`${item.label}${count ? ` ${count}` : ""}`} aria-selected={value === item.value} className={`relative inline-flex h-12 min-w-8 shrink-0 items-center justify-center gap-1.5 border-b-2 px-1.5 transition @min-[560px]:px-0.5 ${value === item.value ? "font-medium" : "font-normal"}`} style={{ borderColor: value === item.value ? theme.node.text : "transparent", color: value === item.value ? theme.node.text : theme.node.muted }} onClick={() => onChange(item.value)}>
                                {item.icon ? (
                                    <span className="relative">
                                        <span className="agent-panel-tab-icon">{item.icon}</span>
                                        {count ? <span className="absolute -right-2 -top-1 text-[9px] font-normal leading-none tabular-nums opacity-60 @min-[360px]:hidden">{count}</span> : null}
                                    </span>
                                ) : null}
                                <span className={item.icon ? "hidden @min-[360px]:inline" : undefined}>{item.label}</span>
                                {count ? <span className="hidden text-[10px] font-normal leading-none tabular-nums opacity-60 @min-[360px]:inline">{count}</span> : null}
                            </button>
                        </Tooltip>
                        );
                    })}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
            </div>
        </div>
    );
}
