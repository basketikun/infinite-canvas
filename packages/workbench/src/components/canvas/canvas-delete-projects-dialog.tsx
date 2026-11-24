import { useRef } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { LoaderCircle, X } from "lucide-react";

import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@workbench/stores/canvas/use-canvas-ui-store";
import { useCanvasProjectActions } from "@workbench/hooks/use-canvas-project-actions";

export function CanvasDeleteProjectsDialog() {
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const { deleteProjects } = useCanvasProjectActions(`delete-projects:${JSON.stringify(ids)}`);
    const deletions = useCanvasStore((state) => state.projectDeletions);
    const deleting = ids.some((id) => deletions[id] === "pending");
    const failed = ids.some((id) => deletions[id] === "error");
    const opener = useRef<HTMLElement | null>(null);
    const confirm = async () => {
        if (!await deleteProjects(ids) || useCanvasUiStore.getState().deleteProjectIds !== ids) return;
        removeSelectedIds(ids);
        setDeleteIds([]);
    };

    return (
        <AlertDialog.Root open={ids.length > 0} onOpenChange={(open) => { if (!open) setDeleteIds([]); }}>
            <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-[1000] bg-black/45" onClick={() => setDeleteIds([])} />
                <AlertDialog.Content className="workbench-dialog generation-workspace-controls fixed left-1/2 top-1/2 z-[1000] w-[calc(100%_-_16px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none"
                    onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (opener.current?.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) opener.current.focus({ preventScroll: true });
                    }}>
                    <button type="button" aria-label="关闭" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded text-current/50 hover:bg-muted hover:text-current" onClick={() => setDeleteIds([])}>
                        <X aria-hidden className="size-5" strokeWidth={1.7} />
                    </button>
                    <AlertDialog.Title className="mb-2 pr-8 text-base font-semibold leading-6">删除画布？</AlertDialog.Title>
                    <AlertDialog.Description className="text-sm text-stone-500">
                        {failed ? "部分画布尚未删除完成，请重试。" : `将删除 ${ids.length} 个画布，节点、连线和聊天记录也会一起移除。正在进行的聊天将停止。`}
                    </AlertDialog.Description>
                    <footer className="mt-3 flex justify-end gap-2">
                        <AlertDialog.Cancel asChild><Button variant="outline" aria-label={deleting || failed ? "关闭" : "取消"}>{deleting || failed ? "关 闭" : "取 消"}</Button></AlertDialog.Cancel>
                        <Button variant="destructive" className="bg-(--workbench-message-error) enabled:text-white! hover:bg-(--workbench-message-error)" aria-label={failed ? "重试删除" : "删除"} aria-busy={deleting} disabled={deleting} onClick={confirm}>
                            {deleting && <LoaderCircle aria-hidden className="size-4 animate-spin" />}{failed ? "重试删除" : "删 除"}
                        </Button>
                    </footer>
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
}
