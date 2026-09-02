import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";
export function requestH3Generation(ctx: CanvasNodeContext, all = false) { ctx.emit("minimax-h3:run", { nodeId: ctx.node.id, all }); }
export function requestH3Reset(ctx: CanvasNodeContext) { ctx.updateMetadata({ content: "", status: "idle", errorDetails: "", runtimeTaskId: "", runProgress: 0 }); }
