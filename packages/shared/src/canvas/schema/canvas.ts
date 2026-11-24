import { z } from "zod";
import { pluginJsonSchema, projectDomainDeclarationSchema, type PluginJsonValue } from "../../plugins.js";

export enum CanvasNodeType {
    Image = "image", Text = "text", Video = "video", Audio = "audio", Group = "group",
}
export type CanvasNodeTypeId = CanvasNodeType | (string & {});
export const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Position = z.infer<typeof positionSchema>;
export const nodeStatusSchema = z.enum(["idle", "success", "loading", "error"]);
export type CanvasNodeStatus = z.infer<typeof nodeStatusSchema>;
export const generationModeSchema = z.enum(["text", "image", "video", "audio"]);
export type CanvasGenerationMode = z.infer<typeof generationModeSchema>;
export type CanvasImageGenerationType = "generation" | "edit";
export const nodeImageSchema = z.object({
    id: z.string(), status: nodeStatusSchema, errorDetails: z.string().optional(), content: z.string(),
    storageKey: z.string().optional(), naturalWidth: z.number(), naturalHeight: z.number(), bytes: z.number(), mimeType: z.string(),
});
export type CanvasNodeImage = z.infer<typeof nodeImageSchema>;
export const nodeTextSchema = z.object({ id: z.string(), status: nodeStatusSchema, errorDetails: z.string().optional(), content: z.string() });
export type CanvasNodeText = z.infer<typeof nodeTextSchema>;
const mediaKindSchema = z.enum(["image", "video", "audio"]);
export const canvasMediaReferenceSchema = z.union([
    z.object({ kind: mediaKindSchema, storageKey: z.string().min(1) }).strict(),
    z.object({ kind: mediaKindSchema, url: z.string().min(1) }).strict(),
]);
export type CanvasMediaReference = z.infer<typeof canvasMediaReferenceSchema>;
export const webVideoTaskSchema = z.object({
    projectId: z.string().min(1), nodeId: z.string().min(1), sourceId: z.string().min(1), runId: z.string().min(1), id: z.string().min(1),
    model: z.string().refine((value) => {
        const separator = value.indexOf("::");
        return separator > 0 && separator + 2 < value.length;
    }),
    scriptId: z.string().min(1), script: z.string().min(1), paused: z.boolean(),
}).strict();
export type CanvasWebVideoTask = z.infer<typeof webVideoTaskSchema>;
export function sameCanvasVideoRun(a: CanvasWebVideoTask, b: CanvasWebVideoTask) {
    return a.projectId === b.projectId && a.nodeId === b.nodeId && a.sourceId === b.sourceId && a.runId === b.runId &&
        a.id === b.id && a.model === b.model && a.scriptId === b.scriptId && a.script === b.script;
}
export function isWebVideoTaskOwner(projectId: string, node: { readonly id: string; readonly type: string }, binding: CanvasWebVideoTask): boolean {
    return node.type === CanvasNodeType.Video && binding.nodeId === node.id && binding.projectId === projectId;
}
export const nodeMetadataSchema = z.object({
    content: z.string().optional(),
    composerContent: z.string().optional(),
    prompt: z.string().optional(),
    status: nodeStatusSchema.optional(),
    errorDetails: z.string().optional(),
    fontSize: z.number().optional(),
    generationType: z.enum(["generation", "edit"]).optional(),
    model: z.string().optional(),
    reasoningEffort: z.enum(["auto", "low", "medium", "high", "xhigh"]).optional(),
    size: z.string().optional(),
    quality: z.string().optional(),
    background: z.string().optional(),
    count: z.number().optional(),
    textCount: z.number().optional(),
    texts: z.array(nodeTextSchema).optional(),
    primaryTextId: z.string().optional(),
    seconds: z.string().optional(),
    vquality: z.string().optional(),
    generateAudio: z.string().optional(),
    watermark: z.string().optional(),
    videoMode: z.string().optional(),
    audioVoice: z.string().optional(),
    audioFormat: z.string().optional(),
    audioSpeed: z.string().optional(),
    audioInstructions: z.string().optional(),
    references: z.array(canvasMediaReferenceSchema).optional(),
    attachments: z.array(z.object({ slot: z.string(), storageKey: z.string() })).optional(),
    mediaKind: mediaKindSchema.optional(),
    naturalWidth: z.number().optional(),
    naturalHeight: z.number().optional(),
    freeResize: z.boolean().optional(),
    images: z.array(nodeImageSchema).optional(),
    primaryImageId: z.string().optional(),
    storageKey: z.string().optional(),
    mimeType: z.string().optional(),
    bytes: z.number().optional(),
    durationMs: z.number().optional(),
    tasks: z.array(z.object({ taskId: z.string(), projectId: z.string(), nodeId: z.string(), slotId: z.string().optional(), sourceId: z.string() })).optional(),
    webVideoSubmissionId: z.string().min(1).optional(),
    webVideoTask: webVideoTaskSchema.optional(),
    groupId: z.string().optional(),
    interactive: z.boolean().optional(),
}).passthrough();
export type CanvasNodeMetadata = z.infer<typeof nodeMetadataSchema>;
export type CanvasTaskBinding = NonNullable<CanvasNodeMetadata["tasks"]>[number];

export function isCanvasTaskBinding(projectId: string | undefined, node: { id: string; metadata?: { images?: readonly { id: string }[]; texts?: readonly { id: string }[] } }, binding: CanvasTaskBinding): boolean {
    return binding.projectId === projectId && binding.nodeId === node.id && (binding.slotId === undefined || !!node.metadata?.images?.some((item) => item.id === binding.slotId) || !!node.metadata?.texts?.some((item) => item.id === binding.slotId));
}

export const canvasNodeSchema = z.object({
    id: z.string(), type: z.string(), title: z.string(), position: positionSchema,
    width: z.number().finite().positive(), height: z.number().finite().positive(), metadata: nodeMetadataSchema.optional(),
});
export type CanvasNodeData = z.infer<typeof canvasNodeSchema>;
export const connectionSchema = z.object({ id: z.string(), fromNodeId: z.string(), toNodeId: z.string() });
export type CanvasConnection = z.infer<typeof connectionSchema>;
export const canvasGraphSchema = z.object({ nodes: z.array(canvasNodeSchema), connections: z.array(connectionSchema) });
export type CanvasGraph = z.infer<typeof canvasGraphSchema>;
// 校验 JSON 形状，但保留插件的原始键，包括 JSON 中合法的 __proto__。
export const pluginProjectValueSchema = z.custom<PluginJsonValue>((value) => pluginJsonSchema.safeParse(value).success);
export const pluginProjectResourceSchema = z.object({ slot: z.string().min(1), collection: z.literal("plugin-files"), owner: z.string().min(1), key: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict();
export type PluginProjectResource = z.infer<typeof pluginProjectResourceSchema>;
export const pluginProjectDomainRecordSchema = z.object({
    owner: z.string().min(1), packageName: z.string().min(1).optional(),
    domain: projectDomainDeclarationSchema.shape.id,
    dataVersion: projectDomainDeclarationSchema.shape.dataVersion,
    value: pluginProjectValueSchema,
    resources: z.array(pluginProjectResourceSchema).refine((resources) => new Set(resources.map((resource) => resource.slot)).size === resources.length, "DUPLICATE_RESOURCE_SLOT"),
}).strict().refine((record) => record.resources.every((resource) => resource.owner === record.owner && (!record.packageName || resource.sha256 !== undefined)), "RESOURCE_OWNER_OR_DIGEST_MISMATCH");
export type PluginProjectDomainRecord = z.infer<typeof pluginProjectDomainRecordSchema>;
const pluginDomainsSchema = z.array(pluginProjectDomainRecordSchema).refine((records) => new Set(records.map(({ owner, domain }) => JSON.stringify([owner, domain]))).size === records.length, "DUPLICATE_PROJECT_DOMAIN");
export const pluginStandaloneWorkSchema = z.object({
    workId: z.string().min(1), owner: z.string().min(1), packageName: z.string().min(1).optional(), title: z.string().min(1), pluginDomains: pluginDomainsSchema,
}).strict();
export type PluginStandaloneWork = z.infer<typeof pluginStandaloneWorkSchema>;
export const canvasDocumentSchema = canvasGraphSchema.extend({
    schemaVersion: z.literal(1), id: z.string(), title: z.string(), createdAt: z.string(), updatedAt: z.string(),
    pluginDomains: pluginDomainsSchema.optional(),
}).passthrough();
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
