import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import type { CreateSession } from "@workbench/services/create/logs";

export function SessionCard({ session, selected, onToggle, onRename, onDelete }: {
    session: CreateSession;
    selected: boolean;
    onToggle: (id: string, selected: boolean) => void;
    onRename: (id: string, title: string) => Promise<boolean>;
    onDelete: (session: CreateSession) => void;
}) {
    const navigate = useNavigate();
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(session.title);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!editing) setTitle(session.title);
    }, [session.title, editing]);

    const open = () => { if (!editing) navigate(`/create?session=${encodeURIComponent(session.id)}`); };
    const startEditing = () => { setTitle(session.title || "新对话"); setEditing(true); };
    const cancel = () => { setTitle(session.title); setEditing(false); };
    const save = async () => {
        if (saving) return;
        setSaving(true);
        if (await onRename(session.id, title)) setEditing(false);
        setSaving(false);
    };

    return <article className="group flex min-h-44 cursor-pointer flex-col justify-between rounded-2xl bg-[#f1eee8] p-5 transition hover:bg-[#ebe6dc] dark:bg-white/5 dark:hover:bg-white/10" onClick={open}>
        <div className="flex items-start gap-3">
            <input
                type="checkbox"
                checked={selected}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onToggle(session.id, event.target.checked)}
                className="mt-2 size-4 accent-stone-950 dark:accent-stone-100"
                aria-label={`选择${session.title || "新对话"}`}
            />
            <div className="min-w-0 flex-1">
                {editing ? <Input aria-label="对话名称" value={title} autoFocus onClick={(event) => event.stopPropagation()} onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) void save();
                        if (event.key === "Escape") cancel();
                    }} /> : <h2 className="truncate text-xl font-semibold">{session.title || "新对话"}</h2>}
                <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">{session.count} 条记录</p>
            </div>
        </div>
        <div className="mt-8 flex items-end justify-between gap-3">
            <p className="text-xs text-stone-500">{`更新于 ${formatTime(session.updatedAt)}`}</p>
            <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                {editing ? <>
                    <Button variant="ghost" size="icon-xs" disabled={saving || !title.trim()} onClick={() => void save()} aria-label="保存名称"><Check className="size-4" /></Button>
                    <Button variant="ghost" size="icon-xs" disabled={saving} onClick={cancel} aria-label="取消重命名"><X className="size-4" /></Button>
                </> : <>
                    <Button variant="ghost" size="icon-xs" onClick={startEditing} aria-label="重命名"><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => onDelete(session)} aria-label="删除"><Trash2 className="size-4" /></Button>
                </>}
            </div>
        </div>
    </article>;
}

function formatTime(value: number) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
