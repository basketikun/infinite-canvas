"use client";

import { type ReactNode } from "react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { seedreamAdapter } from "@/services/api/image-adapters";
import type { AiConfig } from "@/stores/use-config-store";

const SEEDREAM_PRESETS = seedreamAdapter.ui.presetSizes || [];

type SeedreamImageSettingsPanelProps = {
  config: AiConfig;
  onConfigChange: (key: "quality" | "size" | "count", value: string) => void;
  theme: CanvasTheme;
  showTitle?: boolean;
  className?: string;
  maxCount?: number;
};

export function SeedreamImageSettingsPanel({
  config,
  onConfigChange,
  theme,
  showTitle = true,
  className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5",
  maxCount = 15,
}: SeedreamImageSettingsPanelProps) {
  const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
  const activeSize = config.size || "2K";
  const is2k = !activeSize.startsWith("4K");
  const filteredSizes = SEEDREAM_PRESETS.filter((s) => is2k ? s.id.startsWith("2K") : s.id.startsWith("4K"));

  const selectSize = (value: string) => {
    onConfigChange("size", value);
  };

  return (
    <ImageSettingsTheme theme={theme}>
      <div
        className={className}
        style={{ color: theme.node.text }}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (event.target instanceof HTMLInputElement) return;
          if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement))
            document.activeElement.blur();
        }}
      >
        {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}

        {/* Resolution toggle: 2K / 4K */}
        <div className="space-y-2.5">
          <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
            分辨率
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              className="h-9 flex-1 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
              style={{
                background: "transparent",
                borderColor: is2k ? theme.node.text : theme.node.stroke,
                color: theme.node.text,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (!is2k) selectSize("2K");
              }}
            >
              2K
            </button>
            <button
              type="button"
              className="h-9 flex-1 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
              style={{
                background: "transparent",
                borderColor: !is2k ? theme.node.text : theme.node.stroke,
                color: theme.node.text,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (is2k) selectSize("4K");
              }}
            >
              4K
            </button>
          </div>
        </div>

        {/* Size presets grid */}
        <div className="space-y-2.5">
          <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
            尺寸
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {filteredSizes.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                style={{
                  borderColor: activeSize === item.id ? theme.node.text : theme.node.stroke,
                  background: "transparent",
                  color: theme.node.text,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => selectSize(item.id)}
              >
                <AspectIcon
                  width={item.width}
                  height={item.height}
                  color={activeSize === item.id ? theme.node.text : theme.node.muted}
                />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="text-xs" style={{ color: theme.node.muted }}>
            {filteredSizes.find((s) => s.id === activeSize)
              ? filteredSizes.find((s) => s.id === activeSize)!.width + " x " + filteredSizes.find((s) => s.id === activeSize)!.height
              : ""}
          </div>
        </div>

        {/* Count */}
        <div className="space-y-2.5">
          <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
            生成张数
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
              <button
                key={value}
                type="button"
                className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
                style={{
                  background: "transparent",
                  borderColor: count === value ? theme.node.text : theme.node.stroke,
                  color: theme.node.text,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onConfigChange("count", String(value))}
              >
                {value} 张
              </button>
            ))}
          </div>
        </div>
      </div>
    </ImageSettingsTheme>
  );
}

function AspectIcon({
  width,
  height,
  color,
}: {
  width: number;
  height: number;
  color: string;
}) {
  const ratio = width / Math.max(1, height);
  const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
  const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
  return (
    <span className="grid h-7 w-9 place-items-center">
      <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
    </span>
  );
}

/** Readable label for the current seedream size selection */
export function seedreamSizeLabel(size: string) {
  const preset = SEEDREAM_PRESETS.find((s) => s.id === size);
  return preset ? preset.label : size;
}
