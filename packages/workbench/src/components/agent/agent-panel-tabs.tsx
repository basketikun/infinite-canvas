import type { ReactNode } from "react";

import { canvasThemes } from "@workbench/lib/canvas-theme";

export function AgentPanelTabs<T extends string>({ value, items, theme, right, onChange }: { value: T; items: { value: T; label: string; icon: ReactNode }[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; right?: ReactNode; onChange: (value: T) => void }) {
    return (
        <div className="border-b px-2" style={{ borderColor: theme.node.stroke }}>
            <div className="flex h-12 items-center gap-1">
                <nav className="flex min-w-0 flex-1 items-center justify-center gap-3 text-sm" role="tablist" aria-label="Agent 内容">
                    {items.map((item) => (
                        <button key={item.value} type="button" role="tab" aria-label={item.label} aria-selected={value === item.value} className={`inline-flex h-12 min-w-8 shrink-0 items-center justify-center gap-1.5 border-b-2 px-1.5 transition ${value === item.value ? "font-medium" : "font-normal"}`} style={{ borderColor: value === item.value ? theme.node.text : "transparent", color: value === item.value ? theme.node.text : theme.node.muted }} onClick={() => onChange(item.value)}>
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
            </div>
        </div>
    );
}
