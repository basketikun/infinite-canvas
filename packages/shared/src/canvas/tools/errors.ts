const messages: Record<string, string> = {
    CANVAS_DISCONNECTED: "目标网页已断开，请重新连接后继续。",
    CANVAS_NOT_OPEN: "请先打开具体画布，再执行此操作。",
    CANVAS_CHANGED: "当前画布已切换，请重新读取目标画布后继续。",
    CANVAS_TIMEOUT: "画布尚未返回结果，请先查看实际状态，不要重复提交生成。",
    UNKNOWN_TOOL: "该工具不存在，请重新加载工具列表。",
    TOOL_CANCELLED: "本次工具调用已停止。",
    INVALID_ARGUMENTS: "参数不符合工具要求，请按工具说明修改。",
    INVALID_PATH: "请提供本站页面路径。",
    NODE_NOT_FOUND: "部分节点已不存在，请重新读取画布并使用现有节点 ID。",
    STORAGE_UNAVAILABLE: "画布尚未保存，请确认保存位置可用后重试。",
    CONNECTION_ID_EXISTS: "连线 ID 已存在，请使用新的 ID。",
    NODE_ID_EXISTS: "节点 ID 已存在，请使用新的 ID。",
    GROUP_NOT_FOUND: "指定组不存在，或所选节点尚未分组。",
    GROUP_REQUIRES_MEMBERS: "打组至少需要两个成员，请补充节点。",
    GROUP_MEMBER_INVALID: "成员必须是当前画布中存在的普通节点，不能包含组。",
    GROUP_CONNECTION_TARGET: "组只能作为连线来源，请连接到需要生成的节点。",
    ASSET_NOT_FOUND: "指定素材不存在，请重新查询素材列表。",
    REFERENCE_IMAGE_MISSING: "当前项目找不到这张参考图，请重新选择或上传。",
    CANVAS_TOOL_FAILED: "操作未完成，请检查当前画布和参数后重试。",
};

export function canvasToolError(error: unknown) {
    const value = error instanceof Error ? error.name === "ZodError" ? "INVALID_ARGUMENTS" : "code" in error && typeof error.code === "string" ? error.code : error.message : "CANVAS_TOOL_FAILED";
    const code = Object.hasOwn(messages, value) ? value : "CANVAS_TOOL_FAILED";
    return { code, message: messages[code] };
}
