import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";

import { reasoningEffortLabel, TextSettingsPanel } from "@workbench/components/text-settings-panel";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import type { AiConfig } from "@workbench/stores/use-config-store";
import type { ReasoningEffort } from "@infinite-canvas/shared/model-execution";

type CanvasTextSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    count?: number;
    onCountChange?: (count: number) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasTextSettingsPopover({ config, onConfigChange, count, onCountChange, buttonClassName, placement = "topLeft" }: CanvasTextSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const panel = open && buttonRect ? <TextSettingsPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} count={count} onConfigChange={onConfigChange} onCountChange={onCountChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button type="button" variant="ghost" size="sm" aria-expanded={open} className={buttonClassName || "h-8 max-w-[170px] justify-start rounded-full px-2.5"} style={{ background: theme.node.fill, color: theme.node.text }} onClick={() => setOpen((current) => !current)}>
                    <Settings2 className="size-3.5" />
                    <span className="truncate">推理 · {reasoningEffortLabel(config.reasoningEffort)}{onCountChange ? ` · ${`${count} 次`}` : ""}</span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function TextSettingsPortal({ buttonRect, panelRef, placement, theme, config, count, onConfigChange, onCountChange }: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasTextSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    count?: number;
    onConfigChange: CanvasTextSettingsPopoverProps["onConfigChange"];
    onCountChange?: (count: number) => void;
}) {

    const [draftCount, setDraftCount] = useState<string | null>(null);
    const width = 356;
    const gap = 8;
    const margin = 12;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap } : { top: buttonRect.bottom + gap }),
        background: theme.toolbar.panel,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 18,
        color: theme.node.text,
    } as const;

    return createPortal(
        <div ref={panelRef} data-canvas-no-zoom data-canvas-shortcuts-ignore style={style} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <TextSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} />
            {onCountChange ? (
                <div className="mt-4 space-y-2.5">
                    <div className="text-sm font-medium" style={{ color: theme.node.muted }}>生成次数</div>
                    <Input aria-label="生成次数" type="number" className="w-full" min={1} max={15} step={1} value={draftCount ?? count ?? ""}
                        onChange={event => {
                            const input = event.currentTarget;
                            setDraftCount(input.value);
                            if (!input.value) onCountChange(1);
                            else if (input.validity.valid) onCountChange(input.valueAsNumber);
                        }}
                        onBlur={event => {
                            const next = Math.max(1, Math.min(15, Math.round(event.currentTarget.valueAsNumber || 1)));
                            if (next !== count) onCountChange(next);
                            setDraftCount(null);
                        }} />
                </div>
            ) : null}
        </div>,
        document.body,
    );
}
