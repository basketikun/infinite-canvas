import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

type VideoCliProvider = "dreamina" | "libtv";
type VideoSetting = { key: string; label: string; type: "select" | "number" | "switch"; options?: Array<{ value: string | number; label: string }>; min?: number; max?: number; step?: number; defaultValue?: unknown };
type VideoCliTask = { id: string; provider: VideoCliProvider; remoteId: string; projectId?: string; title?: string; directory: string; filePath?: string; remoteUrl?: string; error?: string; childDone?: Promise<{ code: number | null; output: string }>; childResult?: { code: number | null; output: string } };

const taskRoot = path.join(os.homedir(), ".canvas-agent", "video-cli-tasks");
const tasks = new Map<string, VideoCliTask>();

export async function listVideoCliModels(provider: VideoCliProvider) {
    if (provider === "dreamina") {
        const { output } = await runCli(provider, ["text2video", "--help"]);
        const modelIds = dreaminaModelIds(output);
        if (!modelIds.length) throw new Error("无法从即梦 CLI 读取视频模型规格");
        return {
            models: modelIds.map((id) => ({ id, label: id.replace(/^seedance/i, "Seedance ").replace(/fast/gi, " Fast").replace(/mini/gi, " Mini").replace(/_vip/gi, " VIP").replace(/_/g, " ") })),
            modes: [{ value: "text2video", label: "文生视频" }],
            settings: [] satisfies VideoSetting[],
        };
    }

    const result = parseJson((await runCli(provider, ["model", "search", "--type", "video"])).output);
    const matches = Array.isArray(result.matches) ? result.matches : [];
    return { models: matches.map((item: Record<string, unknown>) => ({ id: String(item.modelKey || ""), label: String(item.modelName || item.modelKey || "") })).filter((item: { id: string }) => item.id), modes: [], settings: [] };
}

export async function getVideoCliModelSchema(modelKey: string) {
    if (!/^[\w.-]+$/.test(modelKey)) throw new Error("视频模型无效");
    const model = parseJson((await runCli("libtv", ["model", modelKey])).output);
    const schema = (model.schema || {}) as Record<string, any>;
    const config = (schema.config || {}) as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, Record<string, any>>;
    const configuredModes = config.settings && !Array.isArray(config.settings) ? Object.keys(config.settings as Record<string, unknown>) : [];
    const modeKeys = [...new Set([...configuredModes, ...Object.keys(properties.modeType?.items || {})])];
    const mode = modeKeys.includes("text2video") ? "text2video" : "";
    const configuredFields = (source: unknown) => {
        if (Array.isArray(source)) return source;
        if (source && typeof source === "object" && mode) {
            const fields = (source as Record<string, unknown>)[mode];
            return Array.isArray(fields) ? fields : [];
        }
        return [];
    };
    const fieldNames = [...new Set([...configuredFields(config.settings), ...configuredFields(config.advancedSettings)])];
    const settings = fieldNames.flatMap((key) => {
        const property = properties[String(key)];
        if (!property) return [];
        const values = Array.isArray(property.enum) ? property.enum.map((option: unknown) => typeof option === "object" && option !== null ? { value: (option as Record<string, unknown>).value as string | number, label: String((option as Record<string, unknown>).displayName || (option as Record<string, unknown>).value) } : { value: option as string | number, label: String(option) }) : [];
        const type = property.component === "switch" ? "switch" : values.length ? "select" : typeof property.min === "number" && typeof property.max === "number" ? "number" : "";
        if (!type) return [];
        return [{ key: String(property.originalField || key), label: String(property.displayName || key), type, ...(values.length ? { options: values } : {}), ...(type === "number" ? { min: property.min, max: property.max, step: property.step || 1 } : {}), defaultValue: property.default }];
    });
    return { model: String(model.modelKey || modelKey), label: String(model.modelName || model.modelKey || modelKey), mode, modes: modeKeys, settings };
}

export async function getVideoCliSchema(provider: VideoCliProvider, modelKey: string) {
    if (provider === "libtv") return await getVideoCliModelSchema(modelKey);
    const help = (await runCli("dreamina", ["text2video", "--help"])).output;
    const model = dreaminaModelIds(help).includes(modelKey);
    if (!model) throw new Error("即梦视频模型已不可用，请刷新模型列表");
    const ratioLine = help.match(/ratio:\s*(?:supported values:\s*)?([^\r\n]+)/i)?.[1] || "";
    const ratios = ratioLine.split(",").map((item) => item.trim()).filter((item) => /^\d+:\d+$/.test(item));
    const constraints = help.split(/\r?\n/).find((line) => line.trim().startsWith(`- ${modelKey} ->`)) || help.split(/\r?\n/).find((line) => line.trim().startsWith("- all other models ->")) || "";
    const resolutions: string[] = constraints.match(/\b(?:\d{3,4}p|4k)\b/gi) || [];
    const duration = constraints.match(/duration\s+(\d+)\s*-\s*(\d+)s/i);
    if (!ratios.length || !resolutions.length || !duration) throw new Error("无法从即梦 CLI 读取所选模型的参数规格");
    return {
        model: modelKey,
        label: modelKey.replace(/^seedance/i, "Seedance ").replace(/fast/gi, " Fast").replace(/mini/gi, " Mini").replace(/_vip/gi, " VIP").replace(/_/g, " "),
        mode: "text2video",
        modes: ["text2video"],
        settings: [
            { key: "ratio", label: "视频比例", type: "select", options: ratios.map((value) => ({ value, label: value })), defaultValue: ratios.includes("16:9") ? "16:9" : ratios[0] },
            { key: "resolution", label: "分辨率", type: "select", options: [...new Set(resolutions)].map((value) => ({ value, label: value })), defaultValue: resolutions.includes("720p") ? "720p" : resolutions[0] },
            { key: "duration", label: "时长（秒）", type: "number", min: Number(duration[1]), max: Number(duration[2]), step: 1, defaultValue: Math.min(Number(duration[2]), Math.max(Number(duration[1]), 5)) },
        ] satisfies VideoSetting[],
    };
}

function dreaminaModelIds(help: string) {
    const line = help.match(/^\s*-\s*model_version:\s*([^\r\n]+)/im)?.[1]
        || help.match(/--model_version\s+\S+\s+supported values:\s*([^\r\n]+)/i)?.[1]
        || "";
    return line.replace(/;.*$/, "").split(",").map((item) => item.trim()).filter(Boolean);
}

export async function listLibTvProjects() {
    const projects = new Map<string, { id: string; name: string }>();
    const pageSize = 20;
    for (let page = 1; ; page += 1) {
        const result = parseJson((await runCli("libtv", ["project", "list", "--page", String(page)])).output);
        const current: Array<{ id: string; name: string }> = [];
        const visit = (value: unknown) => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) return value.forEach(visit);
            const record = value as Record<string, unknown>;
            const id = record.uuid ?? record.projectUuid ?? record.project_uuid ?? record.projectId ?? record.project_id ?? record.id;
            const name = record.name ?? record.title ?? record.projectName ?? record.project_name;
            if (id !== undefined && name !== undefined) current.push({ id: String(id), name: String(name) });
            Object.values(record).forEach(visit);
        };
        visit(result);
        const sizeBefore = projects.size;
        current.forEach((project) => projects.set(project.id, project));
        if (current.length < pageSize || projects.size === sizeBefore) break;
    }
    return [...projects.values()];
}

export async function startVideoCliTask(input: { provider: VideoCliProvider; prompt: string; model: string; settings: Record<string, string | number | boolean>; projectId?: string }) {
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("请输入视频提示词");
    const id = nanoid();
    const directory = path.join(taskRoot, id);
    await mkdir(directory, { recursive: true });
    if (input.provider === "dreamina") {
        const schema = await getVideoCliSchema("dreamina", input.model);
        const settings = resolveSettings(schema.settings as VideoSetting[], input.settings);
        const args = ["text2video", "--prompt", prompt, "--model_version", input.model, "--poll", "0"];
        for (const [key, flag] of [["ratio", "--ratio"], ["resolution", "--video_resolution"], ["duration", "--duration"]]) {
            const value = settings[key];
            if (value !== undefined && value !== "") args.push(flag, String(value));
        }
        const result = await runCli("dreamina", args);
        const remoteId = findTaskId(result.output);
        if (!remoteId) throw new Error(`即梦 CLI 没有返回任务编号：${result.output}`);
        const task: VideoCliTask = { id, provider: input.provider, remoteId, directory };
        tasks.set(id, task);
        await saveTask(task);
        return { id, provider: input.provider };
    }

    const projectId = String(input.projectId || "");
    if (!projectId) throw new Error("请选择 LibTV 画布");
    const schema = await getVideoCliModelSchema(input.model);
    if (!schema.mode) throw new Error("所选 LibTV 模型不支持当前的文生视频流程");
    const settings = resolveSettings(schema.settings as VideoSetting[], input.settings);
    const title = `Infinite Canvas ${Date.now()}`;
    const createArgs = ["node", "create", title, "--type", "video", "--project", projectId, "--prompt", prompt, "--set", `model=${schema.label}`, "--set", `modeType=${schema.mode}`];
    for (const setting of schema.settings as VideoSetting[]) {
        const value = settings[setting.key];
        if (value !== undefined && value !== "") createArgs.push("--set", `${setting.key}=${String(value)}`);
    }
    const created = await runCli("libtv", createArgs);
    const remoteId = findNodeId(created.output);
    if (!remoteId) throw new Error(`LibTV CLI 没有返回节点编号：${created.output}`);
    const task: VideoCliTask = { id, provider: input.provider, remoteId, projectId, title, directory };
    tasks.set(id, task);
    await saveTask(task);
    task.childDone = runCli("libtv", ["node", remoteId, "--project", projectId, "--run"]).then(({ output }) => (task.childResult = { code: 0, output }), (error: Error & { output?: string; code?: number }) => (task.childResult = { code: error.code ?? 1, output: error.output || error.message }));
    return { id, provider: input.provider };
}

export async function getVideoCliTask(id: string) {
    const task = await getTask(id);
    if (task.provider === "dreamina") {
        const result = await runCli("dreamina", ["query_result", "--submit_id", task.remoteId, "--download_dir", task.directory]).catch((error: Error & { output?: string }) => ({ output: error.output || error.message, code: 1 }));
        const files = await videoFiles(task.directory);
        if (files.length) task.filePath = files[0];
        const state = taskState(result.output);
        if (task.filePath || state === "completed") {
            if (!task.filePath) task.remoteUrl = findVideoUrl(result.output);
            await saveTask(task);
            return { status: "completed" as const, fileUrl: task.filePath ? `/agent/video-cli/tasks/${id}/file` : undefined, url: task.remoteUrl };
        }
        if (state === "failed") return { status: "failed" as const, error: result.output };
        return { status: "pending" as const };
    }

    if (task.childDone && !task.childResult) return { status: "pending" as const };
    if (task.childResult) {
        const result = task.childResult;
        if (result.code !== 0) return { status: "failed" as const, error: result.output };
        task.childDone = undefined;
        task.childResult = undefined;
    } else if (!task.filePath) {
        const result = await runCli("libtv", ["node", task.remoteId, "--project", task.projectId || ""]).catch((error: Error & { output?: string }) => ({ output: error.output || error.message, code: 1 }));
        const state = taskState(result.output);
        if (state === "failed") return { status: "failed" as const, error: result.output };
        if (state !== "completed") return { status: "pending" as const };
    }
    if (!task.filePath) {
        await runCli("libtv", ["download", "--node", task.remoteId, "--project", task.projectId || "", "--out", task.directory]);
        task.filePath = (await videoFiles(task.directory))[0];
        await saveTask(task);
    }
    return task.filePath ? { status: "completed" as const, fileUrl: `/agent/video-cli/tasks/${id}/file` } : { status: "failed" as const, error: "CLI 生成完成，但没有找到视频文件" };
}

export async function readVideoCliTaskFile(id: string) {
    const task = await getTask(id);
    if (!task.filePath) throw new Error("视频文件尚未就绪");
    const extension = path.extname(task.filePath).toLowerCase();
    return { data: await readFile(task.filePath), mimeType: extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "video/mp4" };
}

export async function deleteVideoCliTask(id: string) {
    const task = await getTask(id);
    tasks.delete(id);
    await rm(task.directory, { recursive: true, force: true });
}

async function getTask(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error("视频任务编号无效");
    const cached = tasks.get(id);
    if (cached) return cached;
    const file = path.join(taskRoot, id, "task.json");
    const task = JSON.parse(await readFile(file, "utf8")) as VideoCliTask;
    if (task.id !== id || task.directory !== path.join(taskRoot, id) || !["dreamina", "libtv"].includes(task.provider)) throw new Error("视频任务记录无效");
    if (task.filePath && (path.dirname(task.filePath) !== task.directory || !/\.(mp4|mov|webm|m4v)$/i.test(task.filePath))) throw new Error("视频任务文件路径无效");
    tasks.set(id, task);
    return task;
}

async function saveTask(task: VideoCliTask) {
    const { childDone: _childDone, childResult: _childResult, ...data } = task;
    await writeFile(path.join(task.directory, "task.json"), JSON.stringify(data), "utf8");
}

async function videoFiles(directory: string) {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.(mp4|mov|webm|m4v)$/i.test(entry.name)).map((entry) => path.join(directory, entry.name));
}

function executable(provider: VideoCliProvider) {
    const home = os.homedir();
    const candidate = process.platform === "win32" ? provider === "libtv" ? path.join(home, ".libtv", "libtv.exe") : path.join(home, ".dreamina_cli", "dreamina", "dreamina.exe") : provider;
    return existsSync(candidate) ? candidate : process.platform === "win32" ? `${provider}.exe` : provider;
}

function runCli(provider: VideoCliProvider, args: string[]) {
    return new Promise<{ output: string; code: number }>((resolve, reject) => {
        const child = spawn(executable(provider), args, { cwd: os.homedir(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.once("error", (error) => reject(Object.assign(new Error(`${provider} CLI 启动失败：${error.message}`), { output })));
        child.once("close", (code) => code === 0 ? resolve({ output: stripAnsi(output), code: 0 }) : reject(Object.assign(new Error(stripAnsi(output).trim() || `${provider} CLI 退出码 ${code}`), { output: stripAnsi(output), code: code ?? 1 })));
    });
}

function parseJson(output: string) {
    const text = stripAnsi(output).trim();
    try { return JSON.parse(text) as Record<string, any>; } catch {}
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)) as Record<string, any>; } catch {}
    }
    for (const line of text.split(/\r?\n/).reverse()) {
        try { return JSON.parse(line) as Record<string, any>; } catch {}
    }
    throw new Error(text || "CLI 没有返回 JSON");
}

function findTaskId(output: string) {
    try {
        const data = parseJson(output);
        const visit = (value: unknown): string => {
            if (!value || typeof value !== "object") return "";
            if (Array.isArray(value)) return value.map(visit).find(Boolean) || "";
            const record = value as Record<string, unknown>;
            const match = record.submit_id ?? record.submitId ?? record.task_id ?? record.taskId;
            if (typeof match === "string" && match) return match;
            return Object.values(record).map(visit).find(Boolean) || "";
        };
        return visit(data);
    } catch {
        return output.match(/(?:submit[_-]?id|task[_-]?id)["'\s:=]+([\w-]+)/i)?.[1] || "";
    }
}

function findNodeId(output: string) {
    try {
        const data = parseJson(output);
        const visit = (value: unknown): string => {
            if (!value || typeof value !== "object") return "";
            if (Array.isArray(value)) return value.map(visit).find(Boolean) || "";
            const record = value as Record<string, unknown>;
            const match = record.nodeKey ?? record.newNodeKey ?? record.nodeId ?? record.node_id ?? record.nodeUuid ?? record.node_uuid;
            if (typeof match === "string" && match) return match;
            if (record.type === "video" && typeof record.id === "string") return record.id;
            return Object.values(record).map(visit).find(Boolean) || "";
        };
        const id = visit(data);
        if (id) return id;
        return typeof data.id === "string" ? data.id : "";
    } catch {
        return "";
    }
}

function taskState(output: string) {
    const text = stripAnsi(output).toLowerCase();
    try {
        const data = parseJson(text);
        const states: string[] = [];
        const visit = (value: unknown) => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) return value.forEach(visit);
            for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
                if (/status|state/i.test(key) && typeof item === "string") states.push(item.toLowerCase());
                visit(item);
            }
        };
        visit(data);
        if (states.some((state) => /success|succeed|complete|finished/.test(state))) return "completed";
        if (states.some((state) => /fail|error|cancel|reject/.test(state))) return "failed";
        if (states.length) return "pending";
    } catch {}
    if (/\b(failed|failure|task .*not found|record not found|cancelled|canceled)\b/.test(text)) return "failed";
    if (/\b(success|succeeded|completed|complete|finished)\b/.test(text)) return "completed";
    return "pending";
}

function findVideoUrl(output: string) {
    const urls = output.match(/https?:\/\/[^\s"'<>]+/g) || [];
    return urls.find((url) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) || "";
}

function stripAnsi(value: string) {
    return value.replace(/\u001b\[[0-9;]*m/g, "").trim();
}

function resolveSettings(settings: VideoSetting[], values: Record<string, string | number | boolean>) {
    return Object.fromEntries(settings.flatMap((setting) => {
        const value = values[setting.key] ?? setting.defaultValue;
        if (value === undefined) return [];
        if (setting.type === "select" && setting.options?.length && !setting.options.some((option) => String(option.value) === String(value))) throw new Error(`${setting.label}不是当前模型支持的选项`);
        if (setting.type === "number") {
            const number = Number(value);
            if (!Number.isFinite(number) || (setting.min !== undefined && number < setting.min) || (setting.max !== undefined && number > setting.max)) throw new Error(`${setting.label}超出当前模型支持的范围`);
            return [[setting.key, number]];
        }
        return [[setting.key, value]];
    }));
}
