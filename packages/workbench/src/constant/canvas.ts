import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { NODE_SPECS } from "@infinite-canvas/shared/canvas/schema/node-specs";
import { getNodeSpec as getRegistryNodeSpec } from "@workbench/lib/canvas/node-registry";

// Return built-in specs directly and resolve plugin types from the registry.
export function getNodeSpec(type: string) {
    if ((Object.values(CanvasNodeType) as string[]).includes(type)) return NODE_SPECS[type as CanvasNodeType];
    const spec = getRegistryNodeSpec(type);
    return { width: spec.width, height: spec.height, title: spec.title, metadata: spec.metadata };
}
