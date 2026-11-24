import type { ModelCapability } from "@infinite-canvas/shared/models";

const optionDocs: Record<ModelCapability, string[]> = {
    image: [
        "@param {string|undefined} params.options.size 图片像素尺寸，如 1024x1024；自动时未设置",
        "@param {string|undefined} params.options.ratio 原始图片比例，如 16:9 或 1024:768；协议支持的比例由脚本转换",
        "@param {string|undefined} params.options.resolution 图片预设分辨率档位，如 1K、2K、4K；自定义尺寸未设置，由脚本按需推导",
        "@param {string|undefined} params.options.quality 图片质量",
        "@param {number} params.options.count 生成图片数量",
        "@param {string|undefined} params.options.background transparent 表示透明背景",
    ],
    video: [
        "@param {string} params.options.mode frames 首尾帧；reference 多素材参考",
        "@param {string} params.options.seconds 视频时长，单位秒",
        "@param {string|null} params.options.size 视频像素尺寸；自动时为 null",
        "@param {string} params.options.resolution 视频分辨率，如 720p、1080p",
        "@param {string} params.options.ratio 视频比例，如 16:9",
        "@param {boolean} params.options.generateAudio 是否生成音频",
        "@param {boolean} params.options.watermark 是否添加水印",
    ],
    text: [
        "@param {object|undefined} params.tools 聊天使用的画布工具；存在时 messages 使用 AI SDK ModelMessage 格式",
        "@param {function(string, object=):Promise<object>} params.utils.runTextAgent 使用 responses / chat-completions / anthropic / gemini 协议返回 {text,messages}，保留工具调用上下文；第二个参数提供协议专属 providerOptions 和 maxOutputTokens",
    ],
    audio: [
        "@param {string} params.options.voice 音色",
        "@param {string} params.options.format 音频格式",
        "@param {string} params.options.speed 语速",
        "@param {string} params.options.instructions 朗读风格要求",
    ],
};

const results: Record<ModelCapability, string> = {
    image: "@returns {Promise<Array<string|{url:string}|{b64_json:string}>>} 图片 URL / data URL 数组，或包含 url / b64_json 的对象数组",
    video: "@returns {Promise<object|string|Blob>} 创建返回 {id}；查询返回 {status:'pending'|'failed'} 或 {status:'completed',result:{url}}；同步完成也可返回 URL / Blob",
    text: "@returns {Promise<string|{text:string,messages:Array<object>}>} 普通文本返回字符串；工具模式返回 runTextAgent 结果",
    audio: "@returns {Promise<Blob|string|object>} 音频 Blob、URL、data URL、Base64 或 {url} / {b64_json}",
};

const destructuring: Record<ModelCapability, string> = {
    image: `const { model, prompt, images, options, utils } = params;
const {
    size,
    ratio,
    resolution,
    quality,
    count,
    background,
} = options;`,
    video: `const {
    model,
    prompt,
    images,
    videos,
    audios,
    taskId,
    options,
    utils,
} = params;
const {
    mode,
    seconds,
    size,
    resolution,
    ratio,
    generateAudio,
    watermark,
} = options;`,
    text: `const {
    model,
    messages,
    systemPrompt,
    reasoningEffort,
    utils,
} = params;`,
    audio: `const { model, prompt, options, utils } = params;
const {
    voice,
    format,
    speed,
    instructions,
} = options;`,
};

/**
 * 内置源码与新建模板使用同一份参数注释，扩展参数时只维护这里。
 */
export function createCallScriptSource(capability: ModelCapability, body = `${destructuring[capability]}\n\n// 在这里调用服务并 return 结果；工具方法通过 utils.xxx 使用。\nthrow new Error("SCRIPT_NOT_IMPLEMENTED");`) {
    const lines = [
        "由应用调用 main(params)，无需手动调用；按需从 params 解构，新增参数不影响现有写法。",
        "请求配置和请求体按字段换行，嵌套对象分层缩进；长条件、循环及链式处理分行书写。",
        "@param {object} params 本次调用的全部参数",
        "@param {'image'|'video'|'text'|'audio'} params.capability 当前用途",
        "@param {string} params.model 模型名称，不含渠道前缀",
        "@param {string} params.baseUrl 渠道服务地址",
        "@param {string} params.apiKey 渠道密钥，勿写死在源码中",
        "@param {string} params.prompt 本次提示词；生图时已包含系统提示词",
        "@param {string} params.systemPrompt 原始系统提示词",
        "@param {string} params.reasoningEffort 文本思考程度，auto 表示自动",
        "@param {string[]} params.images 参考图片原始链接（http / blob / data URL），按输入顺序排列",
        "@param {string[]} params.videos 参考视频原始链接（http / blob / data URL），按输入顺序排列",
        "@param {string[]} params.audios 参考音频原始链接（http / blob / data URL），按输入顺序排列",
        "素材不预先下载或转换；需要文件或 Base64 时由脚本调用 utils.toBlob / utils.toDataUrl。",
        "@param {Array<{role:string,content:string|Array<object>}>} params.messages 文本对话消息，含系统消息",
        "@param {string|undefined} params.taskId 视频创建时未设置；查询时为创建返回的 id",
        "@param {AbortSignal|undefined} params.signal 取消信号；utils 中的请求自动携带",
        "@param {object} params.options 当前用途的生成设置；视频任务查询时为空",
        ...optionDocs[capability],
        "@param {object} params.utils 辅助方法，所有请求自动使用渠道代理与取消信号",
        "@param {object} params.utils.http 自动使用渠道密钥的请求方法",
        "@param {function(string, object=, object=):Promise<unknown>} params.utils.http.post post(path, body, {headers,params,responseType})，自动 Bearer 鉴权，相对路径接 /v1",
        "@param {function(string, object=):Promise<unknown>} params.utils.http.get get(path, {headers,params,responseType})，自动 Bearer 鉴权，相对路径接 /v1",
        "@param {function(string):string} params.utils.http.url url(path)，生成带 /v1 的请求地址",
        "@param {function(object):Promise<unknown>} params.utils.request request({method,url,headers,data,params,responseType,timeout})，自行设置鉴权；相对地址不加 /v1",
        "@param {function(object, function):Promise<void>} params.utils.stream stream({url,headers,data}, onEvent)，逐个读取 SSE / JSON 事件，自行设置鉴权",
        "@param {(function(string):void)|undefined} params.utils.onDelta 文本用途使用；传截至目前的完整文本",
        "@param {function(function, function, object=):Promise<unknown>} params.utils.poll poll(request, extract, {intervalMs,timeoutMs})，extract 返回 null / undefined / false 时继续；默认间隔 2500ms、超时 300000ms",
        "@param {function(number):Promise<void>} params.utils.sleep sleep(ms)，可取消的等待",
        "@param {function(string|Blob):Promise<Blob>} params.utils.toBlob 将 URL / data URL / File 转成 Blob",
        "@param {function(string|Blob):Promise<string>} params.utils.toDataUrl 将 URL / Blob / File 转成 data URL",
        "@param {function(string|Blob):Promise<string>} params.utils.toPublicUrl 已有公网 URL 原样返回；其他素材上传至设置中的 S3 兼容对象存储，返回公开链接；未配置时提示补全设置",
        "@param {function(string):Promise<string[]>} params.utils.markdownImages 提取 Markdown 中的图片链接（含引用式图片）",
        "@param {function(string):Promise<string[]>} params.utils.markdownLinks 提取 Markdown 中的普通链接（含引用式链接与自动链接）",
        results[capability],
    ];
    return ["/**", ...lines.map((line) => ` * ${line}`), " */", "async function main(params) {", ...body.split("\n").map((line) => line ? `    ${line}` : ""), "}"].join("\n");
}
