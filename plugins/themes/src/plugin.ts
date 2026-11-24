import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { layouts, settings } from "@infinite-canvas/plugin-sdk/builtin";
import { setup } from "./setup";
import { sidebar } from "./layouts/sidebar";
import { colors, navigationSettings } from "./settings/settings";
import "./styles/theme.css";

export default definePlugin({
    setup,
    contributions: [
        contribute(layouts, { id: sidebar.id, value: sidebar }),
        contribute(settings, { id: colors.id, value: colors }),
        contribute(settings, { id: navigationSettings.id, value: navigationSettings }),
    ],
});
