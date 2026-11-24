import { generationLevelLabels } from "@workbench/constant/labels";
import { type ReactNode } from "react";

import { type CanvasTheme } from "@workbench/lib/canvas-theme";
import type { AiConfig } from "@workbench/stores/use-config-store";
import type { ReasoningEffort } from "@infinite-canvas/shared/model-execution";

const reasoningEffortOptions: ReasoningEffort[] = ["auto", "low", "medium", "high", "xhigh"];

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    className?: string;
};

export function TextSettingsPanel({ config, onConfigChange, theme, className = "space-y-4" }: TextSettingsPanelProps) {
    return (
        <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-lg font-semibold">文本设置</div>
            <div className="space-y-2.5">
                <div className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    推理强度
                </div>
                <div className="grid grid-cols-5 gap-2">
                    {reasoningEffortOptions.map((value) => (
                        <OptionPill key={value} selected={config.reasoningEffort === value} theme={theme} onClick={() => onConfigChange("reasoningEffort", value)}>
                            {generationLevelLabels[value]}
                        </OptionPill>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
    return reasoningEffortOptions.includes(value) ? generationLevelLabels[value] : value;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
