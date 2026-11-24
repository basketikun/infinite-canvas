import { createCallScriptSource } from "@infinite-canvas/model-runtime/call-scripts/template";
import { modelCapabilities } from "@infinite-canvas/shared/models";

/** 交给用户 AI 助手的提示词：直接写一个单文件插件到本地插件目录。 */
export function pluginAiPrompt(directory: string) {
    return `请帮我为「无限画布」写一个插件，保存为 ${directory}/<插件名>/client.js。插件名只用小写字母、数字和连字符，目录名即插件 id。

一、文件形式与限制
- 单个 ES 模块文件，不需要构建。它以独立模块加载，不能 import 相对路径、npm 包或 SDK，也不能用 JSX；所有能力来自默认导出的 contributions、setup(ctx) 的 ctx 和浏览器标准 API。
- 默认导出对象只能有这些字段，多写其他字段会加载失败：contributions、setup、css；css 是样式字符串；setup(ctx) 可返回清理函数，插件停用时调用。
- 需要界面时用 React：const React = globalThis.InfiniteCanvasRuntime.React，用 React.createElement 写（不要 JSX）；可用 React.useState 等 hooks。没有 lucide-react 和 shadcn 控件，图标用 React.createElement("svg", ...) 或简短文字，不要用 emoji 充当图标。
- 不能在单文件里写 commands 和 agentTools（它们需要带校验的结构定义，只有构建版插件能提供）；要给用户一个可点击的动作，请用下面的 menus 或 nodeTools，要响应画布变化用 ctx.on。
- 贡献写法：{ point: { id: "builtin:<扩展点>" }, id: "<插件名>:<名称>", value }。id 必须以「<插件名>:」开头；宿主按 point.id 查找扩展点并校验 value，value 的字段多写或写错会被跳过，并在浏览器控制台输出以 [plugins] 开头的日志。
- 不要把密钥写进源码；直接信任输入，不要堆叠容错分支；多字段对象逐字段换行，嵌套内容分层缩进。
- 同目录再写 plugin.json：{ "name": "中文名称", "description": "一句话说明", "version": "1.0.0", "author": "作者" }，四项都要填写，显示在「设置 → 插件」的列表和详情里，不需要启用就能读取。
- 同目录再写 GUIDE.md（中文）作为使用说明，介绍插件做什么、怎么用、需要的前置配置，显示在插件详情里。
- 修改文件后在「设置 → 插件」里点「重新加载本地插件」才会生效。

二、可用的扩展点（point.id 与 value）
1. builtin:call-scripts 模型调用脚本：{ name, description, capability: "image"|"video"|"text"|"audio", source, logo?, invertInDark? }，详见第四节。
2. builtin:menus 菜单：{ id, locations: [...], transform({ ctx, canvas, target, items }) => 新列表 }。transform 必须是同步纯函数，返回新数组，可追加、隐藏（hidden: true）、重排。位置：canvas.projectMenu、canvas.toolbar、canvas.extensions（底栏扩展菜单，插件入口首选）、canvas.zoomControls、canvas.nodeToolbar、canvas.selectionToolbar、canvas.create、canvas.connectionCreate、canvas.nodeContext、canvas.connectionContext。target.location 标明位置，节点相关位置带 nodeId 或 nodeIds，创建与右键类位置带画布坐标 position。菜单项：{ id: "<插件名>:xxx", type: "action", title, icon?, description?, tooltip?, disabled?, danger?, run: async () => {} }、{ id, type: "separator" }、{ id, type: "content", title, Content }（Content 是 React 组件）。run 里用 canvas 操作画布（canvas.transact(ops)、canvas.getNodes()、canvas.getSelectedIds()）。
3. builtin:node-tools 节点悬浮工具条按钮：{ resolve(ctx) => null 或 { title, label, icon, run, active?, danger?, disabled?, defaultVisible? } }。ctx 是节点上下文：ctx.node（id、type、title、position、width、height、metadata）、ctx.transact(ops)、ctx.updateMetadata(patch)、ctx.updateNode({ title, width, height })、ctx.getUpstream()、ctx.getDownstream()、ctx.getNodes()、ctx.models、ctx.storage。不适用的节点返回 null，例如只给文本节点：if (ctx.node.type !== "text") return null。icon 必须是 React 元素或字符串。
4. builtin:node-resources 节点作为上游时输出的内容：{ resolve(node, slotId) => null 或 { kind: "text"|"image"|"video"|"audio", text?, url?, storageKey? } }，只对自己的自定义节点类型返回内容。
5. builtin:nodes 自定义画布节点：{ type, title, icon, defaultSize: { width, height }, Content, Panel?, defaultMetadata?, description?, showInCreateMenu?, hasSourceHandle?, hidePanel?, minimapColor?, onDoubleClick?, useBuiltinPanel? }。贡献 id 必须与 type 相同，且以「<插件名>:」开头。Content 是 React 组件，接收 { ctx }（节点上下文，含 ctx.node.metadata、ctx.theme、ctx.isSelected、ctx.updateMetadata(patch)）；画布里的颜色用 ctx.theme（ctx.theme.node.text、ctx.theme.node.muted、ctx.theme.node.stroke、ctx.theme.node.fill 等），不要写死黑白。Panel 是节点下方的面板组件，接收 { ctx, onClose }，同时设置 hidePanel: false 并通过 ctx.openPanel() 打开。useBuiltinPanel: { mode: "image"|"video"|"text"|"audio" } 可复用内置生成面板。
6. builtin:panels 从画布扩展菜单打开的面板：{ id, title, Content }，Content 接收 { ctx, canvas, onClose }。
7. builtin:canvas-side-tabs 画布左侧面板标签：{ title, icon?, Content }，Content 接收 { ctx, view }，view.focusNode(nodeId) 可定位节点。
8. builtin:pages 独立页面：{ id, title, icon?, navigation?: true, Content }，navigation 为 true 时进入主导航。
9. builtin:settings 插件设置标签：{ id, title, Content }，显示在「设置 → 插件 → 插件详情」。
10. builtin:themes 主题配色：{ id, name, description, mode: "light"|"dark", background, panel, surface, text, muted, border, accent, accentText, canvasTheme? }，id 必须与贡献 id 相同，颜色是 CSS 颜色字符串；canvasTheme 可选，分 canvas、node、toolbar 三组局部覆盖画布颜色。登记后用户在「设置 → 外观」里选用。
11. builtin:navigation 主导航改写：{ transform({ ctx, items }) => items }，条目 { id, title, hidden? }，可隐藏或重排。
12. builtin:application-actions 应用菜单改写：{ transform({ ctx, target, items }) => items }，条目 { id, title, type: "action", run } 或 type 为 route（to）、external（href）。
13. builtin:sync-transports 同步连接方式（高级，需要自己实现读写，一般不建议用单文件写）。

三、ctx 与画布操作
- setup(ctx) 的 ctx：ctx.id、ctx.signal、ctx.storage.get(key) / set(key, value) / remove(key)（插件私有 JSON 数据）、ctx.files.read / write / remove（私有文件，Blob）、ctx.models（见下）、ctx.on(event, handler)（返回取消函数，停用时自动取消）、ctx.onDispose(cleanup)、ctx.emit / ctx.onMessage、ctx.appearance.select(主题 id 或 null)、ctx.images.store / preview / read、ctx.media.read。setup 阶段没有当前画布，不要直接调用 ctx.canvas()；需要画布时用菜单 transform 收到的 canvas、节点上下文，或面板 Content 收到的 canvas。
- 事件 ctx.on：document.committed（{ projectId, revision, source, operation }）、document.saved、document.saveFailed、selection.changed、viewport.changed、result.applied（生成结果写入节点后，含 kind、nodeIds）、model.call.started、model.call.finished。回调里写画布要避免形成事件循环，source 可用于区分来源。
- 模型能力 ctx.models（每个方法只接收一个对象参数）：generateText({ prompt, system?, model?, onDelta? }) 返回 { text }；generateImage({ prompt, references?, count?, size?, model? }) 返回 { images: [dataURL] }；generateVideo / submitVideo 生成视频；listModels({ capability? }) 返回可选模型；defaultModel({ capability }) 返回默认模型 id。使用宿主已配置的模型和密钥；没配置会抛错，用 try/catch 向用户提示。
- 画布对象 canvas（PluginCanvas）：getNodes()、getConnections()、getSelectedIds()、getSnapshot()、transact(ops)（返回 Promise，依赖该写入的操作要等待它）、undo()、redo()、setSelection({ nodeIds, connectionId: null })、setViewport({ x, y, k })、on(event, handler)。
- 画布节点 { id, type, title, position: { x, y }, width, height, metadata }，type 为 text、image、video、audio、group 或插件自定义类型。文本节点内容在 metadata.content；图片、视频、音频的素材在 metadata 里（读取时用 node.metadata 并优先复用已有字段，不要猜测字段名，不确定就先打印节点结构）。
- transact 的 ops（数组，一次提交，任一失败则全部不生效）：
  - { type: "add_node", node: { id, type: "text", title, position: { x, y }, width: 340, height: 240, metadata: { content: "文字", status: "success", fontSize: 14 } } }（id 自己生成，不能重复；新节点不要与已有节点重叠，先读取 canvas.getNodes() 算出空位）
  - { type: "update_node", id, patch?: { title?, position?, width?, height?, metadata? }, metadata? }（metadata 只合并传入的字段）
  - { type: "move_nodes", items: [{ id, x?, y?, dx?, dy? }] }（绝对坐标或相对偏移）
  - { type: "delete_node", ids: [...] }
  - { type: "connect_nodes", connection: { id, fromNodeId, toNodeId } }
  - { type: "delete_connections", ids: [...], all?: true }
  - { type: "group_nodes", ids, id, title }、{ type: "ungroup_nodes", ids }、{ type: "set_group_members", groupId, nodeIds }
- 注意：除这些接口外，不要访问宿主内部对象、DOM 结构、localStorage 和网络存储，不要使用 eval。

四、示例（按需选择，不要全部照抄）
示例 1：底栏扩展菜单里加一个按钮，给选中的文本节点末尾追加文字
export default {
    contributions: [
        {
            point: { id: "builtin:menus" },
            id: "<插件名>:menu",
            value: {
                id: "<插件名>:menu",
                locations: ["canvas.extensions"],
                transform({ canvas, items }) {
                    return [
                        ...items,
                        {
                            id: "<插件名>:append",
                            type: "action",
                            title: "追加签名",
                            async run() {
                                const ids = canvas.getSelectedIds();
                                const ops = canvas.getNodes()
                                    .filter((node) => ids.includes(node.id) && node.type === "text")
                                    .map((node) => ({
                                        type: "update_node",
                                        id: node.id,
                                        metadata: { content: node.metadata.content + "\n—— 签名" },
                                    }));
                                await canvas.transact(ops);
                            },
                        },
                    ];
                },
            },
        },
    ],
};

示例 2：节点悬浮按钮，调用文本模型改写文本节点
const React = globalThis.InfiniteCanvasRuntime.React;
export default {
    contributions: [
        {
            point: { id: "builtin:node-tools" },
            id: "<插件名>:polish",
            value: {
                resolve(ctx) {
                    if (ctx.node.type !== "text") return null;
                    return {
                        title: "润色文本",
                        label: "润色",
                        icon: React.createElement("span", null, "润"),
                        async run() {
                            const result = await ctx.models.generateText({ prompt: "请润色以下文字，只返回结果：\n" + ctx.node.metadata.content });
                            await ctx.updateMetadata({ content: result.text });
                        },
                    };
                },
            },
        },
    ],
};

示例 3：自定义节点（计数器），状态保存在 metadata
const React = globalThis.InfiniteCanvasRuntime.React;
function Counter({ ctx }) {
    const count = ctx.node.metadata.count || 0;
    return React.createElement(
        "button",
        {
            style: { width: "100%", height: "100%", color: ctx.theme.node.text },
            onClick: () => ctx.updateMetadata({ count: count + 1 }),
        },
        "点击次数：" + count,
    );
}
export default {
    contributions: [
        {
            point: { id: "builtin:nodes" },
            id: "<插件名>:counter",
            value: {
                type: "<插件名>:counter",
                title: "计数器",
                icon: "＋",
                defaultSize: { width: 240, height: 120 },
                hidePanel: true,
                Content: Counter,
            },
        },
    ],
};

示例 4：监听生成完成并提示（setup + 事件）
export default {
    contributions: [],
    setup(ctx) {
        return ctx.on("result.applied", (event) => {
            console.log("生成完成", event.kind, event.nodeIds);
        });
    },
};

示例 5：主题
export default {
    contributions: [
        {
            point: { id: "builtin:themes" },
            id: "<插件名>:ocean",
            value: {
                id: "<插件名>:ocean",
                name: "深海",
                description: "深蓝底色",
                mode: "dark",
                background: "#0b1d2a",
                panel: "#102a3b",
                surface: "#16384d",
                text: "#e6f1f7",
                muted: "#8fb0c2",
                border: "#1f4660",
                accent: "#38bdf8",
                accentText: "#04202e",
            },
        },
    ],
};

五、模型调用脚本（builtin:call-scripts）
单个脚本的贡献写法：
{
    point: { id: "builtin:call-scripts" },
    id: "<插件名>:<脚本名>",
    value: {
        name: "显示名称",
        description: "一句话说明",
        capability: "image",
        source: "async function main(params) { ... }",
    },
}

调用脚本规则：
- name 和 description 显示在「设置 → 插件」里。
- 贡献的 id 必须以「<插件名>:」开头。
- capability 取 image、video、text、audio 之一，一个脚本只对应一种用途；用户在「设置 → 渠道」里把该脚本绑定到同用途的模型后才会被调用。
- source 是脚本源码字符串，必须定义 async function main(params)；脚本在浏览器或本地服务中通过 new Function 执行，不能使用 import、require 和 Node 专有接口，只能用标准 JavaScript 和 params 提供的能力。
- source 写在模板字符串里时，源码内不要出现反引号和 \${}；需要换行用 \\n 并注意转义，或改用普通字符串拼接。
- 不要把密钥写进源码，密钥只从 params.apiKey 读取；请求用 utils 方法发送，会自动使用渠道代理和取消信号。
- 直接信任输入，不要为了容错堆叠大量分支；请求配置、请求体等多字段对象逐字段换行，嵌套内容分层缩进。
- 失败时直接 throw new Error(...)，错误会由应用统一转成用户提示。

易错点：
- text 的 params.prompt 是空字符串，不要使用；对话在 params.messages（[{ role, content }]，content 是字符串，或由 { type: "text", text } 与 { type: "image_url", image_url: { url } } 组成的数组），通常取最后一条 user 消息，或把整个 messages 转发给模型。
- text 的 params.tools 存在时是画布聊天，需要返回 utils.runTextAgent(协议名, 设置) 的结果 {text, messages}，不能自己拼工具调用；不需要支持画布聊天时可忽略。
- utils.onDelta(text) 传的是截至目前的完整文本，不是增量；流式时仍要 return 完整文本。
- images、videos、audios 是原始链接数组，不会预先下载；需要文件或 Base64 时用 utils.toBlob / utils.toDataUrl，需要公网链接时用 utils.toPublicUrl。
- options 中未设置的字段为 undefined；video 查询任务时 options 为空。

各用途的初始模板（脚本由应用调用 main(params)；注释列出了该用途可用的全部参数和 utils 方法，按所需用途写 source，不要保留 SCRIPT_NOT_IMPLEMENTED）：

${modelCapabilities.map((capability) => `【${capability}】\n${createCallScriptSource(capability)}`).join("\n\n")}

返回值（返回错误类型或空值会提示「未能读取生成结果」）：
- image：返回数组，元素是 URL、data URL，或 { url } / { b64_json }；至少一张。
- text：返回非空字符串（普通调用）；画布聊天（params.tools 存在）返回 utils.runTextAgent 的结果 {text, messages}。
- audio：返回 Blob、URL、data URL、Base64，或 { url } / { b64_json }。
- video：这是异步任务，应用会先创建再反复查询。
  - params.taskId 为空：创建任务并返回 { id: "任务 id" }（id 必须是非空字符串）；如果服务同步完成，也可直接返回视频 URL、Blob 或 { url }。
  - params.taskId 有值：只查询一次并返回 { status: "pending" }、{ status: "failed", message: "原因" } 或 { status: "completed", result: { url } }，不要在脚本里循环等待。

写完后请自查：
1. 默认导出只有 contributions、setup、css；已写 plugin.json（name、description、version、author）和 GUIDE.md；没有 import、JSX 和 SDK 依赖。
2. 每个贡献的 point.id 和 value 字段与上面的说明一致，没有多写字段；id 以「<插件名>:」开头，节点类型 id 与 type 相同、主题 id 与贡献 id 相同。
3. 菜单 transform 是同步纯函数；节点工具不适用时返回 null；涉及画布写入的地方都等待了 transact 的返回。
4. 调用脚本：capability 与返回值类型对应，text 读取了 messages 而不是 prompt，源码里没有密钥。
5. 新增节点没有与已有节点重叠，颜色使用 ctx.theme 而不是写死黑白。
完成后告诉我，我会在「设置 → 插件」里启用它；如果启用失败，我会把浏览器控制台里 [plugins] 开头的日志发给你，请据此修改。

我想要的插件：`;
}
