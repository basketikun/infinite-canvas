import localforage from "localforage";
import i18n from "@/i18n";
import type { WebdavSyncConfig } from "@/stores/use-config-store";

export type AppSyncTrashDomainKey = "canvas" | "assets" | "image-workbench" | "video-workbench";

export type AppSyncTrashEntry<T> = {
    id: string;
    deletedAt: string;
    item: T;
};

export type AppSyncBaseline = {
    liveIds: string[];
    trashIds: string[];
    updatedAt: string;
};

const trashStore = localforage.createInstance({ name: "infinite-canvas", storeName: "app_sync_trash" });
const baselineStore = localforage.createInstance({ name: "infinite-canvas", storeName: "app_sync_baseline" });
const pendingTrashWrites = new Map<string, { targetFingerprint: string; domain: AppSyncTrashDomainKey; entry: AppSyncTrashEntry<unknown>; promise: Promise<void> | null }>();
const mutationQueues = new Map<string, Promise<unknown>>();

export function hasAppSyncTarget(config: WebdavSyncConfig) {
    return Boolean(config.url.trim());
}

export function getAppSyncTargetFingerprint(config: WebdavSyncConfig) {
    if (!hasAppSyncTarget(config)) return null;
    return JSON.stringify([config.url.trim().replace(/\/+$/, ""), config.directory.trim().replace(/^\/+|\/+$/g, ""), config.username.trim()]);
}

export async function appendAppSyncTrashEntry<T extends { id: string }>(targetFingerprint: string, domain: AppSyncTrashDomainKey, item: T, deletedAt = new Date().toISOString()) {
    const entry = { id: item.id, deletedAt, item } satisfies AppSyncTrashEntry<T>;
    const pending = { targetFingerprint, domain, entry, promise: null as Promise<void> | null };
    pendingTrashWrites.set(trashKey(targetFingerprint, domain, item.id), pending);
    await queuePendingTrashWrite(trashKey(targetFingerprint, domain, item.id), pending);
}

export async function listLocalAppSyncTrash<T>(targetFingerprint: string, domain: AppSyncTrashDomainKey) {
    await waitForTrashMutations(targetFingerprint, domain);
    await settlePendingTrashWrites(targetFingerprint, domain);
    const entries: AppSyncTrashEntry<T>[] = [];
    await trashStore.iterate<AppSyncTrashEntry<T>, void>((value: AppSyncTrashEntry<T>, key: string) => {
        if (key.startsWith(`${trashPrefix(targetFingerprint, domain)}`) && value?.id) entries.push(value);
    });
    return mergePendingTrashEntries(targetFingerprint, domain, entries).sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
}

export async function listAllLocalAppSyncTrash() {
    await waitForAllTrashMutations();
    await settlePendingTrashWrites();
    const entries: Array<{ key: string; entry: AppSyncTrashEntry<unknown> }> = [];
    await trashStore.iterate<AppSyncTrashEntry<unknown>, void>((value: AppSyncTrashEntry<unknown>, key: string) => {
        if (value?.id) entries.push({ key, entry: value });
    });
    return mergeAllPendingTrashEntries(entries);
}

export async function replaceLocalAppSyncTrash<T>(targetFingerprint: string, domain: AppSyncTrashDomainKey, entries: AppSyncTrashEntry<T>[], observedEntries: AppSyncTrashEntry<T>[]) {
    await enqueueTrashMutation(targetFingerprint, domain, () => replaceLocalAppSyncTrashNow(targetFingerprint, domain, entries, observedEntries));
}

async function replaceLocalAppSyncTrashNow<T>(targetFingerprint: string, domain: AppSyncTrashDomainKey, entries: AppSyncTrashEntry<T>[], observedEntries: AppSyncTrashEntry<T>[]) {
    const currentEntries = await readStoredTrashEntries<T>(targetFingerprint, domain);
    const currentTrash = mergePendingTrashEntries(targetFingerprint, domain, currentEntries.map(({ entry }) => entry));
    const merged = mergeReplacementTrashEntries(entries, observedEntries, currentTrash);
    await Promise.all(currentEntries.map(({ key }) => trashStore.removeItem(key)));
    await Promise.all(Array.from(merged.values()).map((entry) => trashStore.setItem(trashKey(targetFingerprint, domain, entry.id), entry)));
    Array.from(merged.values()).forEach((entry) => {
        const key = trashKey(targetFingerprint, domain, entry.id);
        const pending = pendingTrashWrites.get(key);
        if (pending && sameTrashEntry(pending.entry, entry)) pendingTrashWrites.delete(key);
    });
}

export async function removeLocalAppSyncTrash(targetFingerprint: string, domain: AppSyncTrashDomainKey, ids: Iterable<string>) {
    const idSet = new Set(ids);
    await enqueueTrashMutation(targetFingerprint, domain, async () => {
        idSet.forEach((id) => pendingTrashWrites.delete(trashKey(targetFingerprint, domain, id)));
        await Promise.all(Array.from(idSet).map((id) => trashStore.removeItem(trashKey(targetFingerprint, domain, id))));
    });
}

export async function readAppSyncBaseline(targetKey: string, domain: AppSyncTrashDomainKey) {
    return baselineStore.getItem<AppSyncBaseline>(baselineKey(targetKey, domain));
}

export async function writeAppSyncBaseline(targetKey: string, domain: AppSyncTrashDomainKey, baseline: AppSyncBaseline) {
    await baselineStore.setItem(baselineKey(targetKey, domain), baseline);
}

function trashKey(targetFingerprint: string, domain: AppSyncTrashDomainKey, id: string) {
    return `${encodeURIComponent(targetFingerprint)}:${domain}:${encodeURIComponent(id)}`;
}

function trashPrefix(targetFingerprint: string, domain: AppSyncTrashDomainKey) {
    return `${encodeURIComponent(targetFingerprint)}:${domain}:`;
}

function queuePendingTrashWrite(key: string, pending: { targetFingerprint: string; domain: AppSyncTrashDomainKey; entry: AppSyncTrashEntry<unknown>; promise: Promise<void> | null }) {
    pending.promise = enqueueTrashMutation(pending.targetFingerprint, pending.domain, async () => {
        await trashStore.setItem(key, pending.entry);
        if (pendingTrashWrites.get(key) === pending) pendingTrashWrites.delete(key);
    })
        .then(() => {
            if (pendingTrashWrites.get(key) === pending) pendingTrashWrites.delete(key);
        })
        .catch((error: unknown) => {
            if (pendingTrashWrites.get(key) === pending) pendingTrashWrites.delete(key);
            throw error;
        });
    return pending.promise;
}

function enqueueTrashMutation<T>(targetFingerprint: string, domain: AppSyncTrashDomainKey, mutation: () => Promise<T>) {
    const queueKey = trashPrefix(targetFingerprint, domain);
    const previous = mutationQueues.get(queueKey) || Promise.resolve();
    const operation = previous.then(mutation);
    let tail: Promise<unknown>;
    tail = operation
        .catch((error: unknown) => {
            console.error(i18n.t("config.webdav.errors.trashPersistFailed"), error);
        })
        .finally(() => {
            if (mutationQueues.get(queueKey) === tail) mutationQueues.delete(queueKey);
        });
    mutationQueues.set(queueKey, tail);
    return operation;
}

async function waitForTrashMutations(targetFingerprint: string, domain: AppSyncTrashDomainKey) {
    const tail = mutationQueues.get(trashPrefix(targetFingerprint, domain));
    if (tail) await tail;
}

async function waitForAllTrashMutations() {
    await Promise.all(Array.from(mutationQueues.values()));
}

async function readStoredTrashEntries<T>(targetFingerprint: string, domain: AppSyncTrashDomainKey) {
    const entries: Array<{ key: string; entry: AppSyncTrashEntry<T> }> = [];
    await trashStore.iterate<AppSyncTrashEntry<T>, void>((value: AppSyncTrashEntry<T>, key: string) => {
        if (key.startsWith(trashPrefix(targetFingerprint, domain)) && value?.id) entries.push({ key, entry: value });
    });
    return entries;
}

function sameTrashEntry<T>(left: AppSyncTrashEntry<T>, right: AppSyncTrashEntry<T>) {
    return left.deletedAt === right.deletedAt && JSON.stringify(left.item) === JSON.stringify(right.item);
}

function newestTrashEntry<T>(entry: AppSyncTrashEntry<T>, fallback?: AppSyncTrashEntry<T>) {
    if (!fallback) return entry;
    return Date.parse(entry.deletedAt) >= Date.parse(fallback.deletedAt) ? entry : fallback;
}

async function settlePendingTrashWrites(targetFingerprint?: string, domain?: AppSyncTrashDomainKey, ids?: Set<string>) {
    const prefix = targetFingerprint && domain ? trashPrefix(targetFingerprint, domain) : null;
    const writes = Array.from(pendingTrashWrites.entries()).filter(([key, pending]) => (!prefix || key.startsWith(prefix)) && (!ids || ids.has(pending.entry.id)));
    const results = await Promise.allSettled(writes.map(([key, pending]) => pending.promise || queuePendingTrashWrite(key, pending)));
    results.forEach((result) => {
        if (result.status === "rejected") console.error(i18n.t("config.webdav.errors.trashPersistFailed"), result.reason);
    });
}

function mergePendingTrashEntries<T>(targetFingerprint: string, domain: AppSyncTrashDomainKey, entries: AppSyncTrashEntry<T>[]) {
    const merged = new Map(entries.map((entry) => [entry.id, entry]));
    pendingTrashWrites.forEach((pending, key) => {
        if (!key.startsWith(trashPrefix(targetFingerprint, domain))) return;
        merged.set(pending.entry.id, pending.entry as AppSyncTrashEntry<T>);
    });
    return Array.from(merged.values());
}

function mergeReplacementTrashEntries<T>(entries: AppSyncTrashEntry<T>[], observedEntries: AppSyncTrashEntry<T>[], currentEntries: AppSyncTrashEntry<T>[]) {
    const observed = new Map(observedEntries.map((entry) => [entry.id, entry]));
    const merged = new Map(entries.map((entry) => [entry.id, entry]));
    currentEntries.forEach((entry) => {
        const observedEntry = observed.get(entry.id);
        if (observedEntry && sameTrashEntry(entry, observedEntry)) return;
        const nextEntry = merged.get(entry.id);
        merged.set(entry.id, newestTrashEntry(entry, nextEntry));
    });
    return merged;
}

export const __appSyncTrashTest = {
    mergeReplacementTrashEntries,
    sameTrashEntry,
    newestTrashEntry,
};

function mergeAllPendingTrashEntries(entries: Array<{ key: string; entry: AppSyncTrashEntry<unknown> }>) {
    const merged = new Map(entries.map(({ key, entry }) => [key, entry]));
    pendingTrashWrites.forEach((pending, key) => {
        merged.set(key, pending.entry);
    });
    return Array.from(merged.values());
}

function baselineKey(targetKey: string, domain: AppSyncTrashDomainKey) {
    return `${domain}:${targetKey}`;
}
