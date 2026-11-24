import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { nodes, nodeTools, nodeResources } from "@infinite-canvas/plugin-sdk/builtin";
import { viewer } from "./nodes/viewer";
import { reset } from "./nodeTools/viewer";
import { panoramaResource } from "./nodeResources/viewer";

export default definePlugin({
    contributions: [
        contribute(nodes, { id: viewer.type, value: viewer }),
        contribute(nodeTools, { id: "panorama:reset", value: reset }),
        contribute(nodeResources, { id: "panorama:viewer-resource", value: panoramaResource }),
    ],
});
