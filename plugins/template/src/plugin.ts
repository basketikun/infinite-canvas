import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { nodes, settings } from "@infinite-canvas/plugin-sdk/builtin";
import { note } from "./nodes/note";
import { overview } from "./settings/overview";

export default definePlugin({
    contributions: [
        contribute(nodes, { id: note.type, value: note }),
        contribute(settings, { id: overview.id, value: overview }),
    ],
});
