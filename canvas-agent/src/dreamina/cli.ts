import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { CONFIG_DIR } from "../config.js";

const VIDEO_COMMANDS = ["text2video", "image2video", "frames2video", "multiframe2video", "multimodal2video"] as const;
const MEDIA_EXTENSION_BY_TYPE: Record<string, string[]> = {
    image: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    video: [".mp4", ".mov", ".webm", ".m4v"],
    audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"],
};

export type DreaminaCommand = (typeof VIDEO_COMMANDS)[number];
export type DreaminaCapability = { command: DreaminaCommand; flags: string[]; models: string[]; ratios: string[]; durations?: [number, number]; resolutions: string[] };
export type DreaminaStatus = { installed: boolean; path?: string; version?: string; loggedIn?: boolean; credits?: string; creditsRemaining?: number; creditRefreshDate?: string; error?: string };
export type DreaminaVideoInput = {
    command: DreaminaCommand;
    prompt: string;
    model?: string;
    duration?: number;
    ratio?: string;
    resolution?: string;
    generateAudio?: boolean;
    imageIds?: string[];
    videoIds?: string[];
    audioIds?: string[];
};

export class DreaminaError extends Error {
    constructor(message: string, readonly statusCode = 400, readonly code = "DREAMINA_ERROR") {
        super(message);
        this.name = "DreaminaError";
    }
}

type UploadedAsset = { file: string; kind: "image" | "video" | "audio" };
const uploadedAssets = new Map<string, UploadedAsset>();
const taskDirectories = path.join(CONFIG_DIR, "dreamina", "tasks");
const assetDirectory = path.join(CONFIG_DIR, "dreamina", "assets");
let capabilitiesCache: DreaminaCapability[] | undefined;
let capabilitiesRequest: Promise<DreaminaCapability[]> | undefined;

export async function getDreaminaStatus(): Promise<DreaminaStatus> {
    const executable = await findDreaminaCli();
    if (!executable) return { installed: false };

    const [versionResult, creditResult] = await Promise.all([
        runCommand(executable, ["--version"]).catch(() => null),
        runCommand(executable, ["user_credit"]).catch(() => null),
    ]);
    const version = versionResult ? firstUsefulLine(versionResult.stdout || versionResult.stderr) : undefined;
    const creditOutput = creditResult ? `${creditResult.stdout}\n${creditResult.stderr}` : "";
    const creditData = parseJsonObject(creditOutput);
    const creditValue = findObjectValue(creditData, ["total_credit", "credit", "credits", "balance", "remaining_credit", "available_credit"]);
    const creditText = creditValue === undefined ? firstUsefulLine(creditOutput) : String(creditValue);
    const creditsRemaining = creditValue === undefined ? undefined : Number(String(creditValue).replace(/,/g, ""));
    const creditRefreshValue = findObjectValue(creditData, ["next_credit_refresh_at", "next_credit_refresh_date", "next_credit_update_at", "credit_refresh_date", "credit_reset_at"]);
    const creditRefreshDate = normalizeCreditRefreshDate(creditRefreshValue);
    const loginError = findObjectValue(creditData, ["error", "message", "reason"]);
    const loggedIn = Boolean(creditResult && creditResult.code === 0 && !/login required|not logged in|unauthorized|未登录/i.test(`${creditText || ""} ${String(loginError || "")}`));
    return {
        installed: true,
        path: executable,
        ...(version ? { version } : {}),
        loggedIn,
        ...(loggedIn && creditText ? { credits: creditText } : {}),
        ...(loggedIn && Number.isFinite(creditsRemaining) ? { creditsRemaining } : {}),
        ...(loggedIn && creditRefreshDate ? { creditRefreshDate } : {}),
        ...(!loggedIn && creditText ? { error: sanitizeCliOutput(creditText) } : {}),
    };
}

export async function startDreaminaLogin() {
    const executable = await requireDreaminaCli();
    const result = await runCommand(executable, ["login", "--headless"]);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0) throw new DreaminaError(sanitizeCliOutput(result.stderr || result.stdout), 502, "DREAMINA_LOGIN_FAILED");
    const readField = (name: string) => output.match(new RegExp(`(?:^|\\r?\\n)\\s*${name}\\s*:\\s*(\\S+)`, "i"))?.[1];
    const verificationUri = readField("verification_uri");
    const userCode = readField("user_code");
    const deviceCode = readField("device_code");
    if (!verificationUri || !userCode || !deviceCode) throw new DreaminaError("即梦 CLI 未返回完整的登录授权信息", 502, "DREAMINA_LOGIN_FAILED");
    return { started: true, verificationUri, userCode, deviceCode };
}

export async function checkDreaminaLogin(deviceCode: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(deviceCode)) throw new DreaminaError("即梦登录授权信息无效，请重新开始登录", 400, "DREAMINA_LOGIN_CODE_INVALID");
    const executable = await requireDreaminaCli();
    const result = await runCommand(executable, ["login", "checklogin", `--device_code=${deviceCode}`, "--poll=0"]);
    if (result.code === 0) return { authorized: true };
    const output = sanitizeCliOutput(`${result.stdout}\n${result.stderr}`);
    if (/登录尚未完成|not (?:yet )?completed|authorization pending/i.test(output)) return { authorized: false };
    throw new DreaminaError(output || "无法确认即梦登录状态，请重新开始登录", 502, "DREAMINA_LOGIN_CHECK_FAILED");
}

export async function getDreaminaCapabilities(forceRefresh = false) {
    if (!forceRefresh && capabilitiesCache) return capabilitiesCache;
    if (!forceRefresh && capabilitiesRequest) return capabilitiesRequest;

    const request = (async () => {
        const executable = await requireDreaminaCli();
        const results = await Promise.all(VIDEO_COMMANDS.map((command) => runCommand(executable, [command, "-h"]).catch(() => null)));
        return results.flatMap((result, index) => {
            if (!result) return [];
            const help = `${result.stdout}\n${result.stderr}`;
            if (/unknown command|command not found|unrecognized command/i.test(help)) return [];
            const command = VIDEO_COMMANDS[index];
            if (!command) return [];
            const flags = Array.from(help.matchAll(/--([a-z][a-z0-9_-]*)/gi), (match) => match[1].toLowerCase());
            return [{
                command,
                flags: [...new Set(flags)],
                models: parseOptionValues(help, "model_version"),
                ratios: parseOptionValues(help, "ratio"),
                durations: parseNumericRange(help, "duration"),
                resolutions: parseOptionValues(help, "video_resolution"),
            }];
        });
    })();
    capabilitiesRequest = request;
    try {
        const capabilities = await request;
        capabilitiesCache = capabilities;
        return capabilities;
    } finally {
        if (capabilitiesRequest === request) capabilitiesRequest = undefined;
    }
}

export async function saveDreaminaAsset(request: NodeJS.ReadableStream, contentType: string, fileName: string) {
    const kind = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : null;
    if (!kind) throw new DreaminaError("只支持图片、视频或音频参考文件", 415, "DREAMINA_UNSUPPORTED_ASSET");
    const extension = path.extname(path.basename(fileName)).toLowerCase();
    if (!MEDIA_EXTENSION_BY_TYPE[kind].includes(extension)) throw new DreaminaError("参考文件格式不受支持", 415, "DREAMINA_UNSUPPORTED_ASSET");

    await mkdir(assetDirectory, { recursive: true });
    const id = randomUUID();
    const file = path.join(assetDirectory, `${id}${extension}`);
    try {
        await pipeline(request, createWriteStream(file, { flags: "wx" }));
        uploadedAssets.set(id, { file, kind });
        return { id, name: path.basename(file), kind };
    } catch (error) {
        await rm(file, { force: true }).catch(() => undefined);
        throw error;
    }
}

export async function deleteDreaminaAsset(id: string) {
    const asset = uploadedAssets.get(id);
    if (!asset) return;
    uploadedAssets.delete(id);
    await rm(asset.file, { force: true });
}

export async function submitDreaminaVideo(input: DreaminaVideoInput) {
    if (!input.prompt.trim()) throw new DreaminaError("请输入视频提示词", 400, "DREAMINA_PROMPT_REQUIRED");
    const capabilities = await getDreaminaCapabilities();
    const capability = capabilities.find((item) => item.command === input.command);
    if (!capability) throw new DreaminaError("当前 Dreamina CLI 不支持所选生成模式", 400, "DREAMINA_MODE_UNAVAILABLE");

    const imageFiles = resolveAssetIds(input.imageIds, "image");
    const videoFiles = resolveAssetIds(input.videoIds, "video");
    const audioFiles = resolveAssetIds(input.audioIds, "audio");
    const executable = await requireDreaminaCli();
    const args = [input.command, `--prompt=${input.prompt}`];
    appendOption(args, capability, "model_version", input.model);
    appendOption(args, capability, "duration", input.duration);
    appendOption(args, capability, "ratio", input.ratio);
    appendOption(args, capability, "video_resolution", input.resolution);
    appendOption(args, capability, "generate_audio", input.generateAudio);

    if (input.command === "text2video" && (imageFiles.length || videoFiles.length || audioFiles.length)) {
        throw new DreaminaError("文生视频模式不接收参考素材", 400, "DREAMINA_REFERENCES_NOT_SUPPORTED");
    }
    if (input.command === "image2video") {
        if (imageFiles.length !== 1 || videoFiles.length || audioFiles.length) throw new DreaminaError("图生视频模式需要且只接受一张图片", 400, "DREAMINA_IMAGE_REQUIRED");
        requireFlags(capability, ["image"]);
        args.push(`--image=${imageFiles[0]}`);
    } else if (input.command === "frames2video") {
        if (imageFiles.length !== 2 || videoFiles.length || audioFiles.length) throw new DreaminaError("首尾帧模式需要且只接受两张图片", 400, "DREAMINA_FRAMES_REQUIRED");
        requireFlags(capability, ["first", "last"]);
        args.push(`--first=${imageFiles[0]}`, `--last=${imageFiles[1]}`);
    } else if (input.command === "multiframe2video") {
        if (imageFiles.length < 2 || videoFiles.length || audioFiles.length) throw new DreaminaError("多图叙事模式需要至少两张图片，且不接受视频或音频", 400, "DREAMINA_IMAGES_REQUIRED");
        requireFlags(capability, ["images"]);
        args.push(`--images=${imageFiles.join(",")}`);
    } else if (input.command === "multimodal2video") {
        if (!imageFiles.length && !videoFiles.length && !audioFiles.length) throw new DreaminaError("多模态模式至少需要一项参考素材", 400, "DREAMINA_REFERENCE_REQUIRED");
        if (imageFiles.length) requireFlags(capability, ["image"]);
        if (videoFiles.length) requireFlags(capability, ["video"]);
        if (audioFiles.length) requireFlags(capability, ["audio"]);
        imageFiles.forEach((file) => args.push(`--image=${file}`));
        videoFiles.forEach((file) => args.push(`--video=${file}`));
        audioFiles.forEach((file) => args.push(`--audio=${file}`));
    }

    try {
        const result = await runCommand(executable, args);
        const submitId = extractSubmitId(result.stdout, result.stderr);
        if (result.code !== 0 || !submitId) {
            const detail = sanitizeCliOutput(result.stderr || result.stdout);
            throw new DreaminaError(detail || "即梦未返回任务编号，请检查登录状态与 CLI 帮助", 502, "DREAMINA_SUBMIT_FAILED");
        }
        return { id: submitId, command: input.command, model: input.model || "" };
    } finally {
        await Promise.all([...(input.imageIds || []), ...(input.videoIds || []), ...(input.audioIds || [])].map(deleteDreaminaAsset));
    }
}

export async function queryDreaminaTask(submitId: string) {
    assertSubmitId(submitId);
    const executable = await requireDreaminaCli();
    const outputDirectory = path.join(taskDirectories, submitId);
    await mkdir(outputDirectory, { recursive: true });
    const result = await runCommand(executable, ["query_result", `--submit_id=${submitId}`, `--download_dir=${outputDirectory}`]);
    const output = `${result.stdout}\n${result.stderr}`;
    const state = parseTaskState(output);
    if (state.status === "failed") return state;
    const files = await readdir(outputDirectory);
    const mediaFile = files.find((name) => /\.(mp4|mov|webm|m4v)$/i.test(name));
    if (mediaFile) return { status: "completed" as const, fileName: mediaFile };
    if (result.code !== 0 && !state.known) throw new DreaminaError(sanitizeCliOutput(result.stderr || result.stdout), 502, "DREAMINA_QUERY_FAILED");
    return { status: "pending" as const };
}

export async function getDreaminaTaskVideo(submitId: string) {
    assertSubmitId(submitId);
    const directory = path.join(taskDirectories, submitId);
    const files = await readdir(directory).catch(() => []);
    const name = files.find((item) => /\.(mp4|mov|webm|m4v)$/i.test(item));
    if (!name) throw new DreaminaError("即梦任务视频尚未下载", 404, "DREAMINA_VIDEO_NOT_READY");
    const file = path.join(directory, name);
    const fileStat = await stat(file);
    if (!fileStat.isFile()) throw new DreaminaError("即梦任务视频不可用", 404, "DREAMINA_VIDEO_NOT_READY");
    return { file, fileName: name };
}

export async function deleteDreaminaTask(submitId: string) {
    assertSubmitId(submitId);
    await rm(path.join(taskDirectories, submitId), { recursive: true, force: true });
}

async function requireDreaminaCli() {
    const executable = await findDreaminaCli();
    if (!executable) throw new DreaminaError("未检测到 Dreamina CLI，请先安装并重启 Canvas Agent", 503, "DREAMINA_CLI_MISSING");
    return executable;
}

async function findDreaminaCli() {
    const executableName = process.platform === "win32" ? "dreamina.exe" : "dreamina";
    const candidates = [
        process.env.DREAMINA_CLI_PATH,
        path.join(os.homedir(), ".local", "bin", executableName),
        path.join(os.homedir(), ".dreamina_cli", executableName),
        path.join(os.homedir(), ".dreamina_cli", "dreamina", executableName),
        ...((process.env.PATH || "").split(path.delimiter).map((directory) => path.join(directory, executableName))),
    ].filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {}
    }
    return undefined;
}

function runCommand(command: string, args: string[]) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

function resolveAssetIds(ids: string[] | undefined, kind: UploadedAsset["kind"]) {
    return (ids || []).map((id) => {
        const asset = uploadedAssets.get(id);
        if (!asset || asset.kind !== kind) throw new DreaminaError("参考素材上传已过期，请重新生成", 400, "DREAMINA_ASSET_MISSING");
        return asset.file;
    });
}

function appendOption(args: string[], capability: DreaminaCapability, name: string, value: string | number | boolean | undefined) {
    if (value === undefined || value === "") return;
    if (!capability.flags.includes(name)) {
        if (name === "generate_audio" && value === false) return;
        throw new DreaminaError(`当前模式不支持 ${name} 参数`, 400, "DREAMINA_OPTION_UNAVAILABLE");
    }
    args.push(`--${name}=${String(value)}`);
}

function requireFlags(capability: DreaminaCapability, names: string[]) {
    const missing = names.filter((name) => !capability.flags.includes(name));
    if (missing.length) throw new DreaminaError(`当前 CLI 帮助中没有所需参数：${missing.map((name) => `--${name}`).join(", ")}`, 400, "DREAMINA_OPTION_UNAVAILABLE");
}

function parseOptionValues(help: string, name: string) {
    const index = help.toLowerCase().indexOf(`--${name}`);
    if (index < 0) return [];
    const lines = help.slice(index, index + 1000).split(/\r?\n/).slice(0, 8);
    const optionLine = lines.find((line) => /(?:choices?|options?|supported values?|可选值|支持值)/i.test(line));
    const match = optionLine?.match(/(?:choices?|options?|supported values?|可选值|支持值)[^:：]*[:：]?\s*(.*)$/i) || lines.map((line) => line.match(/(?:\{|\[)([^\]}]+)(?:\}|\])/)).find(Boolean);
    if (!match) return [];
    const values = match[1].match(/[a-z0-9]+(?:[._:-][a-z0-9]+)*/gi) || [];
    return [...new Set(values.filter((value) => value !== name && (name !== "video_resolution" || /^(?:\d+p|4k)$/i.test(value))))];
}

function parseNumericRange(help: string, name: string): [number, number] | undefined {
    const index = help.toLowerCase().indexOf(`--${name}`);
    const section = index < 0 ? help : help.slice(index, index + 400);
    const match = section.match(/(?:\[|\()?\s*(\d+)\s*(?:-|–|~|到)\s*(\d+)\s*(?:\]|\))?/);
    return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function extractSubmitId(...outputs: string[]) {
    const text = outputs.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
    const value = findObjectValue(parseJsonObject(text), ["submit_id", "submitid"]);
    if (typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value)) return value;
    return text.match(/(?:submit[_ -]?id|submitId|任务编号|任务ID)\s*[:=："']+\s*([a-z0-9-]{8,80})/i)?.[1];
}

function parseTaskState(output: string) {
    const normalized = output.replace(/\u001b\[[0-9;]*m/g, "").toLowerCase();
    const data = parseJsonObject(output);
    const status = findObjectValue(data, ["gen_status", "status", "state"]);
    const error = findObjectValue(data, ["fail_reason", "error", "message"]);
    const value = String(status || "").toLowerCase();
    if (["success", "succeeded", "completed", "done"].includes(value) || /(?:gen_status|status)\s*[:=：]\s*["']?(success|succeeded|completed)/i.test(normalized)) return { status: "completed" as const, known: true };
    if (["fail", "failed", "error"].includes(value) || /(?:gen_status|status)\s*[:=：]\s*["']?(fail|failed|error)/i.test(normalized)) return { status: "failed" as const, known: true, error: sanitizeCliOutput(typeof error === "string" ? error : output.trim()) };
    return { status: "pending" as const, known: Boolean(status) || /(?:gen_status|status)\s*[:=：]\s*["']?(querying|pending|processing)/i.test(normalized) };
}

function parseJsonObject(output: string): unknown {
    for (let start = output.indexOf("{"); start >= 0; start = output.indexOf("{", start + 1)) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < output.length; index += 1) {
            const character = output[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (character === "\\") escaped = true;
                else if (character === '"') inString = false;
                continue;
            }
            if (character === '"') inString = true;
            else if (character === "{") depth += 1;
            else if (character === "}" && --depth === 0) {
                try { return JSON.parse(output.slice(start, index + 1)) as unknown; } catch { break; }
            }
        }
    }
    return null;
}

function findObjectValue(input: unknown, keys: string[]): unknown {
    if (!input || typeof input !== "object") return undefined;
    for (const [key, value] of Object.entries(input)) {
        if (keys.includes(key.toLowerCase())) return value;
        const nested = findObjectValue(value, keys);
        if (nested !== undefined) return nested;
    }
    return undefined;
}

function assertSubmitId(value: string) {
    if (!/^[a-z0-9-]{8,80}$/i.test(value)) throw new DreaminaError("即梦任务编号无效", 400, "DREAMINA_TASK_ID_INVALID");
}

function firstUsefulLine(output: string) {
    return output.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 500);
}

function normalizeCreditRefreshDate(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const text = String(value).trim();
    if (!text) return undefined;
    const numericValue = Number(text);
    const timestamp = Number.isFinite(numericValue) ? (numericValue < 1e12 ? numericValue * 1000 : numericValue) : Date.parse(text);
    const date = new Date(timestamp);
    return Number.isFinite(timestamp) && !Number.isNaN(date.getTime()) ? date.toISOString() : text;
}

function sanitizeCliOutput(value: string) {
    return value.replace(/\u001b\[[0-9;]*m/g, "").replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]").replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]").replace(/\b(device_code|user_code)\s*[:=]\s*[^\s,]+/gi, "$1=[redacted]").replace(/(^|\n)(\s*verification_uri\s*:\s*)\S+/gim, "$1$2[authorization URL redacted]").replace(/https?:\/\/[^\s]+/gi, (url) => /(?:verification_uri|user_code|device_code)=/i.test(url) ? "[authorization URL redacted]" : url).trim().slice(0, 1500);
}
