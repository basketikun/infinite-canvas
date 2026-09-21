import { useEffect, useState } from "react";
import { Button, Modal } from "antd";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

function initialMarkdown(node: CanvasNodeData) {
    if (node.metadata?.document) return node.metadata.document;
    const summary = node.metadata?.summary || node.metadata?.content || "";
    return `# ${node.title}\n\n${summary}${summary ? "\n\n" : ""}## Notes\n\n`;
}

export function CanvasNodeDocumentModal({ node, open, onSave, onClose }: { node: CanvasNodeData | null; open: boolean; onSave: (nodeId: string, document: string) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState("");

    useEffect(() => {
        if (node && open) setDraft(initialMarkdown(node));
    }, [node, open]);

    const save = () => {
        if (!node) return;
        onSave(node.id, draft);
        onClose();
    };

    return (
        <Modal
            className="canvas-node-document-modal"
            title={
                <span className="flex items-center gap-2">
                    <FileText className="size-4" />
                    <span className="max-w-[60vw] truncate">{node?.title || t("canvas.node.untitled")}</span>
                    <span className="text-xs font-normal opacity-45">.md</span>
                </span>
            }
            open={open && Boolean(node)}
            width="min(1180px, calc(100vw - 40px))"
            centered
            destroyOnHidden
            onCancel={onClose}
            footer={
                <div className="flex items-center justify-between">
                    <span className="text-xs opacity-45">{t("canvas.nodeDocument.savedWithNode")}</span>
                    <div className="flex gap-2">
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button type="primary" onClick={save}>{t("common.save")}</Button>
                    </div>
                </div>
            }
            styles={{ body: { padding: 0 } }}
        >
            {node ? (
                <div className="grid h-[68vh] min-h-[480px] grid-cols-1 overflow-hidden border-y lg:grid-cols-2" style={{ borderColor: theme.node.stroke }} data-canvas-shortcuts-ignore>
                    <section className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}>
                        <div className="flex h-10 shrink-0 items-center px-4 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: theme.node.muted }}>{t("canvas.nodeDocument.markdown")}</div>
                        <textarea
                            autoFocus
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            spellCheck={false}
                            className="thin-scrollbar min-h-0 flex-1 resize-none border-0 bg-transparent px-4 pb-5 font-mono text-[13px] leading-6 outline-none"
                            style={{ color: theme.node.text }}
                            placeholder={t("canvas.nodeDocument.placeholder")}
                        />
                    </section>
                    <section className="flex min-h-0 flex-col" style={{ background: theme.node.panel }}>
                        <div className="flex h-10 shrink-0 items-center px-5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: theme.node.muted }}>{t("canvas.nodeDocument.preview")}</div>
                        <article className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-8 text-sm leading-7 sm:px-8">
                            <Streamdown>{draft}</Streamdown>
                        </article>
                    </section>
                </div>
            ) : null}
        </Modal>
    );
}
