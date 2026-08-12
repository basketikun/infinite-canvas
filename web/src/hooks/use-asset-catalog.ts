import { useEffect, useMemo, useState } from "react";

import { fetchEagleAssets, fetchEagleConnection, type EagleConnection } from "@/services/eagle-assets";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

export type AssetSourceFilter = "all" | "local" | "eagle";

export function useAssetCatalog() {
    const localAssets = useAssetStore((state) => state.assets);
    const [eagleAssets, setEagleAssets] = useState<Asset[]>([]);
    const [eagleConnection, setEagleConnection] = useState<EagleConnection>({ connected: false });
    const [eagleLoading, setEagleLoading] = useState(true);
    const [eagleError, setEagleError] = useState<string | null>(null);

    const refreshEagle = () => {
        const controller = new AbortController();
        setEagleLoading(true);
        setEagleError(null);
        void Promise.all([fetchEagleAssets(controller.signal), fetchEagleConnection(controller.signal)])
            .then(([result, connection]) => {
                setEagleAssets(result.assets);
                setEagleConnection(connection);
            })
            .catch((error) => {
                if (error instanceof DOMException && error.name === "AbortError") return;
                setEagleAssets([]);
                setEagleError(error instanceof Error ? error.message : "Eagle 资产读取失败");
                setEagleConnection({ connected: false, error: error instanceof Error ? error.message : "Eagle 资产读取失败" });
            })
            .finally(() => setEagleLoading(false));
        return () => controller.abort();
    };

    useEffect(() => refreshEagle(), []);

    return useMemo(
        () => ({ localAssets, eagleAssets, assets: [...localAssets, ...eagleAssets], eagleConnection, eagleLoading, eagleError, refreshEagle }),
        [eagleAssets, eagleConnection, eagleError, eagleLoading, localAssets],
    );
}
