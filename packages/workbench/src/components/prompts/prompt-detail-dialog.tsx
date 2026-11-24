import { Copy, FileText, FolderPlus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";

import { formatPromptDate, type Prompt } from "@workbench/services/api/prompts";

type PromptDetailDialogProps = {
    prompt: Prompt | null;
    onClose: () => void;
    onCopy: (prompt: string) => void;
    onSaveAsset?: (prompt: Prompt) => void;
    container?: HTMLElement | null;
};

export function PromptDetailDialog({ prompt: selected, onClose, onCopy, onSaveAsset, container: parent }: PromptDetailDialogProps) {
    const [closing, setClosing] = useState<{ prompt: Prompt; container?: HTMLElement | null } | null>(null);
    const prompt = selected ?? closing?.prompt;
    const container = selected ? parent : closing?.container;
    const trigger = useRef<HTMLElement | null>(null);
    const scrollTop = useRef(0);
    const restoreScroll = useCallback((element: HTMLDivElement | null) => {
        if (element) element.scrollTop = scrollTop.current;
    }, []);
    const layer = { zIndex: container ? 1200 : 1000 };
    return (
        <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => {
            if (open || !selected) return;
            setClosing({ prompt: selected, container: parent });
            onClose();
        }}>
            {prompt && <Dialog.Portal container={container}>
                <Dialog.Overlay className="fixed inset-0 bg-black/45 duration-300 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0" style={layer} />
                <Dialog.Content aria-describedby={undefined} style={layer}
                    className="workbench-dialog prompt-detail fixed top-1/2 left-1/2 w-[calc(100%_-_16px)] max-w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none duration-300 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-open:zoom-in-95 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:zoom-out-95"
                    onOpenAutoFocus={() => {
                        trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    }}
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        setClosing(null);
                        if (trigger.current?.isConnected && (document.activeElement === document.body || document.activeElement === container || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) {
                            trigger.current.focus({ preventScroll: true });
                        }
                    }}>
                    <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded text-current/50 transition hover:bg-muted hover:text-current">
                        <X aria-hidden className="size-5" />
                    </Dialog.Close>
                    <Dialog.Title className="mb-2 pr-8 text-base font-semibold leading-6">{prompt.title}</Dialog.Title>
                    <div className="flex h-[calc(85vh_-_55px)] min-h-0 flex-col overflow-hidden">
                        <div className="shrink-0 space-y-3 pb-4">
                            {prompt.coverUrl
                                ? <img src={prompt.coverUrl} alt={prompt.title} className="h-48 w-full rounded-lg object-cover sm:h-56" />
                                : <div className="grid h-48 w-full place-items-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600 sm:h-56"><FileText className="size-9" /></div>}
                            {prompt.referenceImageUrls.length > 1 && <div className="grid grid-cols-6 gap-2">
                                {prompt.referenceImageUrls.filter((url) => url !== prompt.coverUrl).slice(0, 6).map((url) => (
                                    <img key={url} src={url} alt="" className="aspect-square w-full rounded-md object-cover" loading="lazy" />
                                ))}
                            </div>}
                        </div>
                        <div ref={restoreScroll} onScroll={(event) => { scrollTop.current = event.currentTarget.scrollTop; }} role="region" aria-label="提示词内容" tabIndex={0}
                            className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                            <div className="flex flex-wrap gap-1.5">
                                {prompt.tags.map((tag) => <span key={tag} className="prompt-detail-tag">{tag}</span>)}
                            </div>
                            {prompt.description && <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{prompt.description}</p>}
                            {prompt.preview && <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre>}
                            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                            {(prompt.createdAt || prompt.updatedAt) && <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                                {prompt.createdAt && `创建：${formatPromptDate(prompt.createdAt)}`}
                                {prompt.createdAt && prompt.updatedAt && " · "}
                                {prompt.updatedAt && `更新：${formatPromptDate(prompt.updatedAt)}`}
                            </div>}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2 pt-4">
                            <Button size="sm" type="button" onClick={() => onCopy(prompt.prompt)}><Copy className="size-4" />复制提示词</Button>
                            {onSaveAsset && <Button type="button" size="sm" variant="outline" onClick={() => onSaveAsset(prompt)}><FolderPlus className="size-4" />加入我的资产</Button>}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>}
        </Dialog.Root>
    );
}
