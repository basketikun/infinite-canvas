import { storage } from "@workbench/services/storage/runtime";
import { GenerationRecordDeletion } from "@workbench/services/generation-records";
import { notifyCreateSessionsChanged } from "@workbench/lib/create-sessions-events";
import { deleteAgentThread, saveAgentThread, type CreateAgentThread } from "@workbench/services/create/agent-logs";
import { serializeLog, type CreateLog } from "@workbench/services/create/logs";

type SessionKind = "image" | "video" | "audio";

function collection(kind: SessionKind) {
    return kind === "image" ? storage.imageRecords : kind === "video" ? storage.videoRecords : storage.audioRecords;
}

function sessionIdOf(record: CreateLog) {
    return record.sessionId || `record:${record.id}`;
}

async function readRecords(id: string) {
    const records: Array<{ kind: SessionKind; record: CreateLog }> = [];
    for (const kind of ["image", "video", "audio"] as const) {
        await collection(kind).iterate<CreateLog, void>((record) => {
            if (record?.id && sessionIdOf(record) === id) records.push({ kind, record });
        });
    }
    return records;
}

export async function renameCreateSession(id: string, title: string) {
    const next = title.trim();
    if (!next) throw new Error("CREATE_SESSION_TITLE_REQUIRED");
    const thread = await storage.agentRecords.getItem<CreateAgentThread>(id);
    if (thread) await saveAgentThread({ ...thread, title: next });
    for (const { kind, record } of await readRecords(id)) {
        if (record.title === next) continue;
        await collection(kind).setItem(record.id, serializeLog({ ...record, title: next }));
    }
    notifyCreateSessionsChanged();
}

export async function deleteCreateSession(id: string) {
    const records = await readRecords(id);
    for (const kind of ["image", "video", "audio"] as const) {
        const ids = records.filter((item) => item.kind === kind).map((item) => item.record.id);
        if (ids.length) await new GenerationRecordDeletion(kind, ids).remove(new AbortController().signal);
    }
    await deleteAgentThread(id);
    notifyCreateSessionsChanged();
}
