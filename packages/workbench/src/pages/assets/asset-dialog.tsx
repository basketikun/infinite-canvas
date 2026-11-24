import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type ReactNode, useRef } from "react";

type AssetDialogProps = {
    open: boolean;
    title: string;
    width: number;
    trigger?: HTMLElement | null;
    descriptionId?: string;
    onDismiss: () => void;
    onClosed?: () => void;
    onEscapeKeyDown?: (event: KeyboardEvent) => void;
    action: ReactNode;
    leadingAction?: ReactNode;
    children: ReactNode;
};

export function AssetDialog({ open, title, width, trigger, descriptionId, onDismiss, onClosed, onEscapeKeyDown, action, leadingAction, children }: AssetDialogProps) {
    const closeButton = useRef<HTMLButtonElement>(null);
    const opener = useRef<HTMLElement | null>(null);
    return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onDismiss(); }}>
        <Dialog.Portal>
            <Dialog.Overlay className="asset-dialog-overlay fixed inset-0 z-[1000] overflow-y-auto bg-black/45">
                <Dialog.Content aria-describedby={descriptionId} className="asset-dialog-body workbench-dialog relative mx-auto rounded-[8px] bg-(--workbench-elevated-panel) px-6 py-5 outline-none" style={{ maxWidth: width }}
                    onEscapeKeyDown={onEscapeKeyDown}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        opener.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
                        closeButton.current?.focus({ preventScroll: true });
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (open) return;
                        if (opener.current?.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) opener.current.focus({ preventScroll: true });
                        onClosed?.();
                    }}>
                    <Dialog.Close ref={closeButton} aria-label="关闭" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded text-current/50 hover:bg-muted hover:text-current"><X aria-hidden className="size-5" strokeWidth={1.7} /></Dialog.Close>
                    <Dialog.Title className="mb-2 text-base font-semibold leading-6">{title}</Dialog.Title>
                    {children}
                    <footer className="mt-3 flex items-center gap-2">
                        {leadingAction ? <div className="mr-auto flex gap-2">{leadingAction}</div> : null}
                        <Dialog.Close asChild><Button type="button" variant="outline" aria-label="取消">取 消</Button></Dialog.Close>
                        {action}
                    </footer>
                </Dialog.Content>
            </Dialog.Overlay>
        </Dialog.Portal>
    </Dialog.Root>;
}
