import { useState } from "react";
import { Button, Tooltip } from "antd";
import { BookOpen } from "lucide-react";

import { useTranslation } from "@/components/layout/locale-provider";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasPromptLibrary({ onSelect }: { onSelect: (prompt: string) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title={t("canvas.promptLibrary.title")}>
                <Button
                    type="text"
                    className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                    style={{ color: theme.node.text }}
                    icon={<BookOpen className="size-3.5" />}
                    onClick={() => setOpen(true)}
                    aria-label={t("canvas.promptLibrary.title")}
                />
            </Tooltip>
            <PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={onSelect} />
        </>
    );
}
