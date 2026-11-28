import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { agentTools, commands, nodes } from "@infinite-canvas/plugin-sdk/builtin";
import { applySceneLayout, cameraLayouts, sceneTargets } from "./api/camera-layouts";
import { applyLayout, editSceneVoxel, readTargets } from "./commands/scene-layout";
import { editVoxel } from "./api/voxel-edit";
import { orbit } from "./layouts/orbit";
import { studio } from "./nodes/studio";
import { orbitTool, targetsTool } from "./tools/orbit";
import { editVoxelTool } from "./tools/voxel";

export default definePlugin({
    extensionPoints: [cameraLayouts],
    contributions: [
        contribute(commands, { id: sceneTargets.id, value: readTargets }),
        contribute(commands, { id: applySceneLayout.id, value: applyLayout }),
        contribute(commands, { id: editVoxel.id, value: editSceneVoxel }),
        contribute(agentTools, { id: sceneTargets.id, value: targetsTool }),
        contribute(agentTools, { id: "director-desk:orbit", value: orbitTool }),
        contribute(agentTools, { id: editVoxel.id, value: editVoxelTool }),
        contribute(cameraLayouts, { id: "director-desk:orbit", value: orbit }),
        contribute(nodes, { id: studio.type, value: studio }),
    ],
});
