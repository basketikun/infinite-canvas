import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { RuntimeTask, RuntimeTaskEvent, RuntimeTaskStatus } from "./types.js";

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

    getSetting(key: string) {
        const row = this.db.prepare("SELECT value_json FROM runtime_settings WHERE key = ?").get(key) as { value_json?: string } | undefined;
        if (!row?.value_json) return undefined;
        try { return JSON.parse(row.value_json) as unknown; } catch { return undefined; }
    }

    setSetting(key: string, value: unknown) {
        this.db.prepare("INSERT INTO runtime_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(key, JSON.stringify(value), new Date().toISOString());
    }

    private migrate() {
        this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, input_json TEXT NOT NULL, params_json TEXT NOT NULL, result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runtime_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS task_events_task_id_id ON task_events(task_id, id);`);
        const version = this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number } | undefined;
        if (!version?.version) this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
    }
}

function parseJson(value: unknown): Record<string, unknown> {
    try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
