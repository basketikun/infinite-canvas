import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { CircleAlert } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useState, type ReactElement, type RefObject } from "react";
import styles from "./app-config-modal.module.css";

export function ChannelRemoveConfirmation({ question, description, action = "确定", fallbackFocus, onConfirm, children }: { question: string; description?: string; action?: "确定" | "移除"; fallbackFocus?: RefObject<HTMLInputElement | null>; onConfirm: () => void | Promise<void>; children: ReactElement }) {
    const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const descriptionId = useId();
    const navigation = trigger?.closest<HTMLElement>("[data-channel-navigation]");
    return <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger ref={setTrigger} asChild>{children}</Popover.Trigger>
        <Popover.Portal container={trigger?.closest<HTMLElement>('[role="dialog"]')}>
            <Popover.Content side="top" sideOffset={5} role="alertdialog" aria-label={question} aria-describedby={description ? descriptionId : undefined}
                className={`${styles.channelConfirmation} workbench-dialog generation-workspace-controls settings-network pointer-events-auto z-[1100] max-w-[calc(100vw_-_16px)] rounded-lg bg-(--workbench-elevated-panel) p-3 shadow-lg outline-none`}
                onEscapeKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => {
                    if ((!trigger?.isConnected || trigger.disabled) && document.activeElement === document.body) {
                        event.preventDefault();
                        const target = fallbackFocus?.current ?? navigation?.querySelector<HTMLElement>('[aria-current="true"], [role="combobox"]') ?? navigation?.querySelector("button");
                        if (target?.isConnected) target.focus({ preventScroll: true });
                    }
                }}>
                <div className="flex items-start gap-2"><CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 fill-[light-dark(#faad14,#d89614)] text-(--workbench-elevated-panel)" /><span className="min-w-0 break-words">{question}</span></div>
                {description && <p id={descriptionId} className="mt-1 ml-[22px]">{description}</p>}
                <div className="mt-2 flex justify-end gap-2">
                    <Popover.Close asChild><Button type="button" variant="outline" size="xs" aria-label="取消">取 消</Button></Popover.Close>
                    <Button type="button" variant={action === "移除" ? "destructive" : "default"} size="xs" aria-label={action} disabled={pending} onClick={async (event) => {
                        const button = event.currentTarget;
                        const saved = onConfirm();
                        if (saved) {
                            setPending(true);
                            try { await saved; } finally { setPending(false); }
                        }
                        if (button.isConnected) setOpen(false);
                    }}>{action === "移除" ? "移 除" : "确 定"}</Button>
                </div>
                <Popover.Arrow width={14} height={7} className="fill-(--workbench-elevated-panel)" />
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>;
}
