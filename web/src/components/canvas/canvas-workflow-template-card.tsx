import { Button } from "antd";
import { ArrowUpRight, Trash2, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasWorkflowTemplate } from "@/types/canvas-workflow-template";

export function CanvasWorkflowTemplateCard({ template, onOpen, onDelete }: { template: CanvasWorkflowTemplate; onOpen: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    return (
        <article className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-300"><Workflow className="size-4" /></span>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{template.title}</h3>
                    <p className="mt-1 text-xs text-stone-500">{t("canvas.workflow.created", { date: new Date(template.createdAt).toLocaleDateString() })}</p>
                    <p className="mt-1 text-xs text-stone-500">{t("canvas.workflow.graphSummary", { nodes: template.nodes.length, connections: template.connections.length })}</p>
                </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
                <Button size="small" type="primary" icon={<ArrowUpRight className="size-3.5" />} onClick={onOpen}>{t("canvas.workflow.open")}</Button>
                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>{t("canvas.workflow.delete")}</Button>
            </div>
        </article>
    );
}
