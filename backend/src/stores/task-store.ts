import type { BackendDatabase } from "../db.js";
import type { TaskStore } from "./types.js";

/** 任务 store：任务生命周期 + 事件流。 */
export function createTaskStore(db: BackendDatabase): TaskStore {
    return {
        create: (kind, input, params) => db.createTask(kind, input, params),
        get: (id) => db.getTask(id),
        update: (id, patch) => {
            const task = db.updateTask(id, patch);
            if (patch.status) db.addTaskEvent(id, `status:${patch.status}`, { taskId: id, status: patch.status });
            return task;
        },
        cancel(id) {
            const task = db.getTask(id);
            if (!task) throw new Error(`Task not found: ${id}`);
            if (task.status !== "queued" && task.status !== "running") throw new Error(`任务状态 ${task.status} 不可取消`);
            const updated = db.updateTask(id, { status: "cancelled" });
            db.addTaskEvent(id, "cancelled", { taskId: id });
            return updated;
        },
        events: (id, after = 0) => db.listTaskEvents(id, after),
        addEvent: (id, type, payload) => db.addTaskEvent(id, type, payload),
    };
}
