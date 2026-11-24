import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, type ReactNode } from "react";

export function CanvasDialog({ title, open, onClose, description, width, top, hideTitle, children }: { title: string; open: boolean; onClose: () => void; description?: string; width?: number; top?: boolean; hideTitle?: boolean; children: ReactNode }) {
    const content = useRef<HTMLDivElement>(null);
    const opener = useRef<HTMLElement | null>(null);
    return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[1000] bg-black/45" />
            <Dialog.Content ref={content} role={description ? "alertdialog" : "dialog"} aria-modal="true" data-canvas-shortcuts-ignore
                {...(!description && { "aria-describedby": undefined })}
                style={{ width }}
                className={`workbench-dialog fixed inset-x-0 z-[1000] mx-auto h-fit max-h-[calc(100dvh_-_16px)] max-w-[calc(100vw_-_16px)] overflow-auto rounded-lg bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none ${top ? "top-[min(100px,5dvh)] sm:top-[min(100px,10dvh)]" : "inset-y-0 my-auto"} ${width ? "" : description ? "w-[520px]" : "w-max"}`}
                onOpenAutoFocus={event => {
                    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    const cancel = event.currentTarget instanceof HTMLElement && event.currentTarget.querySelector<HTMLElement>("[data-cancel]");
                    if (cancel) { event.preventDefault(); cancel.focus(); }
                }}
                onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }}
                onEscapeKeyDown={event => {
                    if (content.current?.querySelector(".workbench-image-preview, [data-canvas-resource-mention-menu]")) event.preventDefault();
                    else event.stopPropagation();
                }}>
                <Dialog.Title className={hideTitle ? "sr-only" : "mb-2 pr-7 text-base font-semibold"}>{title}</Dialog.Title>
                <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 place-items-center rounded text-current/60 hover:bg-muted"><X className="size-4" /></Dialog.Close>
                {description && <Dialog.Description className="text-sm opacity-60">{description}</Dialog.Description>}
                {children}
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}
