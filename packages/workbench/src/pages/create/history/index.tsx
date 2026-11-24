import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "radix-ui";
import { Plus } from "lucide-react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { useCreateSessionStore } from "@workbench/stores/use-create-session-store";
import { SessionCard } from "./components/session-card";

export default function CreateHistoryPage() {
    const navigate = useNavigate();
    const sessions = useCreateSessionStore((state) => state.sessions);
    const hydrated = useCreateSessionStore((state) => state.hydrated);
    const renameSession = useCreateSessionStore((state) => state.renameSession);
    const removeSessions = useCreateSessionStore((state) => state.removeSessions);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deleteIds, setDeleteIds] = useState<string[]>([]);
    const [removing, setRemoving] = useState(false);
    const target = sessions.find((session) => session.id === deleteIds[0]);

    useEffect(() => { void useCreateSessionStore.getState().load(); }, []);

    const rename = async (id: string, title: string) => {
        try {
            await renameSession(id, title);
            toast.success("对话已重命名", workbenchMessageOptions.success);
            return true;
        } catch (error) {
            console.error("[create-history] rename", error);
            toast.error("对话未能重命名，请重试。", workbenchMessageOptions.error);
            return false;
        }
    };
    const toggleSelected = (id: string, selected: boolean) => setSelectedIds((current) => selected ? [...new Set([...current, id])] : current.filter((item) => item !== id));
    const closeDelete = () => { if (!removing) setDeleteIds([]); };
    const confirmRemove = async () => {
        if (!deleteIds.length || removing) return;
        const ids = deleteIds;
        setRemoving(true);
        try {
            await removeSessions(ids);
            setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
            setDeleteIds([]);
            toast.success(ids.length > 1 ? `已删除 ${ids.length} 条对话` : "对话已删除", workbenchMessageOptions.success);
        } catch (error) {
            console.error("[create-history] remove", error);
            toast.error("部分对话未能删除，请重试。", workbenchMessageOptions.error);
        } finally {
            setRemoving(false);
        }
    };

    return <main className="h-full overflow-y-auto bg-background text-foreground">
        <div className="mx-auto w-full max-w-6xl px-6 py-10">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                <div>
                    <p className="text-xs text-muted-foreground">创作</p>
                    <h1 className="mt-2 text-2xl font-semibold tracking-tight">对话历史</h1>
                    <p className="mt-2 text-sm text-muted-foreground">{hydrated ? `共 ${sessions.length} 条对话` : "正在读取对话..."}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {selectedIds.length ? <Button type="button" size="sm" variant="outline" onClick={() => setDeleteIds(selectedIds)}>删除选中</Button> : null}
                    {sessions.length ? <Button type="button" size="sm" variant="outline" onClick={() => setDeleteIds(sessions.map((session) => session.id))}>删除全部</Button> : null}
                    <Button type="button" size="sm" onClick={() => navigate("/")}><Plus className="size-4" />新建对话</Button>
                </div>
            </header>
            {hydrated && sessions.length ? <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {sessions.map((session) => <SessionCard key={session.id} session={session} selected={selectedIds.includes(session.id)} onToggle={toggleSelected} onRename={rename} onDelete={(item) => setDeleteIds([item.id])} />)}
            </div> : hydrated ? <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">还没有创作对话</div> : null}
        </div>
        <Dialog.Root open={deleteIds.length > 0} onOpenChange={(open) => { if (!open) closeDelete(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[1100] bg-black/45" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-[1100] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none">
                    <Dialog.Title className="text-base font-semibold">删除对话？</Dialog.Title>
                    <Dialog.Description className="mt-2 text-sm text-muted-foreground">{deleteIds.length > 1 ? `将删除 ${deleteIds.length} 条对话及其中的全部记录，此操作无法撤销。` : `“${target?.title || "新对话"}”及其中的全部记录将被永久删除，此操作无法撤销。`}</Dialog.Description>
                    <footer className="mt-5 flex justify-end gap-2">
                        <Button type="button" variant="outline" disabled={removing} onClick={closeDelete}>取消</Button>
                        <Button type="button" variant="destructive" disabled={removing} aria-busy={removing} onClick={() => void confirmRemove()}>{removing ? "删除中…" : "确认删除"}</Button>
                    </footer>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    </main>;
}
