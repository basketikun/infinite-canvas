import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { DB_FILE, MEDIA_DIR, ensureDataDirs } from "./config.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RuntimeTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type GenerationLogStatus = "queued" | "running" | "success" | "failed" | "cancelled";

export type RuntimeTask = {
    id: string; kind: string; status: RuntimeTaskStatus; progress: number;
    input: Record<string, unknown>; params: Record<string, unknown>;
    result: Record<string, unknown> | null; error: string | null;
    createdAt: string; updatedAt: string;
};
export type RuntimeTaskEvent = {
    id: number; taskId: string; type: string;
    payload: Record<string, unknown>; createdAt: string;
};
export type GenerationLog = {
    id: string; projectId: string; nodeId?: string; segmentId?: string;
    status: GenerationLogStatus; platform: string;
    workflow?: string; model?: string; taskMode?: string; prompt?: string;
    references: Array<Record<string, unknown>>; inputCounts: Record<string, number>;
    runtimeTaskId?: string; promptId?: string;
    startedAt: string; finishedAt?: string; durationMs: number;
    outputs: Array<Record<string, unknown>>; error?: string;
    params: Record<string, unknown>; createdAt: string; updatedAt: string;
};
export type MediaFile = {
    storageKey: string; filePath: string; mimeType: string;
    bytes: number; width: number | null; height: number | null; durationMs: number | null;
    createdAt: string;
};
export type AssetFolder = { id: string; name: string; parentId: string | null; createdAt: string };
export type Asset = {
    id: string; kind: string; title: string; coverUrl: string; tags: string[];
    folderId: string | null; data: Record<string, unknown>; note: string | null;
    source: string | null; metadata: Record<string, unknown>;
    createdAt: string; updatedAt: string;
};
export type CanvasProject = Record<string, unknown> & { id: string };

// ── Database ──────────────────────────────────────────────────────────────────

export class BackendDatabase {
    readonly db: DatabaseSync;

    constructor(file: string = DB_FILE) {
        ensureDataDirs();
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(file);
        this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
        this.migrate();
    }

    close() { this.db.close(); }

    // ── schema_migrations ─────────────────────────────────────────────────

    private migrate() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS canvas_projects (
                id TEXT PRIMARY KEY,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                cover_url TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                folder_id TEXT REFERENCES asset_folders(id) ON DELETE SET NULL,
                data_json TEXT NOT NULL DEFAULT '{}',
                note TEXT,
                source TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS assets_kind ON assets(kind);
            CREATE INDEX IF NOT EXISTS assets_folder ON assets(folder_id);
            CREATE TABLE IF NOT EXISTS asset_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES asset_folders(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS media_files (
                storage_key TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                width INTEGER,
                height INTEGER,
                duration_ms INTEGER,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS generation_logs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                node_id TEXT,
                segment_id TEXT,
                status TEXT NOT NULL,
                platform TEXT NOT NULL,
                workflow TEXT,
                model TEXT,
                task_mode TEXT,
                prompt TEXT,
                references_json TEXT NOT NULL DEFAULT '[]',
                input_counts_json TEXT NOT NULL DEFAULT '{}',
                runtime_task_id TEXT,
                prompt_id TEXT,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                outputs_json TEXT NOT NULL DEFAULT '[]',
                error TEXT,
                params_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS generation_logs_project_created ON generation_logs(project_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                progress REAL NOT NULL DEFAULT 0,
                input_json TEXT NOT NULL,
                params_json TEXT NOT NULL,
                result_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS task_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS task_events_task_id_id ON task_events(task_id, id);
            CREATE TABLE IF NOT EXISTS runtime_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `);
        const version = this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number } | undefined;
        if (!version?.version) {
            this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
        }
    }

    // ── canvas_projects ───────────────────────────────────────────────────

    listCanvasProjects(): CanvasProject[] {
        const rows = this.db.prepare("SELECT data_json FROM canvas_projects ORDER BY updated_at DESC").all() as Array<{ data_json: string }>;
        return rows.flatMap((row) => {
            try {
                const value = JSON.parse(row.data_json) as CanvasProject;
                return value && typeof value === "object" && value.id ? [value] : [];
            } catch { return []; }
        });
    }

    upsertCanvasProject(project: CanvasProject) {
        const now = new Date().toISOString();
        const updatedAt = String(project.updatedAt || now);
        this.db.prepare(
            "INSERT INTO canvas_projects (id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at"
        ).run(project.id, JSON.stringify(project), updatedAt);
        return this.getCanvasProject(project.id)!;
    }

    replaceCanvasProjects(projects: CanvasProject[]): CanvasProject[] {
        const now = new Date().toISOString();
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db.prepare("DELETE FROM canvas_projects").run();
            const insert = this.db.prepare("INSERT INTO canvas_projects (id, data_json, updated_at) VALUES (?, ?, ?)");
            for (const project of projects) {
                if (project.id) insert.run(project.id, JSON.stringify(project), String(project.updatedAt || now));
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
        return this.listCanvasProjects();
    }

    deleteCanvasProject(id: string): number {
        return Number(this.db.prepare("DELETE FROM canvas_projects WHERE id = ?").run(id).changes);
    }

    getCanvasProject(id: string): CanvasProject | null {
        const row = this.db.prepare("SELECT data_json FROM canvas_projects WHERE id = ?").get(id) as { data_json?: string } | undefined;
        if (!row?.data_json) return null;
        try { return JSON.parse(row.data_json) as CanvasProject; } catch { return null; }
    }

    // ── assets ────────────────────────────────────────────────────────────

    listAssets(options: { kind?: string; folderId?: string } = {}): Asset[] {
        const clauses: string[] = [];
        const values: Array<string | null> = [];
        if (options.kind) { clauses.push("kind = ?"); values.push(options.kind); }
        if (options.folderId) { clauses.push("folder_id = ?"); values.push(options.folderId); }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const rows = this.db.prepare(`SELECT * FROM assets ${where} ORDER BY updated_at DESC`).all(...values) as Array<Record<string, unknown>>;
        return rows.map(assetFromRow);
    }

    getAsset(id: string): Asset | null {
        const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        return row ? assetFromRow(row) : null;
    }

    upsertAsset(asset: Asset) {
        const now = new Date().toISOString();
        const updatedAt = asset.updatedAt || now;
        this.db.prepare(`
            INSERT INTO assets (id, kind, title, cover_url, tags_json, folder_id, data_json, note, source, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind, title = excluded.title, cover_url = excluded.cover_url,
                tags_json = excluded.tags_json, folder_id = excluded.folder_id,
                data_json = excluded.data_json, note = excluded.note, source = excluded.source,
                metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
        `).run(
            asset.id, asset.kind, asset.title,
            asset.coverUrl ?? "", JSON.stringify(asset.tags ?? []),
            asset.folderId ?? null, JSON.stringify(asset.data ?? {}),
            asset.note ?? null, asset.source ?? null,
            JSON.stringify(asset.metadata ?? {}),
            asset.createdAt ?? now, updatedAt,
        );
        return this.getAsset(asset.id)!;
    }

    replaceAssets(assets: Asset[], folders: AssetFolder[]) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db.prepare("DELETE FROM assets").run();
            this.db.prepare("DELETE FROM asset_folders").run();
            const insertFolder = this.db.prepare("INSERT INTO asset_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)");
            for (const folder of folders) insertFolder.run(folder.id, folder.name, folder.parentId, folder.createdAt);
            const insertAsset = this.db.prepare(`
                INSERT INTO assets (id, kind, title, cover_url, tags_json, folder_id, data_json, note, source, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const asset of assets) {
                insertAsset.run(
                    asset.id, asset.kind, asset.title, asset.coverUrl, JSON.stringify(asset.tags),
                    asset.folderId, JSON.stringify(asset.data), asset.note, asset.source,
                    JSON.stringify(asset.metadata), asset.createdAt, asset.updatedAt,
                );
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    deleteAsset(id: string): number {
        return Number(this.db.prepare("DELETE FROM assets WHERE id = ?").run(id).changes);
    }

    // ── asset_folders ─────────────────────────────────────────────────────

    listAssetFolders(): AssetFolder[] {
        const rows = this.db.prepare("SELECT * FROM asset_folders ORDER BY created_at ASC").all() as Array<Record<string, unknown>>;
        return rows.map((row) => ({
            id: String(row.id), name: String(row.name),
            parentId: row.parent_id ? String(row.parent_id) : null,
            createdAt: String(row.created_at),
        }));
    }

    upsertAssetFolder(folder: AssetFolder) {
        this.db.prepare(
            "INSERT INTO asset_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id"
        ).run(folder.id, folder.name, folder.parentId, folder.createdAt);
    }

    deleteAssetFolder(id: string): number {
        return Number(this.db.prepare("DELETE FROM asset_folders WHERE id = ?").run(id).changes);
    }

    // ── media_files ───────────────────────────────────────────────────────

    upsertMediaFile(media: MediaFile) {
        this.db.prepare(`
            INSERT INTO media_files (storage_key, file_path, mime_type, file_size, width, height, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(storage_key) DO UPDATE SET
                file_path = excluded.file_path, mime_type = excluded.mime_type,
                file_size = excluded.file_size, width = excluded.width,
                height = excluded.height, duration_ms = excluded.duration_ms
        `).run(
            media.storageKey, media.filePath, media.mimeType, media.bytes,
            media.width, media.height, media.durationMs, media.createdAt,
        );
    }

    getMediaFile(storageKey: string): MediaFile | null {
        const row = this.db.prepare("SELECT * FROM media_files WHERE storage_key = ?").get(storageKey) as Record<string, unknown> | undefined;
        return row ? mediaFromRow(row) : null;
    }

    listMediaFiles(): MediaFile[] {
        const rows = this.db.prepare("SELECT * FROM media_files ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
        return rows.map(mediaFromRow);
    }

    deleteMediaFile(storageKey: string): number {
        return Number(this.db.prepare("DELETE FROM media_files WHERE storage_key = ?").run(storageKey).changes);
    }

    // ── generation_logs ───────────────────────────────────────────────────

    createGenerationLog(input: Omit<GenerationLog, "id" | "createdAt" | "updatedAt">): GenerationLog {
        const legacyId = typeof input.params?.legacyLogId === "string" ? input.params.legacyLogId : "";
        if (legacyId) {
            const existing = this.db.prepare(
                "SELECT id FROM generation_logs WHERE project_id = ? AND json_extract(params_json, '$.legacyLogId') = ? LIMIT 1"
            ).get(input.projectId, legacyId) as { id?: string } | undefined;
            if (existing?.id) return this.getGenerationLog(existing.id)!;
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO generation_logs
                (id, project_id, node_id, segment_id, status, platform, workflow, model, task_mode, prompt,
                 references_json, input_counts_json, runtime_task_id, prompt_id, started_at, finished_at,
                 duration_ms, outputs_json, error, params_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, input.projectId, input.nodeId || null, input.segmentId || null, input.status, input.platform,
            input.workflow || null, input.model || null, input.taskMode || null, input.prompt || null,
            JSON.stringify(input.references || []), JSON.stringify(input.inputCounts || {}),
            input.runtimeTaskId || null, input.promptId || null,
            input.startedAt || now, input.finishedAt || null, input.durationMs || 0,
            JSON.stringify(input.outputs || []), input.error || null,
            JSON.stringify(input.params || {}), now, now,
        );
        // 每项目保留最近 500 条
        this.db.prepare(
            "DELETE FROM generation_logs WHERE project_id = ? AND id NOT IN (SELECT id FROM generation_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 500)"
        ).run(input.projectId, input.projectId);
        return this.getGenerationLog(id)!;
    }

    updateGenerationLog(id: string, patch: Partial<Omit<GenerationLog, "id" | "projectId" | "createdAt">>): GenerationLog {
        const current = this.getGenerationLog(id);
        if (!current) throw new Error(`Generation log not found: ${id}`);
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        this.db.prepare(`
            UPDATE generation_logs SET
                node_id=?, segment_id=?, status=?, platform=?, workflow=?, model=?, task_mode=?, prompt=?,
                references_json=?, input_counts_json=?, runtime_task_id=?, prompt_id=?,
                started_at=?, finished_at=?, duration_ms=?, outputs_json=?, error=?, params_json=?, updated_at=?
            WHERE id=?
        `).run(
            next.nodeId || null, next.segmentId || null, next.status, next.platform,
            next.workflow || null, next.model || null, next.taskMode || null, next.prompt || null,
            JSON.stringify(next.references || []), JSON.stringify(next.inputCounts || {}),
            next.runtimeTaskId || null, next.promptId || null,
            next.startedAt, next.finishedAt || null, next.durationMs || 0,
            JSON.stringify(next.outputs || []), next.error || null,
            JSON.stringify(next.params || {}), next.updatedAt, id,
        );
        return this.getGenerationLog(id)!;
    }

    getGenerationLog(id: string): GenerationLog | null {
        const row = this.db.prepare("SELECT * FROM generation_logs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        return row ? generationLogFromRow(row) : null;
    }

    listGenerationLogs(options: { projectId?: string; nodeId?: string; status?: GenerationLogStatus; limit?: number } = {}): GenerationLog[] {
        const clauses: string[] = [];
        const values: Array<string | number> = [];
        if (options.projectId) { clauses.push("project_id = ?"); values.push(options.projectId); }
        if (options.nodeId) { clauses.push("node_id = ?"); values.push(options.nodeId); }
        if (options.status) { clauses.push("status = ?"); values.push(options.status); }
        const limit = Math.max(1, Math.min(500, Number(options.limit || 500)));
        const rows = this.db.prepare(
            `SELECT * FROM generation_logs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`
        ).all(...values, limit) as Array<Record<string, unknown>>;
        return rows.map(generationLogFromRow);
    }

    deleteGenerationLogs(options: { id?: string; projectId?: string; nodeId?: string }): number {
        const clauses: string[] = [];
        const values: Array<string> = [];
        if (options.id) { clauses.push("id = ?"); values.push(options.id); }
        if (options.projectId) { clauses.push("project_id = ?"); values.push(options.projectId); }
        if (options.nodeId) { clauses.push("node_id = ?"); values.push(options.nodeId); }
        if (!clauses.length) throw new Error("Generation log delete requires a scope");
        return Number(this.db.prepare(`DELETE FROM generation_logs WHERE ${clauses.join(" AND ")}`).run(...values).changes);
    }

    // ── tasks ─────────────────────────────────────────────────────────────

    createTask(kind: string, input: Record<string, unknown>, params: Record<string, unknown>): RuntimeTask {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(
            "INSERT INTO tasks (id, kind, status, progress, input_json, params_json, created_at, updated_at) VALUES (?, ?, 'queued', 0, ?, ?, ?, ?)"
        ).run(id, kind, JSON.stringify(input), JSON.stringify(params), now, now);
        return this.getTask(id)!;
    }

    updateTask(id: string, patch: { status?: RuntimeTaskStatus; progress?: number; result?: Record<string, unknown> | null; error?: string | null }): RuntimeTask {
        const current = this.getTask(id);
        if (!current) throw new Error(`Task not found: ${id}`);
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        this.db.prepare(
            "UPDATE tasks SET status = ?, progress = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?"
        ).run(
            next.status,
            Math.max(0, Math.min(1, next.progress)),
            next.result == null ? null : JSON.stringify(next.result),
            next.error || null,
            next.updatedAt,
            id,
        );
        return this.getTask(id)!;
    }

    getTask(id: string): RuntimeTask | null {
        const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
            id: String(row.id), kind: String(row.kind),
            status: String(row.status) as RuntimeTaskStatus,
            progress: Number(row.progress),
            input: parseJsonObject(row.input_json),
            params: parseJsonObject(row.params_json),
            result: row.result_json ? parseJsonObject(row.result_json) : null,
            error: row.error ? String(row.error) : null,
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
        };
    }

    addTaskEvent(taskId: string, type: string, payload: Record<string, unknown>): RuntimeTaskEvent {
        const createdAt = new Date().toISOString();
        const result = this.db.prepare(
            "INSERT INTO task_events (task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)"
        ).run(taskId, type, JSON.stringify(payload), createdAt) as { lastInsertRowid: number };
        return { id: Number(result.lastInsertRowid), taskId, type, payload, createdAt };
    }

    listTaskEvents(taskId: string, after = 0): RuntimeTaskEvent[] {
        const rows = this.db.prepare(
            "SELECT * FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC"
        ).all(taskId, after) as Array<Record<string, unknown>>;
        return rows.map((row) => ({
            id: Number(row.id), taskId: String(row.task_id), type: String(row.type),
            payload: parseJsonObject(row.payload_json), createdAt: String(row.created_at),
        }));
    }

    // ── runtime_settings ──────────────────────────────────────────────────

    getSetting(key: string): unknown {
        const row = this.db.prepare("SELECT value_json FROM runtime_settings WHERE key = ?").get(key) as { value_json?: string } | undefined;
        if (!row?.value_json) return undefined;
        try { return JSON.parse(row.value_json); } catch { return undefined; }
    }

    setSetting(key: string, value: unknown) {
        this.db.prepare(
            "INSERT INTO runtime_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
        ).run(key, JSON.stringify(value), new Date().toISOString());
    }
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function assetFromRow(row: Record<string, unknown>): Asset {
    return {
        id: String(row.id),
        kind: String(row.kind),
        title: String(row.title),
        coverUrl: String(row.cover_url || ""),
        tags: parseJsonArray(row.tags_json) as string[],
        folderId: row.folder_id ? String(row.folder_id) : null,
        data: parseJsonObject(row.data_json),
        note: row.note ? String(row.note) : null,
        source: row.source ? String(row.source) : null,
        metadata: parseJsonObject(row.metadata_json),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

function mediaFromRow(row: Record<string, unknown>): MediaFile {
    return {
        storageKey: String(row.storage_key),
        filePath: String(row.file_path),
        mimeType: String(row.mime_type),
        bytes: Number(row.file_size),
        width: row.width != null ? Number(row.width) : null,
        height: row.height != null ? Number(row.height) : null,
        durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
        createdAt: String(row.created_at),
    };
}

function generationLogFromRow(row: Record<string, unknown>): GenerationLog {
    return {
        id: String(row.id),
        projectId: String(row.project_id),
        nodeId: row.node_id ? String(row.node_id) : undefined,
        segmentId: row.segment_id ? String(row.segment_id) : undefined,
        status: String(row.status) as GenerationLogStatus,
        platform: String(row.platform),
        workflow: row.workflow ? String(row.workflow) : undefined,
        model: row.model ? String(row.model) : undefined,
        taskMode: row.task_mode ? String(row.task_mode) : undefined,
        prompt: row.prompt ? String(row.prompt) : undefined,
        references: parseJsonArray(row.references_json) as Array<Record<string, unknown>>,
        inputCounts: Object.fromEntries(Object.entries(parseJsonObject(row.input_counts_json)).map(([key, value]) => [key, Number(value) || 0])),
        runtimeTaskId: row.runtime_task_id ? String(row.runtime_task_id) : undefined,
        promptId: row.prompt_id ? String(row.prompt_id) : undefined,
        startedAt: String(row.started_at),
        finishedAt: row.finished_at ? String(row.finished_at) : undefined,
        durationMs: Number(row.duration_ms || 0),
        outputs: parseJsonArray(row.outputs_json) as Array<Record<string, unknown>>,
        error: row.error ? String(row.error) : undefined,
        params: parseJsonObject(row.params_json),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
    try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
}

function parseJsonArray(value: unknown): unknown[] {
    try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}
