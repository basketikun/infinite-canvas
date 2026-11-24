import { z } from "zod";

const recordSchema = z.record(z.unknown());
const positionSchema = z.object({ x: z.number(), y: z.number() });
const viewportSchema = z.object({ x: z.number(), y: z.number(), k: z.number() });
const nodeTypeSchema = z.enum(["image", "text", "video", "audio", "group"]);
const nodePatchSchema = z.object({ title: z.string().optional(), position: positionSchema.optional(), width: z.number().optional(), height: z.number().optional(), metadata: recordSchema.optional() }).strict();
const generationModeSchema = z.enum(["text", "image", "video", "audio"]);
const moveNodesSchema = z.object({ items: z.array(z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), dx: z.number().optional(), dy: z.number().optional() })).min(1) });
const groupNodesSchema = z.object({ ids: z.array(z.string()).min(1), title: z.string().optional() });
const ungroupNodesSchema = z.object({ ids: z.array(z.string()).min(1) });
const groupMembersSchema = z.object({ groupId: z.string(), nodeIds: z.array(z.string()) });

/** Canvas Agent 对外提供的工具名称。 */
export const toolNames = [
    "canvas_get_state",
    "canvas_get_nodes",
    "canvas_list_models",
    "canvas_apply_ops",
    "canvas_list_references",
    "canvas_insert_media",
    "canvas_view_image",
    "canvas_create_text_nodes",
    "canvas_create_generation_flow",
    "generation_get_status",
    "prompts_search",
    "assets_list",
    "assets_add",
] as const;
export type ToolName = (typeof toolNames)[number];

export const canvasOpSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), nodeType: nodeTypeSchema.optional(), id: z.string().optional(), title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), position: positionSchema.optional(), metadata: recordSchema.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: nodePatchSchema.optional(), metadata: recordSchema.optional() }).passthrough(),
    moveNodesSchema.extend({ type: z.literal("move_nodes") }),
    groupNodesSchema.extend({ type: z.literal("group_nodes"), id: z.string().optional() }),
    ungroupNodesSchema.extend({ type: z.literal("ungroup_nodes") }),
    groupMembersSchema.extend({ type: z.literal("set_group_members") }),
    z.object({ type: z.literal("delete_node"), id: z.string().optional(), ids: z.array(z.string()).optional() }).passthrough(),
    z.object({ type: z.literal("delete_connections"), id: z.string().optional(), ids: z.array(z.string()).optional(), all: z.boolean().optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), toNodeId: z.string() }).passthrough(),
    z.object({ type: z.literal("set_viewport"), viewport: viewportSchema }).passthrough(),
    z.object({ type: z.literal("select_nodes"), ids: z.array(z.string()) }).passthrough(),
    z.object({ type: z.literal("run_generation"), nodeId: z.string(), mode: generationModeSchema.optional(), prompt: z.string().optional() }).passthrough(),
]);

const textNodeSchema = z.object({
    text: z.string(),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
});

const generationOptionsSchema = z.object({
    model: z.string().optional(),
    size: z.string().optional(),
    quality: z.string().optional(),
    count: z.number().optional(),
    seconds: z.string().optional(),
    vquality: z.string().optional(),
    generateAudio: z.string().optional(),
    watermark: z.string().optional(),
    videoMode: z.string().optional(),
    audioVoice: z.string().optional(),
    audioFormat: z.string().optional(),
    audioSpeed: z.string().optional(),
    audioInstructions: z.string().optional(),
});

const generationFlowSchema = z.object({
    prompt: z.string(),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    referenceNodeIds: z.array(z.string()).optional().describe("已有参考节点或组节点的 ID。组会展开为其中有效的文本、图片、视频和音频，同一素材不重复使用。"),
});

export const toolInputSchemas = {
    canvas_get_state: z.object({ ids: z.array(z.string()).optional(), types: z.array(nodeTypeSchema).optional(), selectedOnly: z.boolean().optional(), groupId: z.string().optional(), keyword: z.string().optional(), includeConnections: z.boolean().optional(), offset: z.number().int().min(0).optional() }),
    canvas_get_nodes: z.object({ ids: z.array(z.string()).min(1).max(50) }),
    canvas_list_models: z.object({ capability: generationModeSchema.optional(), keyword: z.string().optional() }),
    canvas_apply_ops: z.object({ ops: z.array(canvasOpSchema).max(200) }),
    canvas_list_references: z.object({}),
    canvas_insert_media: z.object({ assetId: z.string().optional(), storageKey: z.string().optional(), title: z.string().optional(), x: z.number().optional(), y: z.number().optional() }),
    canvas_view_image: z.object({ nodeId: z.string().optional(), storageKey: z.string().optional() }),
    canvas_create_text_nodes: z.object({ items: z.array(textNodeSchema).min(1), x: z.number().optional(), y: z.number().optional(), gap: z.number().optional(), direction: z.enum(["row", "column"]).optional() }),
    canvas_create_generation_flow: generationFlowSchema.extend({ mode: generationModeSchema.optional(), autoRun: z.boolean().optional() }).merge(generationOptionsSchema),
    generation_get_status: z.object({ scope: z.enum(["all", "canvas", "image", "video"]).optional(), taskId: z.string().optional(), nodeIds: z.array(z.string()).optional(), limit: z.number().optional() }),
    prompts_search: z.object({ keyword: z.string().optional(), category: z.string().optional(), tags: z.array(z.string()).optional(), page: z.number().optional(), pageSize: z.number().optional() }),
    assets_list: z.object({ ids: z.array(z.string()).optional(), includeContent: z.boolean().optional(), kind: z.enum(["all", "text", "image", "video"]).optional(), keyword: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() }),
    assets_add: z.object({ kind: z.enum(["text", "image"]), title: z.string(), content: z.string().optional(), imageUrl: z.string().optional(), source: z.string().optional(), note: z.string().optional() }),
} satisfies Record<ToolName, z.AnyZodObject>;

export const toolDescriptions: Record<ToolName, string> = {
    canvas_get_state: "读取精简画布概览：节点标识、类型、标题、位置、尺寸、状态、组成员和文本预览。可按 ids、types、selectedOnly、groupId、keyword 组合筛选；includeConnections=false 可省略连线，否则返回相关连线。一次最多返回 200 个节点，超出时 truncated 为 true，用 offset 翻页或缩小筛选范围。完整文本和生成参数用 canvas_get_nodes 按 ID 读取。所有位置均为画布绝对坐标。",
    canvas_get_nodes: "按 ids（最多 50 个）读取节点的完整文本、生成参数、媒体尺寸及组成员，不返回媒体编码、历史图片内容或内部字段；不存在的 ID 在 missingIds 中列出。",
    canvas_list_models: "查询可选模型 ID、用途及当前默认模型，可按 capability 和 keyword 筛选。生成时传返回的 id，不猜模型名。",
    canvas_apply_ops: "批量操作画布，只返回本次变化和已提交生成的节点 ID。ops 一次最多 200 个，type 支持 add_node、update_node（title/position/width/height/metadata，文本用 metadata.content，提示词用 metadata.prompt）、move_nodes（绝对坐标或 dx/dy）、group_nodes、ungroup_nodes、set_group_members、delete_node、delete_connections、connect_nodes、set_viewport、select_nodes、run_generation（返回 submittedNodeIds 仅表示已提交）。新节点可指定 id，供同批后续操作引用；新增节点若与已有节点重叠，会自动向右顺延，以返回的 position 为准。组是真实分组：group_nodes 把已有节点打组，不要用文本标题代替；不支持嵌套组，组可作连线来源但不能作目标；移动组同步移动成员，同批显式指定成员位置时以成员为准；ungroup_nodes 可解散组或把成员移出；set_group_members 用 nodeIds 替换完整成员；删除组保留成员，删除成员需显式列出 ID。",
    canvas_list_references: "列出当前项目聊天中最近上传的 50 张参考图片，返回 storageKey、名称和原始尺寸，不返回图片数据。",
    canvas_insert_media: "把素材放入当前画布，保持原始比例，返回新节点 ID。assetId 来自 assets_list，支持文本、图片、视频、音频；storageKey 来自 canvas_list_references，插入聊天里上传的图片原图。可选 x、y 指定位置，默认接在现有内容右侧。随后可将节点作为生成流程的 referenceNodeIds。不要用空占位节点或编造图片地址。",
    canvas_view_image: "查看图片内容：nodeId 读取图片节点（批量图片取第一张成功的），或用 storageKey 读取素材、参考图及节点详情中的图片。返回缩小到长边 1024 的图片，用来判断生成结果或理解参考图；需要处理多张时逐张查看。",
    canvas_create_text_nodes: "创建一个或多个文本节点；items 填 text、title 和可选位置，支持统一排列。",
    canvas_create_generation_flow: "创建生成流程，mode 选择 text/image/video/audio，referenceNodeIds 复用已有素材。autoRun=true 提交生成，省略或 false 只创建流程。返回 createdNodeIds、变化节点及 submittedNodeIds；提交后用 generation_get_status 查询结果。",
    generation_get_status: "查询当前画布和工作台生成记录。scope 过滤来源，taskId 查询工作台返回的记录编号，nodeIds 查询画布节点。批量结果包含成功数、失败数及本地调用编号 taskIds。",
    prompts_search: "搜索提示词库（第三方提示词合集），支持 keyword、category、tags 过滤和 page/pageSize 分页，返回标题、提示词、分类与标签。",
    assets_list: "列出用户「我的素材」，支持 ids、kind、keyword 和分页。默认只返回标识与摘要；includeContent=true 按需读取文本原文（此时每页最多 20 条）或图片存储标识和尺寸，不返回媒体编码。",
    assets_add: "向「我的素材」新增素材。kind=text 时用 content 传文本内容；kind=image 时用 imageUrl 传图片地址或 dataURL。可附带 title、source、note。",
};
