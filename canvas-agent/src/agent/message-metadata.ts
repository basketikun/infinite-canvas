import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG_DIR } from "../config.js";
import type { AgentAttachmentDisplay, AgentCanvasReference, AgentMessageMetadata, AgentSkillReference } from "./types.js";

type MessageMetadataRecord = { version: 1; clientMessageId: string; threadId?: string; turnId?: string; createdAt: number; metadata: AgentMessageMetadata };
type MetadataMessage = { role: string; threadId: string; turnId: string; clientMessageId?: string };

const STORAGE_VERSION = 1;
const MAX_PREVIEW_LENGTH = 500_000;
const MAX_TEXT_LENGTH = 20_000;
const MANIFEST_FILE = "manifest.json";
const MESSAGE_ASSET_PREFIX = "agent-asset:";

const MESSAGE_METADATA_DIRECTORY = path.join(CONFIG_DIR, "message-metadata");

export class MessageMetadataStore {
    private queue: Promise<void> = Promise.resolve();
    private ready?: Promise<void>;

    constructor(private directory = MESSAGE_METADATA_DIRECTORY) {}

    recordPending(clientMessageId: string, value: unknown) {
        return this.run(async () => {
            const metadata = normalizeMetadata(value, false);
            if (!clientMessageId || !metadata) return undefined;
            await this.ensureReady();
            const storedMetadata = await persistMetadataPreviews(this.directory, clientMessageId, metadata);
            const record: MessageMetadataRecord = { version: STORAGE_VERSION, clientMessageId, createdAt: Date.now(), metadata: storedMetadata };
            await writeJson(this.pendingFile(clientMessageId), record);
            return structuredClone(storedMetadata);
        });
    }

    bindThread(clientMessageId: string, threadId: string) {
        return this.run(async () => {
            if (!clientMessageId || !threadId) return;
            await this.ensureReady();
            const pendingFile = this.pendingFile(clientMessageId);
            const targetFile = this.threadFile(threadId, clientMessageId);
            const record = await readRecord(targetFile) || await readRecord(pendingFile);
            if (!record) return;
            await writeJson(targetFile, { ...record, threadId, turnId: record.threadId === threadId ? record.turnId : undefined });
            await removeFile(pendingFile);
        });
    }

    bindTurn(clientMessageId: string, threadId: string, turnId: string) {
        return this.run(async () => {
            if (!clientMessageId || !threadId || !turnId) return;
            await this.ensureReady();
            const pendingFile = this.pendingFile(clientMessageId);
            const targetFile = this.threadFile(threadId, clientMessageId);
            const record = await readRecord(targetFile) || await readRecord(pendingFile);
            if (!record) return;
            await writeJson(targetFile, { ...record, threadId, turnId });
            await removeFile(pendingFile);
        });
    }

    mergeThread<T extends MetadataMessage>(threadId: string, messages: T[]) {
        return this.run<Array<T & AgentMessageMetadata>>(async () => {
            await this.ensureReady();
            const records = (await readRecords(this.threadDirectory(threadId))).filter((item) => item.threadId === threadId && item.turnId);
            const byTurnId = new Map(records.map((item) => [item.turnId!, item]));
            return messages.map((message) => {
                if (message.role !== "user" || message.threadId !== threadId) return message;
                const record = byTurnId.get(message.turnId);
                return record ? { ...message, clientMessageId: record.clientMessageId, ...structuredClone(record.metadata) } : message;
            });
        });
    }

    remove(clientMessageId: string, threadId = "") {
        return this.run(async () => {
            if (!clientMessageId) return;
            await this.ensureReady();
            await Promise.all([
                removeFile(this.pendingFile(clientMessageId)),
                ...(threadId ? [removeFile(this.threadFile(threadId, clientMessageId))] : []),
                fs.rm(this.assetDirectory(clientMessageId), { recursive: true, force: true }),
            ]);
        });
    }

    removeThread(threadId: string) {
        return this.run(async () => {
            if (!threadId) return;
            await this.ensureReady();
            const records = await readRecords(this.threadDirectory(threadId));
            await Promise.all([
                fs.rm(this.threadDirectory(threadId), { recursive: true, force: true }),
                ...records.map((record) => fs.rm(this.assetDirectory(record.clientMessageId), { recursive: true, force: true })),
            ]);
        });
    }

    readAsset(messageKey: string, assetFile: string) {
        return this.run(async () => {
            await this.ensureReady();
            if (!/^[a-f0-9]{64}$/.test(messageKey) || !/^[a-f0-9]{64}\.(?:gif|jpe?g|png|webp)$/.test(assetFile)) return undefined;
            try {
                return { data: await fs.readFile(path.join(this.directory, "assets", messageKey, assetFile)), contentType: assetContentType(assetFile) };
            } catch (error) {
                if (isMissing(error)) return undefined;
                throw error;
            }
        });
    }

    private run<T>(task: () => Promise<T>) {
        const result = this.queue.then(task, task);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    private ensureReady() {
        this.ready ||= this.initialize();
        return this.ready;
    }

    private async initialize() {
        const manifestFile = path.join(this.directory, MANIFEST_FILE);
        try {
            const manifest = await readJson(manifestFile) as { version?: unknown };
            if (manifest.version !== STORAGE_VERSION) throw unsupportedVersion(manifest.version);
            return;
        } catch (error) {
            if (!isMissing(error)) throw error;
        }

        if (await exists(this.directory)) throw new Error(`Message metadata store is missing ${MANIFEST_FILE}; refusing to overwrite it.`);
        await createStorage(this.directory);
    }

    private pendingFile(clientMessageId: string) {
        return path.join(this.directory, "pending", `${storageKey(clientMessageId)}.json`);
    }

    private threadDirectory(threadId: string) {
        return path.join(this.directory, "threads", storageKey(threadId));
    }

    private threadFile(threadId: string, clientMessageId: string) {
        return path.join(this.threadDirectory(threadId), `${storageKey(clientMessageId)}.json`);
    }

    private assetDirectory(clientMessageId: string) {
        return path.join(this.directory, "assets", storageKey(clientMessageId));
    }
}

export const messageMetadataStore = new MessageMetadataStore();

async function createStorage(directory: string) {
    const temporaryDirectory = `${directory}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.mkdir(path.join(temporaryDirectory, "pending"), { recursive: true });
        await fs.mkdir(path.join(temporaryDirectory, "threads"), { recursive: true });
        await fs.mkdir(path.join(temporaryDirectory, "assets"), { recursive: true });
        await writeJson(path.join(temporaryDirectory, MANIFEST_FILE), { version: STORAGE_VERSION });
        await fs.rename(temporaryDirectory, directory);
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

async function readRecords(directory: string) {
    let files: string[];
    try {
        files = (await fs.readdir(directory, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".json")).map((item) => path.join(directory, item.name));
    } catch (error) {
        if (isMissing(error)) return [];
        throw error;
    }
    return (await Promise.all(files.map(readRecord))).filter((item): item is MessageMetadataRecord => Boolean(item));
}

async function readRecord(file: string): Promise<MessageMetadataRecord | undefined> {
    try {
        const value = await readJson(file) as Partial<MessageMetadataRecord>;
        if (value.version !== STORAGE_VERSION) throw unsupportedVersion(value.version);
        const clientMessageId = text(value.clientMessageId, 200);
        const metadata = normalizeMetadata(value.metadata, true);
        if (!clientMessageId || !metadata) throw new Error(`Message metadata record is invalid: ${file}`);
        const threadId = text(value.threadId, 200);
        const turnId = text(value.turnId, 200);
        return { version: STORAGE_VERSION, clientMessageId, createdAt: Number(value.createdAt) || 0, metadata, ...(threadId ? { threadId } : {}), ...(turnId ? { turnId } : {}) };
    } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
    }
}

function normalizeMetadata(value: unknown, allowAsset: boolean): AgentMessageMetadata | undefined {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Message metadata must be an object.");
    const source = value as Record<string, unknown>;
    const attachments = normalizeList(source.attachments, 6, (item) => normalizeAttachment(item, allowAsset), "attachments");
    const canvasReferences = normalizeList(source.canvasReferences, 50, (item) => normalizeCanvasReference(item, allowAsset), "canvas references");
    const skill = normalizeSkill(source.skill);
    if (source.skill !== undefined && !skill) throw new Error("Message skill metadata is invalid.");
    if (!attachments.length && !canvasReferences.length && !skill) return undefined;
    return { ...(attachments.length ? { attachments } : {}), ...(canvasReferences.length ? { canvasReferences } : {}), ...(skill ? { skill } : {}) };
}

function normalizeList<T>(value: unknown, limit: number, normalize: (item: unknown) => T | undefined, label: string) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`Message ${label} metadata must be an array.`);
    if (value.length > limit) throw new Error(`Message ${label} metadata exceeds the limit of ${limit}.`);
    const normalized = value.map(normalize).filter((item): item is T => Boolean(item));
    if (normalized.length !== value.length) throw new Error(`Message ${label} metadata is invalid.`);
    return normalized;
}

function normalizeAttachment(value: unknown, allowAsset: boolean): AgentAttachmentDisplay | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const id = text(item.id, 200);
    const name = text(item.name, 500);
    const url = imagePreview(item.url, allowAsset);
    if (!id || !name || !url) return undefined;
    return { id, name, url, ...numberFields(item) };
}

function normalizeCanvasReference(value: unknown, allowAsset: boolean): AgentCanvasReference | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const nodeId = text(item.nodeId, 200);
    const label = text(item.label, 200);
    const title = text(item.title, 500);
    const kind = String(item.kind || "");
    if (!nodeId || !label || !title || !["image", "video", "audio", "text"].includes(kind)) return undefined;
    const previewUrl = kind === "image" ? imagePreview(item.previewUrl, allowAsset) : remotePreview(item.previewUrl);
    const referenceText = text(item.text, MAX_TEXT_LENGTH);
    return { nodeId, label, title, kind: kind as AgentCanvasReference["kind"], ...(previewUrl ? { previewUrl } : {}), ...(referenceText ? { text: referenceText } : {}) };
}

function normalizeSkill(value: unknown): AgentSkillReference | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const name = text(item.name, 200);
    const skillPath = text(item.path, 2000);
    const displayName = text(item.displayName, 200);
    return name && skillPath ? { name, path: skillPath, ...(displayName ? { displayName } : {}) } : undefined;
}

function numberFields(item: Record<string, unknown>) {
    const fields: Partial<Pick<AgentAttachmentDisplay, "type" | "size" | "width" | "height">> = {};
    const type = text(item.type, 200);
    if (type) fields.type = type;
    for (const key of ["size", "width", "height"] as const) {
        const value = Number(item[key]);
        if (Number.isFinite(value) && value >= 0) fields[key] = value;
    }
    return fields;
}

function imagePreview(value: unknown, allowAsset = false) {
    if (typeof value !== "string") return "";
    const url = value.trim();
    if (allowAsset && new RegExp(`^${MESSAGE_ASSET_PREFIX}[a-f0-9]{64}/[a-f0-9]{64}\\.(?:gif|jpe?g|png|webp)$`).test(url)) return url;
    if (/^https?:\/\//i.test(url)) return url.length <= 5000 ? url : "";
    return url.length <= MAX_PREVIEW_LENGTH && /^data:image\/[a-z0-9.+-]+;base64,/i.test(url) ? url : "";
}

function remotePreview(value: unknown) {
    if (typeof value !== "string") return "";
    const url = value.trim();
    return url.length <= 5000 && /^https?:\/\//i.test(url) ? url : "";
}

function text(value: unknown, limit: number) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function storageKey(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

async function persistMetadataPreviews(directory: string, clientMessageId: string, metadata: AgentMessageMetadata) {
    const attachments = await Promise.all((metadata.attachments || []).map(async (item) => ({ ...item, url: await persistImagePreview(directory, clientMessageId, `attachment:${item.id}`, item.url) })));
    const canvasReferences = await Promise.all((metadata.canvasReferences || []).map(async (item) => ({
        ...item,
        ...(item.kind === "image" && item.previewUrl ? { previewUrl: await persistImagePreview(directory, clientMessageId, `reference:${item.nodeId}`, item.previewUrl) } : {}),
    })));
    return {
        ...(attachments.length ? { attachments } : {}),
        ...(canvasReferences.length ? { canvasReferences } : {}),
        ...(metadata.skill ? { skill: metadata.skill } : {}),
    };
}

async function persistImagePreview(directory: string, clientMessageId: string, key: string, value: string) {
    const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return value;
    const extension = imageExtension(match[1]);
    if (!extension) throw new Error(`Unsupported message preview type: ${match[1]}`);
    const messageKey = storageKey(clientMessageId);
    const assetFile = `${storageKey(key)}.${extension}`;
    await writeFile(path.join(directory, "assets", messageKey, assetFile), Buffer.from(match[2], "base64"));
    return `${MESSAGE_ASSET_PREFIX}${messageKey}/${assetFile}`;
}

function imageExtension(contentType: string) {
    const type = contentType.toLowerCase();
    if (type === "image/jpeg" || type === "image/jpg") return "jpg";
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    if (type === "image/gif") return "gif";
    return "";
}

function assetContentType(file: string) {
    const extension = path.extname(file).slice(1).toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    return `image/${extension}`;
}

async function readJson(file: string) {
    try {
        return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Message metadata JSON is invalid: ${file}`);
        throw error;
    }
}

async function writeJson(file: string, value: unknown) {
    await writeFile(file, JSON.stringify(value));
}

async function writeFile(file: string, value: string | Buffer) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporaryFile, value);
        await fs.rename(temporaryFile, file);
    } finally {
        await removeFile(temporaryFile);
    }
}

async function removeFile(file: string) {
    await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
    });
}

async function exists(file: string) {
    try {
        await fs.access(file);
        return true;
    } catch (error) {
        if (isMissing(error)) return false;
        throw error;
    }
}

function unsupportedVersion(version: unknown) {
    return new Error(`Unsupported message metadata version: ${String(version ?? "missing")}. Refusing to overwrite existing data.`);
}

function isMissing(error: unknown) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
