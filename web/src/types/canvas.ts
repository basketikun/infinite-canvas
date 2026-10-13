import type { Model3dTaskKind, MultiviewView } from "@/services/api/model3d-ops";

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Model3d = "model3d",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio" | "model3d";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    imageTemplate?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    videoTaskId?: string;
    videoTaskProvider?: "openai" | "gemini";
    model3dTaskId?: string;
    model3dPreview?: string;
    model3dPreviewKey?: string;
    model3dTexture?: string;
    model3dPbr?: string;
    model3dTextureQuality?: string;
    model3dFaceLimit?: string;
    model3dQuad?: string;
    // Tripo task that produced this model. Kept so follow-up operations can chain server-side instead of
    // re-uploading the glb; model3dTaskId is cleared on success, so the id is stored separately here.
    model3dSourceTaskId?: string;
    model3dTaskKind?: Model3dTaskKind;
    // Follow-up operation metadata is saved before the request starts so a failed node can retry the same operation.
    model3dOpKind?: string;
    model3dOpParams?: string;
    // Rig type this model was rigged with; the retarget animation list depends on it.
    model3dRigType?: string;
    // Format conversion output, stored on the source node rather than as a new node (it cannot be previewed).
    model3dConvertedKey?: string;
    model3dConvertedFormat?: string;
    model3dConvertedMime?: string;
    // Signed Tripo URL for the conversion output; Bambu Studio can fetch it while it is still valid.
    model3dConvertedUrl?: string;
    model3dConvertTaskId?: string;
    // Which multiview angle an image node holds, and the task that produced the set.
    multiviewView?: MultiviewView;
    multiviewTaskId?: string;
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    /**
     * Set on a connection drawn out of a config node to hand its parameters downstream. Generation also connects a
     * config node to the result it just produced, so the direction alone cannot tell the two apart.
     */
    kind?: "parameter";
    /**
     * Which of a 3D node's four left-side view sockets this connection lands on (front / left / back / right).
     * Loose images plug into a socket; a group still uses one wire and marks views on its members instead.
     */
    toHandle?: MultiviewView;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    /** Set when the drag starts from (or snaps to) one of a 3D node's four view sockets. */
    view?: MultiviewView;
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
