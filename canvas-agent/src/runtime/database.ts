import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { GenerationLog, GenerationLogStatus, RuntimeTask, RuntimeTaskEvent, RuntimeTaskStatus } from "./types.js";

export const RUNTIME_DIR = path.join(os.homedir(), ".infinite-canvas");
export const RUNTIME_DATABASE_FILE = path.join(RUNTIME_DIR, "runtime.sqlite");

export class RuntimeDatabase {
    readonly db: DatabaseSync;

    constructor(file = RUNTIME_DATABASE_FILE) {
        mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(file);
        this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
        this.migrate();
    }

    close() { this.db.close(); }

    createTask(kind: string, input: Record<string, unknown>, params: Record<string, unknown>): RuntimeTask {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        this.db.prepare("INSERT INTO tasks (id, kind, status, progress, input_json, params_json, created_at, updated_at) VALUES (?, ?, 'queued', 0, ?, ?, ?, ?)").run(id, kind, JSON.stringify(input), JSON.stringify(params), now, now);
        return this.getTask(id)!;
    }

    updateTask(id: string, patch: { status?: RuntimeTaskStatus; progress?: number; result?: Record<string, unknown> | null; error?: string | null }) {
        const current = this.getTask(id);
        if (!current) throw new Error(`Task not found: ${id}`);
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        this.db.prepare("UPDATE tasks SET status = ?, progress = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?").run(next.status, Math.max(0, Math.min(1, next.progress)), next.result == null ? null : JSON.stringify(next.result), next.error || null, next.updatedAt, id);
        return this.getTask(id)!;
    }

    getTask(id: string): RuntimeTask | null {
        const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return { id: String(row.id), kind: String(row.kind), status: String(row.status) as RuntimeTaskStatus, progress: Number(row.progress), input: parseJson(row.input_json), params: parseJson(row.params_json), result: row.result_json ? parseJson(row.result_json) : null, error: row.error ? String(row.error) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
    }

    addEvent(taskId: string, type: string, payload: Record<string, unknown>) {
        const createdAt = new Date().toISOString();
        const result = this.db.prepare("INSERT INTO task_events (task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)").run(taskId, type, JSON.stringify(payload), createdAt);
        return { id: Number(result.lastInsertRowid), taskId, type, payload, createdAt } satisfies RuntimeTaskEvent;
    }

    listEvents(taskId: string, after = 0) {
        const rows = this.db.prepare("SELECT * FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC").all(taskId, after) as Array<Record<string, unknown>>;
        return rows.map((row) => ({ id: Number(row.id), taskId: String(row.task_id), type: String(row.type), payload: parseJson(row.payload_json), createdAt: String(row.created_at) } satisfies RuntimeTaskEvent));
    }

    createGenerationLog(input: Omit<GenerationLog, "id" | "createdAt" | "updatedAt">) {
        const legacyId = typeof input.params?.legacyLogId === "string" ? input.params.legacyLogId : "";
        if (legacyId) {
            const existing = this.db.prepare("SELECT id FROM generation_logs WHERE project_id = ? AND json_extract(params_json, '$.legacyLogId') = ? LIMIT 1").get(input.projectId, legacyId) as { id?: string } | undefined;
            if (existing?.id) return this.getGenerationLog(existing.id)!;
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(`INSERT INTO generation_logs
            (id, project_id, node_id, segment_id, status, platform, workflow, model, task_mode, prompt,
             references_json, input_counts_json, runtime_task_id, prompt_id, started_at, finished_at,
             duration_ms, outputs_json, error, params_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, input.projectId, input.nodeId || null, input.segmentId || null, input.status, input.platform,
                input.workflow || null, input.model || null, input.taskMode || null, input.prompt || null,
                JSON.stringify(input.references || []), JSON.stringify(input.inputCounts || {}), input.runtimeTaskId || null,
                input.promptId || null, input.startedAt || now, input.finishedAt || null, input.durationMs || 0,
                JSON.stringify(input.outputs || []), input.error || null, JSON.stringify(input.params || {}), now, now);
        this.db.prepare("DELETE FROM generation_logs WHERE project_id = ? AND id NOT IN (SELECT id FROM generation_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 500)").run(input.projectId, input.projectId);
        return this.getGenerationLog(id)!;
    }

    updateGenerationLog(id: string, patch: Partial<Omit<GenerationLog, "id" | "projectId" | "createdAt">>) {
        const current = this.getGenerationLog(id);
        if (!current) throw new Error(`Generation log not found: ${id}`);
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        this.db.prepare(`UPDATE generation_logs SET node_id=?, segment_id=?, status=?, platform=?, workflow=?, model=?, task_mode=?, prompt=?, references_json=?, input_counts_json=?, runtime_task_id=?, prompt_id=?, started_at=?, finished_at=?, duration_ms=?, outputs_json=?, error=?, params_json=?, updated_at=? WHERE id=?`)
            .run(next.nodeId || null, next.segmentId || null, next.status, next.platform, next.workflow || null, next.model || null,
                next.taskMode || null, next.prompt || null, JSON.stringify(next.references || []), JSON.stringify(next.inputCounts || {}),
                next.runtimeTaskId || null, next.promptId || null, next.startedAt, next.finishedAt || null, next.durationMs || 0,
                JSON.stringify(next.outputs || []), next.error || null, JSON.stringify(next.params || {}), next.updatedAt, id);
        return this.getGenerationLog(id)!;
    }

    getGenerationLog(id: string): GenerationLog | null {
        const row = this.db.prepare("SELECT * FROM generation_logs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        return row ? generationLogFromRow(row) : null;
    }

    listGenerationLogs(options: { projectId?: string; nodeId?: string; status?: GenerationLogStatus; limit?: number } = {}) {
        const clauses: string[] = [];
        const values: Array<string | number> = [];
        if (options.projectId) { clauses.push("project_id = ?"); values.push(options.projectId); }
        if (options.nodeId) { clauses.push("node_id = ?"); values.push(options.nodeId); }
        if (options.status) { clauses.push("status = ?"); values.push(options.status); }
        const limit = Math.max(1, Math.min(500, Number(options.limit || 500)));
        const rows = this.db.prepare(`SELECT * FROM generation_logs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...values, limit) as Array<Record<string, unknown>>;
        return rows.map(generationLogFromRow);
    }

    deleteGenerationLogs(options: { id?: string; projectId?: string; nodeId?: string } = {}) {
        const clauses: string[] = [];
        const values: Array<string | number> = [];
        if (options.id) { clauses.push("id = ?"); values.push(options.id); }
        if (options.projectId) { clauses.push("project_id = ?"); values.push(options.projectId); }
        if (options.nodeId) { clauses.push("node_id = ?"); values.push(options.nodeId); }
        if (!clauses.length) throw new Error("Generation log delete requires a scope");
        return Number(this.db.prepare(`DELETE FROM generation_logs WHERE ${clauses.join(" AND ")}`).run(...values).changes);
    }

    getSetting(key: string) {
        const row = this.db.prepare("SELECT value_json FROM runtime_settings WHERE key = ?").get(key) as { value_json?: string } | undefined;
        if (!row?.value_json) return undefined;
        try { return JSON.parse(row.value_json) as unknown; } catch { return undefined; }
    }

    setSetting(key: string, value: unknown) {
        this.db.prepare("INSERT INTO runtime_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(key, JSON.stringify(value), new Date().toISOString());
    }

    listCanvasProjects<T extends Record<string, unknown> = Record<string, unknown>>() {
        const rows = this.db.prepare("SELECT data_json FROM canvas_projects ORDER BY updated_at DESC").all() as Array<{ data_json: string }>;
        return rows.flatMap((row) => {
            try { const value = JSON.parse(row.data_json) as T; return value && typeof value === "object" ? [value] : []; } catch { return []; }
        });
    }

    replaceCanvasProjects(projects: Array<Record<string, unknown>>) {
        const now = new Date().toISOString();
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db.prepare("DELETE FROM canvas_projects").run();
            const insert = this.db.prepare("INSERT INTO canvas_projects (id, data_json, updated_at) VALUES (?, ?, ?)");
            for (const project of projects) {
                const id = String(project.id || "").trim();
                if (id) insert.run(id, JSON.stringify(project), String(project.updatedAt || now));
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
        return this.listCanvasProjects();
    }

    private migrate() {
        this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, input_json TEXT NOT NULL, params_json TEXT NOT NULL, result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runtime_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS canvas_projects (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS generation_logs (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, node_id TEXT, segment_id TEXT,
                status TEXT NOT NULL, platform TEXT NOT NULL, workflow TEXT, model TEXT, task_mode TEXT, prompt TEXT,
                references_json TEXT NOT NULL DEFAULT '[]', input_counts_json TEXT NOT NULL DEFAULT '{}',
                runtime_task_id TEXT, prompt_id TEXT, started_at TEXT NOT NULL, finished_at TEXT,
                duration_ms INTEGER NOT NULL DEFAULT 0, outputs_json TEXT NOT NULL DEFAULT '[]', error TEXT,
                params_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS task_events_task_id_id ON task_events(task_id, id);`);
        this.db.exec("CREATE INDEX IF NOT EXISTS generation_logs_project_created ON generation_logs(project_id, created_at DESC);");
        const version = this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number } | undefined;
        if (!version?.version) this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
    }
}

function generationLogFromRow(row: Record<string, unknown>): GenerationLog {
    return {
        id: String(row.id), projectId: String(row.project_id), nodeId: row.node_id ? String(row.node_id) : undefined,
        segmentId: row.segment_id ? String(row.segment_id) : undefined, status: String(row.status) as GenerationLogStatus,
        platform: String(row.platform), workflow: row.workflow ? String(row.workflow) : undefined,
        model: row.model ? String(row.model) : undefined, taskMode: row.task_mode ? String(row.task_mode) : undefined,
        prompt: row.prompt ? String(row.prompt) : undefined, references: parseJsonArray(row.references_json),
        inputCounts: Object.fromEntries(Object.entries(parseJson(row.input_counts_json)).map(([key, value]) => [key, Number(value) || 0])), runtimeTaskId: row.runtime_task_id ? String(row.runtime_task_id) : undefined,
        promptId: row.prompt_id ? String(row.prompt_id) : undefined, startedAt: String(row.started_at),
        finishedAt: row.finished_at ? String(row.finished_at) : undefined, durationMs: Number(row.duration_ms || 0),
        outputs: parseJsonArray(row.outputs_json), error: row.error ? String(row.error) : undefined,
        params: parseJson(row.params_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
}

function parseJsonArray(value: unknown): Array<Record<string, unknown>> {
    try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : []; } catch { return []; }
}

function parseJson(value: unknown): Record<string, unknown> {
    try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
