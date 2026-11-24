import { LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { getStorageError, subscribeStorageError } from "@workbench/services/storage/status";
import { channelWrites } from "@workbench/stores/use-config-store";
import { workspaceConfigWrites } from "@workbench/stores/use-workspace-config-store";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { useCanvasProjectActions } from "@workbench/hooks/use-canvas-project-actions";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import "./storage-notice.css";

export function StorageNotice({ children }: { children: (open: boolean) => ReactNode }) {
    const customColors = useThemeStore((state) => Boolean(state.appearance && !state.appearance.useDefaultColors));
    const [ownsFocus, setOwnsFocus] = useState(false);
    const returnFocus = useRef<HTMLElement | null>(null);
    const match = useMatch("/canvas/:id");
    const navigate = useNavigate();
    const error = useSyncExternalStore(subscribeStorageError, getStorageError);
    const loadError = useCanvasStore((state) => state.loadError);
    const statuses = useCanvasStore((state) => state.saveStatus);
    const deletions = useCanvasStore((state) => state.projectDeletions);
    const [dismissedNotice, setDismissedNotice] = useState("");
    useEffect(() => {
        const flushSettings = () => Promise.all([channelWrites.flush(), workspaceConfigWrites.flush()]).catch(() => undefined);
        const beforeUnload = (event: BeforeUnloadEvent) => {
            const savingSettings = channelWrites.saving || workspaceConfigWrites.saving;
            if (savingSettings) void flushSettings();
            if (savingSettings || Object.keys(useCanvasStore.getState().projectDeletions).length || Object.values(useCanvasStore.getState().saveStatus).some((status) => status !== "saved")) {
                event.preventDefault();
                event.returnValue = "";
            }
        };
        const flush = () => {
            if (document.visibilityState !== "hidden") return;
            void flushSettings();
            void useCanvasStore.getState().flush().catch(() => undefined);
        };
        window.addEventListener("beforeunload", beforeUnload);
        document.addEventListener("visibilitychange", flush);
        return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("visibilitychange", flush); };
    }, []);
    const projectId = match?.params.id ?? Object.keys(deletions).find((id) => deletions[id] === "error") ?? Object.keys(statuses).find((id) => statuses[id] === "error");
    const status = projectId ? statuses[projectId] : undefined;
    const deletion = projectId ? deletions[projectId] : undefined;
    const deletionIssue = deletion === "error";
    const projectIssue = !deletion && status === "error";
    const noticeKey = deletion ? deletionIssue ? `${projectId}:delete:error` : "" : projectIssue ? `${projectId}:${status}` : loadError || error?.code || "";
    const open = Boolean(noticeKey) && dismissedNotice !== noticeKey;
    const { scope, copyProject, deleteProjects, creating } = useCanvasProjectActions(`storage-notice:${projectId ?? ""}:${noticeKey}:${open}`);
    useEffect(() => setDismissedNotice(""), [noticeKey]);
    const title = deletionIssue ? "画布尚未删除完成" : projectIssue ? "画布尚未保存" : "暂时无法读取或保存";
    const message = deletionIssue ? "画布尚未删除完成，请确认保存位置可用后重试删除。" : projectIssue ? "画布尚未保存，请确认保存位置可用后重试。" : loadError || error?.message;
    return <>
        {children(open || ownsFocus)}
        <Dialog.Root open={open} onOpenChange={(next) => { if (!next) setDismissedNotice(noticeKey); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[1300] bg-black/45" />
                <Dialog.Content className="workbench-dialog storage-notice fixed left-1/2 top-1/2 z-[1300] max-h-[calc(100dvh_-_16px)] w-[calc(100%_-_16px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[8px] bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none"
                    data-custom-colors={customColors || undefined}
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                    onPointerDownOutside={(event) => event.preventDefault()}
                    onOpenAutoFocus={() => {
                        setOwnsFocus(true);
                        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        const target = returnFocus.current;
                        if (target?.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement) || target.closest('[role="dialog"]')?.contains(document.activeElement))) {
                            target.focus({ preventScroll: true });
                        }
                        setOwnsFocus(false);
                    }}>
                    <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded text-current/50 transition hover:bg-muted hover:text-current">
                        <X aria-hidden className="size-5" />
                    </Dialog.Close>
                    <Dialog.Title className="mb-2 text-base font-semibold leading-6">{title}</Dialog.Title>
                    <Dialog.Description asChild>
                        <div>
                            <p className="m-0 py-2 leading-7">{message}</p>
                            {!deletionIssue && <p className="storage-notice-detail m-0 leading-7">重新加载会放弃{projectId && projectIssue ? "这份画布当前" : "尚"}未保存的修改。</p>}
                        </div>
                    </Dialog.Description>
                    <footer className="mt-3 flex flex-wrap justify-end gap-2">
                        <Dialog.Close asChild><Button type="button" size="sm" variant="outline">稍后处理</Button></Dialog.Close>
                        {projectId && deletionIssue && <Button type="button" size="sm" variant="destructive" onClick={() => void deleteProjects([projectId])}>重试删除</Button>}
                        {projectId && projectIssue ? <>
                            <Button type="button" size="sm" variant="outline" onClick={() => void useCanvasStore.getState().flush(projectId).catch(() => undefined)}>重试保存</Button>
                            <Button type="button" size="sm" variant="outline" disabled={creating} onClick={async () => {
                                if (!scope || scope.signal.aborted) return;
                                const id = await copyProject(projectId);
                                if (id && !scope.signal.aborted) navigate(`/canvas/${id}`);
                            }}>
                                {creating && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
                                另存为新画布
                            </Button>
                        </> : null}
                        {!deletionIssue && <Button type="button" size="sm" variant="destructive" onClick={() => {
                            if (projectId && projectIssue) {
                                void useCanvasStore.getState().reloadProject(projectId).catch(() => undefined);
                                return;
                            }
                            location.reload();
                        }}>放弃修改并重新加载</Button>}
                    </footer>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    </>;
}
