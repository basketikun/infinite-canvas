import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Puzzle } from "lucide-react";
import { getPluginErrorMessage, selectPluginVersion, type PluginIndex } from "@infinite-canvas/shared/plugins";
import { APP_VERSION } from "@workbench/constant/env";
import { installPlugin } from "@workbench/lib/plugins/manager";
import { plugins as adapter } from "@workbench/services/plugins/runtime";
import { usePluginStore } from "@workbench/stores/use-plugin-store";

/** 当前下载源发布的插件列表；更换下载源后由调用方换 key 重新加载。 */
export function PluginMarket() {
    const installed = usePluginStore((state) => state.plugins);
    const [index, setIndex] = useState<PluginIndex>();
    const [busy, setBusy] = useState<string>();
    const [error, setError] = useState<string>();
    useEffect(() => {
        let active = true;
        adapter.index().then((value) => { if (active) setIndex(value); }, (reason) => { if (active) setError(getPluginErrorMessage(reason)); });
        return () => { active = false; };
    }, []);
    const install = async (name: string) => {
        setBusy(name);
        setError(undefined);
        try { await installPlugin({ name, version: "latest" }); toast.success("插件已安装"); }
        catch (reason) { setError(getPluginErrorMessage(reason)); }
        finally { setBusy(undefined); }
    };
    return <div className="space-y-3">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {!index && !error ? <p className="py-6 text-center text-sm opacity-60">正在加载…</p> : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
            {index?.plugins.map((entry) => {
                const latest = selectPluginVersion(entry, "latest", APP_VERSION);
                const current = installed.find((record) => record.package.name === entry.name)?.package.version;
                return <article key={entry.name} className="flex min-w-0 flex-col gap-3 rounded-xl border border-current/10 p-5">
                    <div className="flex items-center gap-3">
                        <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-current/10 bg-current/5">
                            {entry.icon ? <img src={entry.icon} alt="" className="size-6" /> : <Puzzle className="size-6 opacity-60" />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium">{entry.title}</span>
                            <span className="truncate text-xs opacity-50">{[latest, entry.author].filter(Boolean).join(" · ")}</span>
                        </span>
                    </div>
                    <p className="m-0 line-clamp-2 min-h-10 text-sm leading-5 opacity-60">{entry.description}</p>
                    <div className="flex justify-end">
                        {latest
                            ? <Button size="sm" variant={current ? "outline" : "default"} disabled={Boolean(busy) || current === latest} onClick={() => void install(entry.name)}>{busy === entry.name ? "正在安装…" : current === latest ? "已安装" : current ? "更新" : "安装"}</Button>
                            : <span className="text-xs opacity-50">暂不支持当前版本</span>}
                    </div>
                </article>;
            })}
        </div>
    </div>;
}
