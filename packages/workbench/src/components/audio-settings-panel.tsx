import { type ReactNode } from "react";

import { normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@workbench/lib/audio-generation";
import { normalizeGenerationOptions, visibleOptions } from "@workbench/lib/generation-options";
import { type CanvasTheme } from "@workbench/lib/canvas-theme";
import type { AiConfig } from "@workbench/stores/use-config-store";

type AudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: AudioSettingsPanelProps) {
    const voice = normalizeAudioVoiceValue(config.audioVoice);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const options = normalizeGenerationOptions(config.generationOptions);
    const voiceList = visibleOptions(options.audioVoice.filter((option) => option.enabled), voice);
    const formatList = visibleOptions(options.audioFormat.filter((option) => option.enabled), format);
    const speedList = visibleOptions(options.audioSpeed.filter((option) => option.enabled), speed);

    return (
        <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
            {showTitle ? <div className="text-lg font-semibold">音频设置</div> : null}
            <SettingGroup title="声音" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2.5">
                    {voiceList.map((item) => (
                        <OptionPill key={item.value} selected={voice === item.value} theme={theme} onClick={() => onConfigChange("audioVoice", item.value)}>
                            {item.label}
                        </OptionPill>
                    ))}
                </div>
            </SettingGroup>
            <SettingGroup title="格式" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2.5">
                    {formatList.map((item) => (
                        <OptionPill key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                            {item.label}
                        </OptionPill>
                    ))}
                </div>
            </SettingGroup>
            <SettingGroup title="语速" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-2.5">
                    {speedList.map((item) => (
                        <OptionPill key={item.value} selected={speed === item.value} theme={theme} onClick={() => onConfigChange("audioSpeed", item.value)}>
                            {item.label}
                        </OptionPill>
                    ))}
                </div>
                <input
                    type="number"
                    min={0.25}
                    max={4}
                    step={0.05}
                    className="h-9 w-full rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                    value={config.audioSpeed || "1"}
                    onChange={(event) => onConfigChange("audioSpeed", event.target.value)}
                    onBlur={(event) => onConfigChange("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                    onMouseDown={(event) => event.stopPropagation()}
                />
            </SettingGroup>
            <SettingGroup title="声音指令" color={theme.node.muted}>
                <textarea
                    value={config.audioInstructions || ""}
                    placeholder="例如：自然、温暖、适合旁白。"
                    className="thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                    onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                    onMouseDown={(event) => event.stopPropagation()}
                />
            </SettingGroup>
        </div>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
