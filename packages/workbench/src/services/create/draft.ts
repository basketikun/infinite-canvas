import type { CreateMode } from "@workbench/services/create/logs";

export type PendingCreateDraft = {
    type: CreateMode;
    files: File[];
};

let pending: PendingCreateDraft | undefined;

export function stageCreateDraft(draft: PendingCreateDraft) {
    pending = draft;
}

export function takeCreateDraft() {
    const current = pending;
    pending = undefined;
    return current;
}
