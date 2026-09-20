import { ArrowUpRight, Bot, ImagePlus, Sprout, Type } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeTypeId } from "@/types/canvas";

export const CanvasEmptyState = memo(function CanvasEmptyState({ onAddNode, onImport, onOpenAgent }: { onAddNode: (type: CanvasNodeTypeId) => void; onImport: () => void; onOpenAgent: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const actions = [
        { key: "seed", icon: Sprout, label: t("canvas.emptyState.seed"), description: t("canvas.emptyState.seedDescription"), onClick: () => onAddNode(CanvasNodeType.Seed) },
        { key: "text", icon: Type, label: t("canvas.emptyState.text"), description: t("canvas.emptyState.textDescription"), onClick: () => onAddNode(CanvasNodeType.Text) },
        { key: "import", icon: ImagePlus, label: t("canvas.emptyState.import"), description: t("canvas.emptyState.importDescription"), onClick: onImport },
        { key: "agent", icon: Bot, label: t("canvas.emptyState.agent"), description: t("canvas.emptyState.agentDescription"), onClick: onOpenAgent },
    ];

    return (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6 pb-20 pt-24">
            <div className="w-full max-w-[720px] animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="mb-7 text-center">
                    <div className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl border" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}>
                        <Sprout className="size-5" />
                    </div>
                    <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-3xl" style={{ color: theme.node.text }}>{t("canvas.emptyState.title")}</h2>
                    <p className="mx-auto mt-2 max-w-lg text-sm leading-6" style={{ color: theme.node.muted }}>{t("canvas.emptyState.description")}</p>
                </div>
                <div className="pointer-events-auto grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {actions.map(({ key, icon: Icon, label, description, onClick }) => (
                        <button
                            key={key}
                            type="button"
                            className="group flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left backdrop-blur-xl transition duration-200 hover:-translate-y-0.5"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: "0 14px 38px rgba(0,0,0,.08)" }}
                            onClick={onClick}
                        >
                            <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: theme.toolbar.itemHover, color: theme.toolbar.activeText }}><Icon className="size-4.5" /></span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold" style={{ color: theme.node.text }}>{label}</span>
                                <span className="mt-0.5 block truncate text-xs" style={{ color: theme.node.muted }}>{description}</span>
                            </span>
                            <ArrowUpRight className="size-4 shrink-0 opacity-25 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-70" />
                        </button>
                    ))}
                </div>
                <p className="mt-4 text-center text-xs" style={{ color: theme.node.faint }}>{t("canvas.emptyState.hint")}</p>
            </div>
        </div>
    );
});
