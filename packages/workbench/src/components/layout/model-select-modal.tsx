import type { ModelGroup } from "@infinite-canvas/shared/channels";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { CircleX, Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState } from "react";

import { ModelIcon } from "@workbench/components/model-icon";
import styles from "./app-config-modal.module.css";

export type FetchedModelList = { models: string[]; trigger: HTMLButtonElement; signal: AbortSignal };

export function ModelSelectModal({ group, models, trigger, signal, onConfirm, onClose }: FetchedModelList & { group: ModelGroup; onConfirm: (names: string[]) => void; onClose: () => void }) {
    const dismissed = useRef(false);
    const searchInput = useRef<HTMLInputElement>(null);
    const container = trigger.closest<HTMLElement>('[role="dialog"]');
    const [selected, setSelected] = useState(() => new Set<string>());
    const [search, setSearch] = useState("");
    const existing = new Set(group.models.map((model) => model.name));
    const visible = models.filter((name) => name.toLowerCase().includes(search.toLowerCase()));
    const selectable = visible.filter((name) => !existing.has(name));
    const selectedCount = selectable.filter((name) => selected.has(name)).length;

    const dismiss = () => {
        dismissed.current = true;
        onClose();
    };
    const toggle = (name: string, checked: boolean) => {
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });
    };

    const selectVisible = (checked: boolean) => {
        setSelected((current) => {
            const next = new Set(current);
            selectable.forEach((name) => checked ? next.add(name) : next.delete(name));
            return next;
        });
    };

    return (
        <Dialog.Root open onOpenChange={(next) => { if (!next) dismiss(); }}>
            <Dialog.Portal container={container}>
                <Dialog.Overlay className="pointer-events-auto fixed inset-0 z-[1100] flex flex-col overflow-y-auto bg-black/45 p-2 md:px-4">
                    <Dialog.Content aria-describedby={undefined} className={`${styles.channels} model-selection settings-network generation-workspace-controls workbench-dialog relative m-auto w-full max-w-[760px] shrink-0 rounded-lg bg-(--workbench-elevated-panel) px-6 py-5 outline-none`}
                        onEscapeKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            if (!dismissed.current || signal.aborted || !trigger.isConnected) return;
                            const active = document.activeElement;
                            if (active === document.body || active === container || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(active)) {
                                trigger.focus({ preventScroll: true });
                            }
                        }}>
                        <Dialog.Close aria-label="关闭" className="absolute top-3 right-3 grid size-8 cursor-pointer place-items-center rounded text-(--channel-tertiary) hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></Dialog.Close>
                        <Dialog.Title className="mb-2 pr-7 text-base leading-6 font-semibold [overflow-wrap:anywhere]">{group.name} · 选择模型</Dialog.Title>
                        <div className="flex max-h-[62vh] flex-col gap-4">
                            <div className="settings-network-field flex shrink-0 items-center gap-1">
                                <Search aria-hidden className="size-4 shrink-0 text-(--channel-tertiary)" />
                                <Input ref={searchInput} aria-label="搜索拉取到的模型" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型" />
                                <button type="button" className={search ? undefined : "invisible"} aria-label="清空搜索" onClick={() => { setSearch(""); searchInput.current?.focus(); }}><CircleX aria-hidden className="size-3" /></button>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                                <span className="text-xs text-(--channel-secondary)">共 {models.length} 个模型 · 待添加 {selected.size} 个</span>
                                <div className="flex gap-2">
                                    <Button type="button" variant="ghost" size="xs" disabled={!selectable.length} onClick={() => selectVisible(true)}>全选当前列表</Button>
                                    <Button type="button" variant="ghost" size="xs" disabled={!selectedCount} onClick={() => selectVisible(false)}>取消当前列表</Button>
                                </div>
                            </div>
                            <div className="min-h-0 overflow-y-auto overscroll-contain">
                                {visible.length ? <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                                    {visible.map((name) => <label key={name} className="flex min-h-6 min-w-0 cursor-pointer items-start gap-2 pr-2 has-disabled:cursor-not-allowed">
                                        <input type="checkbox" className="workbench-checkbox size-4 shrink-0 self-center" checked={existing.has(name) || selected.has(name)} disabled={existing.has(name)} onChange={(event) => toggle(name, event.target.checked)} />
                                        <span className="flex min-w-0 items-start gap-2"><ModelIcon model={name} className="mt-0.5" />
                                            <span className="min-w-0 [overflow-wrap:anywhere]">{name}{existing.has(name) && <span className="ml-2 text-xs text-(--channel-tertiary)">已添加</span>}</span>
                                        </span>
                                    </label>)}
                                </div> : <div className="py-8 text-center text-sm text-(--channel-secondary)">没有匹配的模型，请调整搜索词。</div>}
                            </div>
                        </div>
                        <footer className="mt-3 flex flex-wrap justify-end gap-2">
                            <Dialog.Close asChild><Button type="button" variant="outline" aria-label="取消">取 消</Button></Dialog.Close>
                            <Button type="button" disabled={!selected.size} onClick={() => {
                                if (!signal.aborted) onConfirm(models.filter((name) => selected.has(name)));
                                dismiss();
                            }}>添加所选模型{selected.size ? `（${selected.size}）` : ""}</Button>
                        </footer>
                    </Dialog.Content>
                </Dialog.Overlay>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
