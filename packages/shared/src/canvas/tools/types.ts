import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId, Position, CanvasConnection, CanvasNodeType as BuiltinNodeType } from "../schema/canvas.js";

/** 画布坐标。 */
export type { Position, CanvasConnection };
export type Viewport = { x: number; y: number; k: number };
export type CanvasNodeType = `${BuiltinNodeType}`;
export type CanvasNode = { id: string; type: string; title?: string; position: Position; width: number; height: number; metadata?: Record<string, unknown> };
export type CanvasSnapshot = { projectId: string; title: string; nodes: CanvasNode[]; connections: CanvasConnection[]; selectedNodeIds: string[]; viewport: Viewport; clientId?: string };
export type CanvasPresence = Pick<CanvasSnapshot, "projectId" | "title">;

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "move_nodes"; items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> }
    | { type: "group_nodes"; ids: string[]; id?: string; title?: string }
    | { type: "ungroup_nodes"; ids: string[] }
    | { type: "set_group_members"; groupId: string; nodeIds: string[] }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: Viewport }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

