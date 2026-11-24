import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { settings as settingsPoint } from "@infinite-canvas/plugin-sdk/builtin";
import { setup } from "./setup";
import { overview, settings } from "./settings/settings";
import "./styles/statistics.css";

export default definePlugin({
    setup,
    contributions: [
        contribute(settingsPoint, { id: settings.id, value: settings }),
        contribute(settingsPoint, { id: overview.id, value: overview }),
    ],
});
