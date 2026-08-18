import type { CSSProperties } from "react";
import { Button } from "antd";
import { Sparkles } from "lucide-react";

type PromptAssistantInputActionProps = {
    label: string;
    onClick: () => void;
    showLabel?: boolean;
    className?: string;
    style?: CSSProperties;
};

export function PromptAssistantInputAction({ label, onClick, showLabel = true, className = "", style }: PromptAssistantInputActionProps) {
    return (
        <div className="pointer-events-none absolute bottom-2 right-2 z-10">
            <Button
                size="small"
                type="text"
                icon={<Sparkles className="size-3.5" />}
                onClick={onClick}
                aria-label={label}
                title={label}
                style={style}
                className={`pointer-events-auto !h-7 !rounded-md !border !px-2.5 !shadow-sm ${className}`}
            >
                {showLabel ? label : null}
            </Button>
        </div>
    );
}
