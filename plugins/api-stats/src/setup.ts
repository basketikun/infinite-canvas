import type { PluginContext } from "@infinite-canvas/plugin-sdk";
import { pages } from "@infinite-canvas/plugin-sdk/builtin";
import { createStatistics } from "./lib/statistics";
import { statisticsPage } from "./pages/statistics";

export let statistics: Awaited<ReturnType<typeof createStatistics>>;

export async function setup(ctx: PluginContext) {
    statistics = await createStatistics(ctx);
    let release: (() => void) | undefined;
    const sync = () => {
        const show = statistics.getSnapshot().settings.showInSidebar;
        if (show && !release) release = ctx.extensions.contribute(pages, { id: statisticsPage.id, value: statisticsPage });
        else if (!show && release) { release(); release = undefined; }
    };
    sync();
    statistics.subscribe(sync);
}
