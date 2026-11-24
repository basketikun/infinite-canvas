import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { nodes, nodeTools, nodeResources } from "@infinite-canvas/plugin-sdk/builtin";
import { renderer } from "./nodes/document";
import { toggleEdit } from "./nodeTools/edit";
import { markdownResource } from "./nodeResources/markdown";
import "./styles/markdown.css";

export default definePlugin({
    contributions: [
        contribute(nodes, { id: renderer.type, value: renderer }),
        contribute(nodeTools, { id: "multi-format-renderer:toggle-edit", value: toggleEdit }),
        contribute(nodeResources, { id: "multi-format-renderer:markdown-resource", value: markdownResource }),
    ],
});
