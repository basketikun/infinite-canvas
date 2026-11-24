import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { pluginDisplayVersion, type InstalledPlugin } from "@infinite-canvas/shared/plugins";
import { readPluginAsset } from "@workbench/lib/plugins/manager";

import "./plugin-readme.css";

const Streamdown = lazy(() => import("streamdown").then(({ Streamdown }) => ({ default: Streamdown })));

export function PluginDetails({ record }: { record: InstalledPlugin }) {
    const [content, setContent] = useState<string>();
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const pkg = record.package;
    useEffect(() => {
        let active = true;
        setContent(undefined);
        setFailed(false);
        if (pkg.infiniteCanvas.readme) {
            void readPluginAsset(record, "readme").then((value) => { if (active) setContent(value); }).catch((error) => {
                console.error("[plugins] readme unavailable", error);
                if (active) setFailed(true);
            });
        }
        return () => { active = false; };
    }, [record, pkg.infiniteCanvas.readme, retry]);
    return <div className="space-y-6">
        {pkg.description ? <p className="m-0 text-sm leading-6">{pkg.description}</p> : null}
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {pluginDisplayVersion(pkg) ? <div><dt className="opacity-50">版本</dt><dd className="mt-1">{pluginDisplayVersion(pkg)}</dd></div> : null}
            {pkg.author ? <div><dt className="opacity-50">作者</dt><dd className="mt-1">{pkg.author}</dd></div> : null}
        </dl>
        {failed ? <div role="alert" className="flex items-center gap-3 text-sm"><span>插件说明暂时无法加载，请重试。</span><Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>重试</Button></div>
            : !pkg.infiniteCanvas.readme ? null
            : content === undefined ? <p role="status" className="py-8 text-sm text-muted-foreground">正在加载使用说明…</p>
            : <Suspense fallback={<p role="status" className="py-8 text-sm text-muted-foreground">正在加载使用说明…</p>}><Streamdown mode="static" skipHtml className="plugin-readme" controls={false} lineNumbers={false}>{content}</Streamdown></Suspense>}
    </div>;
}
