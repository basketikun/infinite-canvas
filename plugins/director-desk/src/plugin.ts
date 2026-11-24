import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { agentTools, commands, nodes } from "@infinite-canvas/plugin-sdk/builtin";
import { applySceneLayout, cameraLayouts, sceneTargets } from "./api/camera-layouts";
import { applyLayout, readTargets } from "./commands/scene-layout";
import { orbit } from "./layouts/orbit";
import { studio } from "./nodes/studio";
import { orbitTool, targetsTool } from "./tools/orbit";

export default definePlugin({
    extensionPoints: [cameraLayouts],
    contributions: [
        contribute(commands, { id: sceneTargets.id, value: readTargets }),
        contribute(commands, { id: applySceneLayout.id, value: applyLayout }),
        contribute(agentTools, { id: sceneTargets.id, value: targetsTool }),
        contribute(agentTools, { id: "director-desk:orbit", value: orbitTool }),
        contribute(cameraLayouts, { id: "director-desk:orbit", value: orbit }),
        contribute(nodes, { id: studio.type, value: studio }),
    ],
});
