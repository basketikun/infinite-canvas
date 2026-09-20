import { AlertTriangle, Compass, File, FileText, GitBranch, Globe, Group, HelpCircle, Image as ImageIcon, LayoutPanelTop, Lightbulb, Music2, Scale, Settings2, Sparkles, Sprout, StickyNote, Video, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import i18n from "@/i18n";

import { NODE_SPECS } from "@/constant/canvas";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { CanvasNodeType, RESEARCH_FLOW_NODE_TYPES, type CanvasNodeData, type ResearchFlowNodeType } from "@/types/canvas";
import type { CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";
import { FrameContent, NoteContent, QuestionContent, ResearchCardContent, RESEARCH_FLOW_META, SourceLinkContent } from "./research-nodes";

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

const RESEARCH_FLOW_ICONS: Record<ResearchFlowNodeType, ReactNode> = {
    [CanvasNodeType.Seed]: <Sprout className={iconClass} />,
    [CanvasNodeType.Direction]: <Compass className={iconClass} />,
    [CanvasNodeType.ResearchQuestion]: <HelpCircle className={iconClass} />,
    [CanvasNodeType.Problem]: <AlertTriangle className={iconClass} />,
    [CanvasNodeType.Hypothesis]: <Lightbulb className={iconClass} />,
    [CanvasNodeType.Approach]: <GitBranch className={iconClass} />,
    [CanvasNodeType.Method]: <Wrench className={iconClass} />,
    [CanvasNodeType.Evaluation]: <Scale className={iconClass} />,
    [CanvasNodeType.Idea]: <Sparkles className={iconClass} />,
};

const BUILTIN_DEFINITIONS: CanvasNodeDefinition[] = [
    { type: CanvasNodeType.Text, title: i18n.t("assets.kinds.text"), icon: <FileText className={iconClass} />, minimapColor: undefined, resource: builtinResource, showInCreateMenu: false },
    { type: CanvasNodeType.Image, title: i18n.t("assets.kinds.image"), icon: <ImageIcon className={iconClass} />, minimapColor: "#10b981", keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize, resource: builtinResource, showInCreateMenu: false },
    { type: CanvasNodeType.Video, title: i18n.t("assets.kinds.video"), icon: <Video className={iconClass} />, minimapColor: "#f97316", keepAspectRatio: () => true, resource: builtinResource, showInCreateMenu: false },
    { type: CanvasNodeType.Audio, title: i18n.t("assets.kinds.audio"), icon: <Music2 className={iconClass} />, minimapColor: "#a855f7", resource: builtinResource, showInCreateMenu: false },
    { type: CanvasNodeType.Config, title: i18n.t("canvas.configNode.title"), icon: <Settings2 className={iconClass} />, minimapColor: "#60a5fa", hasSourceHandle: false, showInCreateMenu: false },
    { type: CanvasNodeType.Group, title: i18n.t("canvas.node.group"), icon: <Group className={iconClass} />, minimapColor: "#94a3b8", showInCreateMenu: false },
    ...RESEARCH_FLOW_NODE_TYPES.map((type) => ({
        type,
        title: i18n.t(`canvas.nodeTypes.${type}`),
        icon: RESEARCH_FLOW_ICONS[type],
        minimapColor: RESEARCH_FLOW_META[type].color,
        hidePanel: true as const,
        Content: ResearchCardContent,
    })),
    { type: CanvasNodeType.Frame, title: i18n.t("canvas.nodeTypes.frame"), icon: <LayoutPanelTop className={iconClass} />, minimapColor: "#94a3b8", hasSourceHandle: false, hidePanel: true, showInCreateMenu: false, Content: FrameContent },
    { type: CanvasNodeType.Note, title: i18n.t("canvas.nodeTypes.note"), icon: <StickyNote className={iconClass} />, minimapColor: "#fbbf24", hidePanel: true, showInCreateMenu: false, Content: NoteContent },
    { type: CanvasNodeType.Question, title: i18n.t("canvas.nodeTypes.question"), icon: <HelpCircle className={iconClass} />, minimapColor: "#3b82f6", hidePanel: true, showInCreateMenu: false, Content: QuestionContent },
    { type: CanvasNodeType.Pdf, title: i18n.t("canvas.nodeTypes.pdf"), icon: <File className={iconClass} />, minimapColor: "#ef4444", hidePanel: true, showInCreateMenu: false, Content: SourceLinkContent },
    { type: CanvasNodeType.Web, title: i18n.t("canvas.nodeTypes.web"), icon: <Globe className={iconClass} />, minimapColor: "#0ea5e9", hidePanel: true, showInCreateMenu: false, Content: SourceLinkContent },
].map((def) => {
    const spec = NODE_SPECS[def.type as CanvasNodeType];
    return { ...def, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(BUILTIN_DEFINITIONS, "builtin");
}
