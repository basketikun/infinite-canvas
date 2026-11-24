import { z } from "zod";
import { isValidElementType } from "react-is";
import { isValidElement, type ElementType } from "react";
import type { CanvasNodeAppearance, CanvasNodeDefinition, CanvasNodeResource, NodeResourceContribution, NodeToolContribution, ResolvedNodeTool, ModelsCapability, PluginCommand, PluginMenu, PluginMenuItem, PluginPanel, PluginSettings, PluginCanvasSideTab, PluginPage, PluginLayout, PluginNavigation, PluginNavigationItem, PluginAppearance, PluginApplicationAction, PluginApplicationActions } from "./types";
import type { CanvasSessionCapability, CanvasSnapshot, CanvasSelection } from "./canvas";
import { defineCapability, defineHostPoint, defineExtensionPoint } from "./runtime/contracts";
import type { TasksCapability } from "./types";
import { commandSchema, defineCommand } from "./commands";
import type { PluginAgentTool } from "./types";
import { projectDomainDeclarationSchema, type PluginProjectDomainDeclaration, type PluginScopeKind } from "@infinite-canvas/shared/plugins";
import { canvasDocumentOpSchema } from "@infinite-canvas/shared/canvas/ops/apply";
import { modelCapabilities, type CallScript } from "@infinite-canvas/shared/models";
import type { PluginSyncTransport, ResourcesCapability } from "./types";
import { syncTransportFieldKeySchema, syncTransportIdSchema } from "@infinite-canvas/shared/workspace-config";

const callback = z.custom<(...args: any[]) => any>((value) => typeof value === "function");
const component = z.custom<ElementType>((value) => isValidElementType(value));
const id = z.string().min(1);
const title = z.string();
const menuLocations = z.enum(["canvas.projectMenu", "canvas.toolbar", "canvas.extensions", "canvas.zoomControls", "canvas.nodeToolbar", "canvas.selectionToolbar", "canvas.create", "canvas.connectionCreate", "canvas.nodeContext", "canvas.connectionContext"]);

function point<T>(name: string, scope: PluginScopeKind, schema: z.ZodType<T>) {
    return defineHostPoint<T>(`builtin:${name}`, scope, schema);
}

export const nodeAppearanceSchema: z.ZodType<CanvasNodeAppearance> = z.object({ background: z.enum(["fill", "transparent"]), border: z.enum(["normal", "none"]), bottomGradient: z.boolean() }).strict();

export const nodes = point<CanvasNodeDefinition>("nodes", "project", z.object({
    type: id, title, icon: z.unknown(), description: z.string().optional(),
    defaultSize: z.object({ width: z.number().finite(), height: z.number().finite() }),
    defaultMetadata: z.record(z.unknown()).optional(), minimapColor: z.string().optional(),
    showInCreateMenu: z.boolean().optional(), hasSourceHandle: z.boolean().optional(), hidePanel: z.boolean().optional(),
    appearance: z.union([nodeAppearanceSchema, callback]).optional(), contentOverflow: z.enum(["hidden", "visible"]).optional(), panelPresentation: z.literal("fullscreen").optional(), autoOpenPanel: z.boolean().optional(), interactionToggle: z.boolean().optional(),
    useBuiltinPanel: z.object({ mode: z.enum(["image", "video", "text", "audio"]), promptPrefix: z.string().optional(), writeBackToSelf: z.boolean().optional(), imageAspectRatio: z.string().regex(/^\d+:\d+$/).optional() }).optional(),
    forceInteractive: callback.optional(), keepAspectRatio: callback.optional(),
    Content: component.optional(), Panel: component.optional(), onDoubleClick: callback.optional(),
}).strict() as z.ZodType<CanvasNodeDefinition>);

export const commands = point<PluginCommand<any, any>>("commands", "application", z.object({ command: commandSchema, title, locations: z.array(z.enum(["canvas.extensions", "canvas.toolbar", "canvas.contextMenu"])).optional(), enabled: callback.optional(), run: callback }).strict() as z.ZodType<PluginCommand<any, any>>);
export const resolvedNodeToolSchema: z.ZodType<ResolvedNodeTool> = z.object({ title, label: title, icon: z.unknown(), run: callback, active: z.boolean().optional(), danger: z.boolean().optional(), disabled: z.boolean().optional(), defaultVisible: z.boolean().optional() }).strict() as z.ZodType<ResolvedNodeTool>;
const agentToolSchema: z.ZodType<PluginAgentTool> = z.object({
    description: z.string().min(1), readOnly: z.boolean().optional(), command: commandSchema.refine(command => command.scope === "project" || command.scope === "workspace"),
}).strict() as z.ZodType<PluginAgentTool>;
export const agentTools = point("agent-tools", "workspace", agentToolSchema);
export const nodeResourceSchema: z.ZodType<CanvasNodeResource> = z.object({ kind: z.enum(["text", "image", "video", "audio"]), text: z.string().optional(), url: z.string().optional(), storageKey: z.string().optional() }).strict();
export const nodeTools = point<NodeToolContribution>("node-tools", "project", z.object({ resolve: callback }).strict() as z.ZodType<NodeToolContribution>);
export const nodeResources = point<NodeResourceContribution>("node-resources", "project", z.object({ resolve: callback }).strict() as z.ZodType<NodeResourceContribution>);
export const projectData = point<PluginProjectDomainDeclaration>("project-data", "workspace", projectDomainDeclarationSchema);
const transportField = z.object({ key: syncTransportFieldKeySchema, title: title.min(1), secret: z.boolean().optional() }).strict();
export const syncTransports = point<PluginSyncTransport>("sync-transports", "workspace", z.object({
    title: title.min(1), defaultDirectory: z.string().optional(),
    fields: z.array(transportField).refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length),
    test: callback, open: callback,
}).strict());
export const resources = defineCapability<ResourcesCapability>({
    id: "builtin:resources", scope: "workspace",
    methods: {
        read: {
            input: z.object({ kind: z.enum(["canvas", "work"]), id: id, domain: projectDomainDeclarationSchema.shape.id, dataVersion: projectDomainDeclarationSchema.shape.dataVersion, slot: id, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
            output: z.instanceof(Blob),
        },
    },
});
export const menus = point<PluginMenu>("menus", "project", z.object({ id, locations: z.array(menuLocations), transform: callback }).strict() as z.ZodType<PluginMenu>);
const menuItemBase = { id, hidden: z.boolean().optional() };
export const pluginMenuItemSchema = z.discriminatedUnion("type", [
    z.object({ ...menuItemBase, type: z.literal("action"), title, icon: z.unknown().optional(), description: z.string().optional(), tooltip: z.string().optional(), shortcut: z.string().optional(), active: z.boolean().optional(), showLabel: z.boolean().optional(), disabled: z.boolean().optional(), danger: z.boolean().optional(), run: callback }).strict(),
    z.object({ ...menuItemBase, type: z.literal("separator") }).strict(),
    z.object({ ...menuItemBase, type: z.literal("content"), title, Content: component }).strict(),
]) as z.ZodType<PluginMenuItem>;
export const panels = point<PluginPanel>("panels", "project", z.object({ id, title, presentation: z.literal("workspace").optional(), Content: component }) as z.ZodType<PluginPanel>);
export const settings = point<PluginSettings>("settings", "view", z.object({ id, title, Content: component }) as z.ZodType<PluginSettings>);
export const canvasSideTabs = point<PluginCanvasSideTab>("canvas-side-tabs", "view", z.object({ title, icon: z.unknown().optional(), hidden: z.boolean().optional(), Content: component }).strict() as z.ZodType<PluginCanvasSideTab>);
export const pages = point<PluginPage>("pages", "view", z.object({ id, title, icon: z.unknown().optional(), navigation: z.boolean().optional(), Content: component }) as z.ZodType<PluginPage>);
export const navigationItemSchema: z.ZodType<PluginNavigationItem> = z.object({ id, title, hidden: z.boolean().optional() }).strict();
export const navigation = point<PluginNavigation>("navigation", "view", z.object({ transform: callback }).strict() as z.ZodType<PluginNavigation>);
const applicationActionBase = { id, title, hidden: z.boolean().optional() };
export const applicationActionSchema: z.ZodType<PluginApplicationAction> = z.discriminatedUnion("type", [
    z.object({ ...applicationActionBase, type: z.literal("action"), icon: z.unknown().optional(), disabled: z.boolean().optional(), run: callback }).strict(),
    z.object({ ...applicationActionBase, type: z.literal("route"), icon: z.unknown().optional(), to: z.string() }).strict(),
    z.object({ ...applicationActionBase, type: z.literal("external"), icon: z.unknown().optional(), href: z.string() }).strict(),
    z.object({ ...applicationActionBase, type: z.literal("content"), content: z.custom<Extract<PluginApplicationAction, { type: "content" }>["content"]>(isValidElement) }).strict(),
]) as z.ZodType<PluginApplicationAction>;
export const applicationActions = point<PluginApplicationActions>("application-actions", "view", z.object({ transform: callback }).strict() as z.ZodType<PluginApplicationActions>);
export const layouts = point<PluginLayout>("layouts", "application", z.object({ id, name: title, description: z.string(), Frame: component }) as z.ZodType<PluginLayout>);
export const pluginAppearanceSchema: z.ZodType<PluginAppearance> = z.object({
    id, name: title, description: z.string(), useDefaultColors: z.boolean().optional(), mode: z.enum(["light", "dark"]),
    background: z.string(), panel: z.string(), surface: z.string(), text: z.string(), muted: z.string(), border: z.string(), accent: z.string(), accentText: z.string(),
    canvasTheme: z.object({
        canvas: z.object({ background: z.string(), dot: z.string(), line: z.string(), selectionStroke: z.string(), selectionFill: z.string() }).partial().strict().optional(),
        node: z.object({ label: z.string(), fill: z.string(), panel: z.string(), stroke: z.string(), activeStroke: z.string(), placeholder: z.string(), text: z.string(), muted: z.string(), faint: z.string() }).partial().strict().optional(),
        toolbar: z.object({ panel: z.string(), border: z.string(), item: z.string(), itemHover: z.string(), activeBg: z.string(), activeText: z.string() }).partial().strict().optional(),
    }).strict().optional(),
}).strict();
/** 贡献 ID 即调用脚本 ID，可在渠道里为模型选用；脚本源码会接触所选渠道的密钥。 */
export const callScripts = point<Omit<CallScript, "id">>("call-scripts", "workspace", z.object({
    name: title.min(1), description: title, logo: z.string().optional(), invertInDark: z.boolean().optional(),
    capability: z.enum(modelCapabilities), source: z.string().min(1),
}).strict());
export const themes = point<PluginAppearance>("themes", "application", pluginAppearanceSchema);

export const canvasSelectionSchema: z.ZodType<CanvasSelection> = z.object({ nodeIds: z.array(z.string()), connectionId: z.string().nullable() }).strict();
export const canvasViewportSchema = z.object({ x: z.number().finite(), y: z.number().finite(), k: z.number().finite().positive() }).strict();
/** 文档由事务边界校验，此处只检查会话快照外形并保留缓存身份。 */
export const canvasSnapshotSchema = z.custom<CanvasSnapshot>((value) => Boolean(value && typeof value.projectId === "string" && typeof value.revision === "number" && Array.isArray(value.nodes) && Array.isArray(value.connections) && Array.isArray(value.selection?.nodeIds) && (value.selection.connectionId === null || typeof value.selection.connectionId === "string") && typeof value.viewport?.x === "number" && typeof value.viewport.y === "number" && typeof value.viewport.k === "number" && typeof value.canUndo === "boolean" && typeof value.canRedo === "boolean"));
const canvasTransactionSchema = z.object({ ops: z.array(canvasDocumentOpSchema), selection: canvasSelectionSchema.optional(), viewport: canvasViewportSchema.optional() }).strict();

export const canvasSession = defineCapability<CanvasSessionCapability>({
    id: "builtin:canvas-session", scope: "project",
    methods: {
        snapshot: { input: z.void(), output: canvasSnapshotSchema },
        transact: { input: canvasTransactionSchema, output: canvasSnapshotSchema },
        undo: { input: z.void(), output: canvasSnapshotSchema },
        redo: { input: z.void(), output: canvasSnapshotSchema },
        select: { input: canvasSelectionSchema, output: z.void() },
        viewport: { input: canvasViewportSchema, output: z.void() },
        flush: { input: z.void(), output: z.void() },
    },
});

export const canvasApply = defineCommand({ id: "builtin:canvas-apply", scope: "project", input: canvasTransactionSchema, output: canvasSnapshotSchema });
export const canvasUndo = defineCommand({ id: "builtin:canvas-undo", scope: "project", input: z.void(), output: canvasSnapshotSchema });
export const canvasRedo = defineCommand({ id: "builtin:canvas-redo", scope: "project", input: z.void(), output: canvasSnapshotSchema });
export const canvasSelect = defineCommand({ id: "builtin:canvas-select", scope: "project", input: canvasSelectionSchema, output: canvasSnapshotSchema });
export const canvasViewport = defineCommand({ id: "builtin:canvas-viewport", scope: "project", input: canvasViewportSchema, output: canvasSnapshotSchema });
export const canvasFocusNode = defineCommand({ id: "builtin:canvas-focus-node", scope: "project", input: z.object({ nodeId: z.string() }).strict(), output: z.void() });
export const canvasDeleteNodes = defineCommand({ id: "builtin:canvas-delete-nodes", scope: "project", input: z.object({ nodeIds: z.array(z.string()) }).strict(), output: canvasSnapshotSchema });
export const canvasClear = defineCommand({ id: "builtin:canvas-clear", scope: "project", input: z.void(), output: canvasSnapshotSchema });
export const canvasUngroupNodes = defineCommand({ id: "builtin:canvas-ungroup-nodes", scope: "project", input: z.object({ nodeIds: z.array(z.string()) }).strict(), output: canvasSnapshotSchema });
export const canvasGroupNodes = defineCommand({ id: "builtin:canvas-group-nodes", scope: "project", input: z.object({ nodeIds: z.array(z.string()) }).strict(), output: canvasSnapshotSchema });
const nodeInput = z.object({ nodeId: z.string() }).strict();
export const nodeCreate = defineCommand({
    id: "builtin:node-create", scope: "project",
    input: z.object({
        type: z.string(),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
        connection: z.object({ nodeId: z.string(), handleType: z.enum(["source", "target"]) }).strict().optional(),
    }).strict(),
    output: canvasSnapshotSchema,
});
export const nodeDuplicate = defineCommand({ id: "builtin:node-duplicate", scope: "project", input: nodeInput, output: canvasSnapshotSchema });
export const nodeGenerate = defineCommand({ id: "builtin:node-generate", scope: "project", input: nodeInput.extend({ mode: z.enum(modelCapabilities), prompt: z.string() }), output: canvasSnapshotSchema });
export const nodeRetry = defineCommand({ id: "builtin:node-retry", scope: "project", input: nodeInput.extend({ slotId: z.string().optional() }), output: canvasSnapshotSchema });
export const nodeStop = defineCommand({ id: "builtin:node-stop", scope: "project", input: nodeInput.extend({ confirm: z.boolean().optional() }), output: z.void() });
export const nodeOpenPanel = defineCommand({ id: "builtin:node-open-panel", scope: "project", input: nodeInput, output: z.void() });
export const nodeSetTextContent = defineCommand({ id: "builtin:node-set-text-content", scope: "project", input: nodeInput.extend({ content: z.string() }), output: canvasSnapshotSchema });
export const nodePreviewImage = defineCommand({ id: "builtin:node-preview-image", scope: "project", input: nodeInput.extend({ slotId: z.string().optional() }), output: z.void() });
const mediaImportTarget = z.object({ nodeId: z.string().optional(), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict() }).strict();
const importFiles = z.array(z.custom<File>((value) => value instanceof File));
export const canvasImportMedia = defineCommand({ id: "builtin:canvas-import-media", scope: "project", input: z.union([mediaImportTarget.extend({ files: importFiles }), z.object({ sourceNodeId: z.string(), files: importFiles }).strict()]), output: canvasSnapshotSchema });
const mediaAsset = z.object({ title: z.string(), url: z.string().optional(), storageKey: z.string().optional(), width: z.number().finite(), height: z.number().finite(), bytes: z.number().finite(), mimeType: z.string() }).strict();
export const canvasInsertAsset = defineCommand({
    id: "builtin:canvas-insert-asset", scope: "project",
    input: z.object({
        asset: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("text"), title: z.string(), content: z.string() }).strict(),
            mediaAsset.extend({ kind: z.literal("image") }),
            mediaAsset.extend({ kind: z.literal("video") }),
            mediaAsset.extend({ kind: z.literal("audio") }),
        ]).refine((asset) => asset.kind === "text" || Boolean(asset.storageKey || asset.url)),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    }).strict(),
    output: canvasSnapshotSchema,
});

const signal = z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional();
const generationInput = { prompt: z.string(), model: z.string().optional(), signal };
const videoInput = z.object({ ...generationInput, references: z.array(z.string()).optional(), size: z.string().optional(), seconds: z.string().optional() }).strict();
const videoResult = z.object({ storageKey: z.string().optional(), url: z.string().optional(), mimeType: z.string(), width: z.number().optional(), height: z.number().optional(), durationMs: z.number().optional() }).refine((value) => Boolean(value.storageKey || value.url));
const taskHandle = z.object({ token: z.string().uuid(), workId: z.string().min(1).optional() }).strict();

export const tasks = defineCapability<TasksCapability>({
    id: "builtin:tasks", scope: "workspace",
    methods: {
        read: { input: taskHandle, output: z.discriminatedUnion("status", [
            z.object({ status: z.enum(["pending", "paused", "failed", "cancelled", "interrupted"]) }).strict(),
            z.object({ status: z.literal("completed"), result: videoResult }).strict(),
        ]) },
    },
});

export const models = defineCapability<ModelsCapability>({
    id: "builtin:models", scope: "workspace",
    methods: {
        listModels: { input: z.object({ capability: z.enum(modelCapabilities).optional() }).strict(), output: z.array(z.object({ value: z.string(), label: z.string() })) },
        defaultModel: { input: z.object({ capability: z.enum(modelCapabilities) }).strict(), output: z.string() },
        generateImage: {
            input: z.object({ ...generationInput, references: z.array(z.string()).optional(), count: z.number().optional(), size: z.string().optional() }).strict(),
            output: z.object({ images: z.array(z.string()) }),
        },
        generateVideo: { input: videoInput, output: videoResult },
        submitVideo: { input: videoInput.extend({ workId: z.string().min(1).optional() }), output: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("accepted"), handle: taskHandle }).strict(),
            z.object({ kind: z.literal("completed"), result: videoResult }).strict(),
        ]) },
        generateText: {
            input: z.object({ ...generationInput, system: z.string().optional(), onDelta: z.custom<(text: string) => void>((value) => typeof value === "function").optional() }).strict(),
            output: z.object({ text: z.string() }),
        },
    },
});
