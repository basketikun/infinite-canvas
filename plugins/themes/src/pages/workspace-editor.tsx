import { useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { PluginContext } from "@infinite-canvas/plugin-sdk";
import { entries, saveWorkspace, snapshot, standard, subscribe, type Workspace } from "../lib/workspace";

export function WorkspaceEditor({ ctx }: { ctx: PluginContext }) {
    const workspace = useSyncExternalStore(subscribe, snapshot);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const ranks = new Map(workspace.order.map((id, index) => [id, index]));
    const navigation = [...entries].sort((a, b) => (ranks.get(a.id) ?? workspace.order.length) - (ranks.get(b.id) ?? workspace.order.length));
    const save = async (next: Workspace) => {
        setSaving(true);
        setError(false);
        try { await saveWorkspace(ctx, next); }
        catch { if (!ctx.signal.aborted) setError(true); }
        finally { if (!ctx.signal.aborted) setSaving(false); }
    };
    const move = (index: number, offset: number) => {
        const order = navigation.map(({ id }) => id);
        [order[index], order[index + offset]] = [order[index + offset], order[index]];
        void save({ ...workspace, order });
    };
    return <fieldset disabled={saving} className="theme-editor">
        <legend>显示的导航入口</legend>
        <p className="theme-editor-hint">侧栏布局在「设置 → 外观」中选择；隐藏入口后仍可通过原地址打开页面。</p>
        <div className="theme-editor-list">{navigation.map(({ id, title }, index) => <div key={id} className="theme-nav-entry"><label>
            <span>{title}</span><input type="checkbox" checked={!workspace.hidden.includes(id)} onChange={(event) => void save({
                ...workspace, hidden: event.target.checked ? workspace.hidden.filter((entry) => entry !== id) : [...workspace.hidden, id],
            })} />
        </label><button type="button" aria-label={`上移${title}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
        <button type="button" aria-label={`下移${title}`} disabled={index === navigation.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button></div>)}</div>
        <button className="theme-editor-action" disabled={!workspace.hidden.length && !workspace.order.length} onClick={() => void save(standard)}>恢复默认导航</button>
        {error && <p role="alert">导航设置未能保存，请重试。</p>}
    </fieldset>;
}
