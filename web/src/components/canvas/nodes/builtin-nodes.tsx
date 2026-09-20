import { File, FileText, Globe, Group, HelpCircle, Image as ImageIcon, LayoutPanelTop, Music2, Settings2, Sparkles, StickyNote, Video } from "lucide-react";

import i18n from "@/i18n";

import { NODE_SPECS } from "@/constant/canvas";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";
import { CrEntityContent, FrameContent, NoteContent, QuestionContent, SourceLinkContent } from "./research-nodes";

// Extensible metadata for built-in nodes, reusing NODE_SPECS for size and initial metadata.
// Rendering remains in canvas-node's internal renderer, so no Content component is provided.
function builtinResource(node: CanvasNodeData): CanvasNodeResource | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return { kind: "image", url: node.metadata.content };
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return { kind: "video", url: node.metadata.content };
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return { kind: "audio", url: node.metadata.content };
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return { kind: "text", text: node.metadata.content || node.metadata.prompt };
    return null;
}

const iconClass = "size-5";

const BUILTIN_DEFINITIONS: CanvasNodeDefinition[] = [
    { type: CanvasNodeType.Text, title: i18n.t("assets.kinds.text"), icon: <FileText className={iconClass} />, minimapColor: undefined, resource: builtinResource },
    { type: CanvasNodeType.Image, title: i18n.t("assets.kinds.image"), icon: <ImageIcon className={iconClass} />, minimapColor: "#10b981", keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize, resource: builtinResource },
    { type: CanvasNodeType.Video, title: i18n.t("assets.kinds.video"), icon: <Video className={iconClass} />, minimapColor: "#f97316", keepAspectRatio: () => true, resource: builtinResource },
    { type: CanvasNodeType.Audio, title: i18n.t("assets.kinds.audio"), icon: <Music2 className={iconClass} />, minimapColor: "#a855f7", resource: builtinResource },
    { type: CanvasNodeType.Config, title: i18n.t("canvas.configNode.title"), icon: <Settings2 className={iconClass} />, minimapColor: "#60a5fa", hasSourceHandle: false },
    { type: CanvasNodeType.Group, title: i18n.t("canvas.node.group"), icon: <Group className={iconClass} />, minimapColor: "#94a3b8" },
    { type: CanvasNodeType.CrEntity, title: i18n.t("canvas.nodeTypes.crEntity"), icon: <Sparkles className={iconClass} />, minimapColor: "#8b5cf6", hidePanel: true, Content: CrEntityContent },
    { type: CanvasNodeType.Frame, title: i18n.t("canvas.nodeTypes.frame"), icon: <LayoutPanelTop className={iconClass} />, minimapColor: "#94a3b8", hasSourceHandle: false, hidePanel: true, Content: FrameContent },
    { type: CanvasNodeType.Note, title: i18n.t("canvas.nodeTypes.note"), icon: <StickyNote className={iconClass} />, minimapColor: "#fbbf24", hidePanel: true, Content: NoteContent },
    { type: CanvasNodeType.Question, title: i18n.t("canvas.nodeTypes.question"), icon: <HelpCircle className={iconClass} />, minimapColor: "#3b82f6", hidePanel: true, Content: QuestionContent },
    { type: CanvasNodeType.Pdf, title: i18n.t("canvas.nodeTypes.pdf"), icon: <File className={iconClass} />, minimapColor: "#ef4444", hidePanel: true, Content: SourceLinkContent },
    { type: CanvasNodeType.Web, title: i18n.t("canvas.nodeTypes.web"), icon: <Globe className={iconClass} />, minimapColor: "#0ea5e9", hidePanel: true, Content: SourceLinkContent },
].map((def) => {
    const spec = NODE_SPECS[def.type];
    return { ...def, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(BUILTIN_DEFINITIONS, "builtin");
}
