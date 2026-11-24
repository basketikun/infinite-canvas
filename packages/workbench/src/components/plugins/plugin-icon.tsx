import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import type { InstalledPlugin } from "@infinite-canvas/shared/plugins";
import { readPluginAsset } from "@workbench/lib/plugins/manager";

export function PluginIcon({ record }: { record: InstalledPlugin }) {
    const [source, setSource] = useState<string>();
    useEffect(() => {
        let active = true;
        setSource(undefined);
        if (record.package.infiniteCanvas.icon) {
            void readPluginAsset(record, "icon").then((value) => { if (active) setSource(value); }).catch((error) => console.error("[plugins] icon unavailable", error));
        }
        return () => { active = false; };
    }, [record]);
    return source ? <img src={source} alt="" className="size-8 shrink-0 object-contain" onError={() => setSource(undefined)} /> : <Puzzle className="size-8 shrink-0 opacity-60" />;
}
