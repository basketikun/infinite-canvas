import { create } from "zustand";
import { nanoid } from "nanoid";
import type { StorageAdapter, StorageCollection } from "@infinite-canvas/shared/storage";
import { canvasDocumentSchema, type CanvasDocument, type PluginProjectDomainRecord } from "@infinite-canvas/shared/canvas/schema/canvas";
import { serializeCanvasDocument, StorageError } from "@infinite-canvas/shared/storage-data";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import type { CanvasChangeSource } from "@infinite-canvas/plugin-sdk";
import { storage } from "@workbench/services/storage/runtime";
import { cloneNodeForCopy } from "@workbench/lib/canvas/node-copy";
import type { CanvasBackgroundMode } from "@workbench/lib/canvas-theme";
import type { ViewportTransform } from "@workbench/types/canvas";

export type CanvasProject = CanvasDocument & {
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};
export type CanvasDeletedProject = { id: string; deletedAt: string };
type SaveStatus = "saved" | "pending" | "saving" | "error";
export type CanvasSaveCommit = { sessionId: string; revision: number; source: CanvasChangeSource };
export type CanvasSaveReceipt = { projectId: string; revision: number; snapshot: CanvasDocument | null; commit?: CanvasSaveCommit } & ({ status: "saved" } | { status: "failed"; code: StorageError["code"] });
export type CanvasStore = {
    hydrated: boolean;
    loadError: string;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    projectDeletions: Record<string, "pending" | "error">;
    saveStatus: Record<string, SaveStatus>;
    reloads: Record<string, number>;
    load: () => Promise<void>;
    flush: (id?: string) => Promise<void>;
    subscribeSaves: (listener: (receipt: CanvasSaveReceipt) => void) => () => void;
    reloadProject: (id: string) => Promise<void>;
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    receiveProject: (id: string) => Promise<void>;
    renameProject: (id: string, title: string) => void;
    beginProjectDeletion: (ids: string[]) => void;
    failProjectDeletion: (ids: string[]) => void;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<CanvasProject>, commit?: CanvasSaveCommit) => void;
    savePluginDomain: (id: string, record: PluginProjectDomainRecord) => Promise<void>;
};
export const initialPreferences = { viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "lines" as CanvasBackgroundMode, showImageInfo: false };
type ProjectWrite = { project: CanvasProject | null; revision: number; commit?: CanvasSaveCommit; deletedAt?: string };
type PreferenceValue = typeof initialPreferences | CanvasDeletedProject[];

function documentOf(project: CanvasProject) {
    const { viewport, backgroundMode, showImageInfo, ...document } = project;
    return document;
}

function changeTombstone(markers: CanvasDeletedProject[], id: string, next?: CanvasDeletedProject) {
    const current = markers.find((item) => item.id === id);
    if (!current) return next ? [...markers, next] : markers;
    if (!next) return markers.filter((item) => item.id !== id);
    return current.deletedAt === next.deletedAt ? markers : markers.map((item) => item.id === id ? next : item);
}

export function createCanvasStore(projects: StorageAdapter["projects"], preferences: StorageCollection) {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const dirty = new Map<string, ProjectWrite>();
    const pending = new Map<string, { snapshot: ProjectWrite; promise: Promise<void> }>();
    const pendingPreferences = new Map<string, { value: PreferenceValue; promise: Promise<void> }>();
    const dirtyPreferences = new Map<string, PreferenceValue>();
    const failed = new Map<string, ProjectWrite>();
    const failedPreferences = new Map<string, PreferenceValue>();
    const deletionTargets = new Set<string>();
    const pendingDeletions = new Map<string, Promise<void>>();
    let deletionEpoch = 0;
    let sequence = 0;
    let fullRead = 0;
    let loading: Promise<void> | undefined;
    const latest = new Map<string, number>();
    const discarding = new Map<string, Promise<void>>();
    const externalChanges = new Set<string>();
    const revisions = new Map<string, number>();
    const commits = new Map<string, CanvasSaveCommit>();
    const listeners = new Set<(receipt: CanvasSaveReceipt) => void>();
    const saved = new Map<string, string>();
    function pendingLocal(id: string) {
        return dirty.has(id) || pending.has(id) || dirtyPreferences.has(id) || pendingPreferences.has(id) || deletionTargets.has(id) || pendingDeletions.has(id) || discarding.has(id) || !!store.getState().projectDeletions[id];
    }
    function stale(id: string, read: number) {
        return fullRead > read || (latest.get(id) ?? 0) > read;
    }
    function saveStatus(id: string): SaveStatus {
        const deletion = store.getState().projectDeletions[id];
        const preferenceKeys = deletionTargets.has(id) ? [id, "deletedProjects"] : [id];
        const hasError = failed.has(id) && failed.get(id) === dirty.get(id)
            || preferenceKeys.some((key) => failedPreferences.has(key) && failedPreferences.get(key) === dirtyPreferences.get(key));
        return deletion === "error" ? "error" : deletion === "pending" ? "saving" : hasError ? "error"
            : pending.has(id) || preferenceKeys.some((key) => pendingPreferences.has(key)) ? "saving"
                : dirty.has(id) || preferenceKeys.some((key) => dirtyPreferences.has(key)) ? "pending" : "saved";
    }
    function refreshStatus(id: string) {
        const value = saveStatus(id);
        store.setState((state) => state.saveStatus[id] === value ? state : { saveStatus: { ...state.saveStatus, [id]: value } });
        if (externalChanges.has(id) && !pendingLocal(id)) void refreshExternal(id);
    }
    function refreshPreferenceStatus(key: string) {
        if (key === "deletedProjects") deletionTargets.forEach(refreshStatus);
        else refreshStatus(key);
    }
    function schedule(id: string, value: CanvasProject | null, commit?: CanvasSaveCommit, deletedAt?: string, notifyStatus = true) {
        latest.set(id, ++sequence);
        const revision = (revisions.get(id) ?? 0) + 1;
        revisions.set(id, revision);
        const accepted = commit ? readonlySnapshot(commit) as CanvasSaveCommit : undefined;
        if (accepted) commits.set(id, accepted);
        else commits.delete(id);
        dirty.set(id, { project: value, revision, commit: accepted, deletedAt });
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => { void flushAccepted(id, false).catch(() => undefined); }, 400));
        if (notifyStatus) refreshStatus(id);
    }
    function flushProject(id: string, snapshot: ProjectWrite) {
        clearTimeout(timers.get(id));
        timers.delete(id);
        if (failed.get(id) === snapshot) failed.delete(id);
        let document = snapshot.project === null ? null : documentOf(snapshot.project);
        const write = Promise.resolve().then(async () => {
            try {
                if (document !== null) {
                    const snapshot = document = serializeCanvasDocument(document);
                    await projects.setItem(id, snapshot);
                } else if (snapshot.deletedAt !== undefined && projects.deleteProject) {
                    await (async () => {
                        const record = await projects.deleteProject!(id, { deletedAt: snapshot.deletedAt });
                        if (record.value !== null || record.deletedAt !== snapshot.deletedAt) {
                            const restored = record.value === null ? null : await restore(record.value);
                            if (dirty.get(id) === snapshot) {
                                dirty.delete(id);
                                failed.delete(id);
                                showStoredProject(id, record.value, restored, record.deletedAt ? { id, deletedAt: record.deletedAt } : undefined);
                            }
                            throw new PluginError("PLUGIN_CONFLICT");
                        }
                    })();
                } else {
                    if (snapshot.deletedAt !== undefined) {
                        await pendingPreferences.get("deletedProjects")?.promise;
                        if (dirtyPreferences.has("deletedProjects")) throw new StorageError("STORAGE_UNAVAILABLE");
                    }
                    await projects.removeItem(id);
                }
                saved.set(id, JSON.stringify(document));
                if (dirty.get(id) === snapshot) {
                    dirty.delete(id);
                    failed.delete(id);
                }
                notify({ projectId: id, revision: snapshot.revision, snapshot: document, commit: snapshot.commit, status: "saved" });
            } catch (error) {
                if (dirty.get(id) === snapshot) failed.set(id, snapshot);
                const failure = error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
                notify({ projectId: id, revision: snapshot.revision, snapshot: document, commit: snapshot.commit, status: "failed", code: failure.code });
                throw error instanceof PluginError ? error : failure;
            } finally {
                if (pending.get(id)?.promise === write) pending.delete(id);
                refreshStatus(id);
            }
        });
        pending.set(id, { snapshot, promise: write });
        refreshStatus(id);
        return write;
    }
    function notify(receipt: CanvasSaveReceipt) {
        const snapshot = readonlySnapshot(receipt) as CanvasSaveReceipt;
        for (const listener of listeners) {
            try { listener(snapshot); }
            catch (error) { console.error("画布保存事件处理失败", error); }
        }
    }
    async function persistDomain(id: string, record: PluginProjectDomainRecord) {
        // 只有包含本次记录的快照能确认其保存；图编辑和其他域可以合并到同一笔写入。
        while (pending.has(id)) {
            const active = pending.get(id)!;
            if (active.snapshot.project?.pluginDomains?.includes(record)) return active.promise;
            await active.promise.catch(() => {});
        }
        const snapshot = dirty.get(id);
        if (!store.getState().openProject(id) || !snapshot?.project?.pluginDomains?.includes(record)) throw new StorageError("STORAGE_UNAVAILABLE");
        await flushProject(id, snapshot);
    }
    function savePreferences(key: string, value: PreferenceValue) {
        if (key !== "deletedProjects" && dirtyPreferences.get(key) !== value) latest.set(key, ++sequence);
        dirtyPreferences.set(key, value);
        if (failedPreferences.get(key) === value) failedPreferences.delete(key);
        const write = (pendingPreferences.get(key)?.promise ?? Promise.resolve()).catch(() => {}).then(async () => {
            try {
                await preferences.setItem(key, value);
                if (dirtyPreferences.get(key) === value && pendingPreferences.get(key)?.promise === write) {
                    dirtyPreferences.delete(key);
                    failedPreferences.delete(key);
                    if (key === "deletedProjects") {
                        const targets = [...deletionTargets];
                        deletionTargets.clear();
                        targets.forEach(refreshStatus);
                    }
                }
            } catch (error) {
                if (dirtyPreferences.get(key) === value && pendingPreferences.get(key)?.promise === write) failedPreferences.set(key, value);
                throw error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
            }
        });
        pendingPreferences.set(key, { value, promise: write });
        refreshPreferenceStatus(key);
        const release = () => {
            if (pendingPreferences.get(key)?.promise === write) pendingPreferences.delete(key);
            refreshPreferenceStatus(key);
        };
        void write.then(release, release);
        return write;
    }
    function saveDeletedProjects(previous: CanvasDeletedProject[], next: CanvasDeletedProject[]) {
        const before = new Map(previous.map((item) => [item.id, item.deletedAt]));
        const after = new Map(next.map((item) => [item.id, item.deletedAt]));
        let changed = false;
        for (const id of new Set([...before.keys(), ...after.keys()])) {
            const time = after.get(id);
            if (before.get(id) !== time) {
                if (projects.deleteProject && time !== undefined) schedule(id, null, undefined, time);
                else latest.set(id, ++sequence);
                if (!projects.tombstones) deletionTargets.add(id);
                changed = true;
            }
        }
        if (changed && !projects.tombstones) void savePreferences("deletedProjects", next).catch(() => undefined);
    }
    async function flushAccepted(id?: string, retryFailed = true) {
        const attemptedProjects = new Set<ProjectWrite>();
        const attemptedPreferences = new Set<PreferenceValue>();
        let hasFailure = false;
        let failure: unknown;
        while (true) {
            const writes: Promise<void>[] = [];
            const projectIds = id === undefined ? new Set([...dirty.keys(), ...pending.keys()]) : [id];
            for (const projectId of projectIds) {
                const active = pending.get(projectId);
                const snapshot = active?.snapshot ?? dirty.get(projectId);
                if (!snapshot) continue;
                if (active) writes.push(active.promise);
                else if (!store.getState().projectDeletions[projectId] && !attemptedProjects.has(snapshot) && (retryFailed || failed.get(projectId) !== snapshot)) writes.push(flushProject(projectId, snapshot));
                attemptedProjects.add(snapshot);
            }
            const preferenceKeys = id === undefined ? new Set([...dirtyPreferences.keys(), ...pendingPreferences.keys()]) : [id, "deletedProjects"];
            for (const key of preferenceKeys) {
                const active = pendingPreferences.get(key);
                const value = active?.value ?? dirtyPreferences.get(key);
                if (!value) continue;
                if (active) writes.push(active.promise);
                else if (!store.getState().projectDeletions[key] && !attemptedPreferences.has(value) && (retryFailed || failedPreferences.get(key) !== value)) writes.push(savePreferences(key, value));
                attemptedPreferences.add(value);
            }
            if (!writes.length) break;
            const results = await Promise.allSettled(writes);
            const rejected = results.find((result) => result.status === "rejected");
            if (!hasFailure && rejected?.status === "rejected") {
                hasFailure = true;
                failure = rejected.reason;
            }
        }
        if (hasFailure) throw failure;
    }
    async function restore(document: CanvasDocument) {
        if (!canvasDocumentSchema.safeParse(document).success) throw new StorageError("STORAGE_INVALID");
        const local = await preferences.getItem<typeof initialPreferences>(document.id);
        return { ...document, ...initialPreferences, ...local } as CanvasProject;
    }
    async function readDeletions() {
        return projects.tombstones ? (await projects.tombstones()).map(({ key, deletedAt }) => ({ id: key, deletedAt })) : await preferences.getItem<CanvasDeletedProject[]>("deletedProjects") ?? [];
    }
    async function refreshDocument(id: string, discard: boolean) {
        const epoch = deletionEpoch;
        if (store.getState().projectDeletions[id]) {
            if (discard) throw new StorageError("STORAGE_UNAVAILABLE");
            return;
        }
        if (!discard && pendingLocal(id)) return;
        const read = ++sequence;
        latest.set(id, read);
        if (discard) {
            clearTimeout(timers.get(id));
            while (pending.has(id) || pendingPreferences.has(id)) {
                await Promise.allSettled([pending.get(id)?.promise, pendingPreferences.get(id)?.promise]);
            }
        }
        const superseded = () => discard ? latest.get(id) !== read : stale(id, read) || pendingLocal(id);
        let document: CanvasDocument | null;
        let restored: CanvasProject | null;
        let marker: CanvasDeletedProject | undefined;
        try {
            document = await projects.getItem<CanvasDocument>(id);
            restored = document === null ? null : await restore(document);
            marker = (await readDeletions()).find((item) => item.id === id);
        } catch (error) {
            if (superseded()) return;
            throw error;
        }
        if (discard && deletionEpoch !== epoch) throw new StorageError("STORAGE_UNAVAILABLE");
        if (superseded()) return;
        if (!discard && JSON.stringify(document) === saved.get(id) && marker?.deletedAt === store.getState().deletedProjects.find((item) => item.id === id)?.deletedAt) return;
        if (discard) latest.set(id, ++sequence);
        dirty.delete(id);
        failed.delete(id);
        if (discard) {
            dirtyPreferences.delete(id);
            failedPreferences.delete(id);
        }
        showStoredProject(id, document, restored, marker);
    }
    function showStoredProject(id: string, document: CanvasDocument | null, restored: CanvasProject | null, marker?: CanvasDeletedProject, finishDeletion = false) {
        commits.delete(id);
        saved.set(id, JSON.stringify(document));
        store.setState((state) => ({
            projects: restored ? [restored, ...state.projects.filter((project) => project.id !== id)] : state.projects.filter((project) => project.id !== id),
            projectDeletions: finishDeletion ? Object.fromEntries(Object.entries(state.projectDeletions).filter(([key]) => key !== id))
                : restored && marker ? { ...state.projectDeletions, [id]: "error" as const } : state.projectDeletions,
            deletedProjects: changeTombstone(state.deletedProjects, id, marker),
            reloads: { ...state.reloads, [id]: (state.reloads[id] ?? 0) + 1 },
        }));
        refreshStatus(id);
    }
    async function refreshExternal(id: string) {
        if (pendingLocal(id)) { externalChanges.add(id); return; }
        externalChanges.delete(id);
        try { await refreshDocument(id, false); }
        catch { store.setState({ loadError: "暂时无法读取其他页面的修改，请稍后重试。" }); }
    }
    const store = create<CanvasStore>((set, get) => ({
        hydrated: false, loadError: "", projects: [], deletedProjects: [], projectDeletions: {}, saveStatus: {}, reloads: {},
        load() {
            if (loading) return loading;
            const read = ++sequence;
            fullRead = read;
            const protectedIds = new Set([...dirty.keys(), ...pending.keys(), ...dirtyPreferences.keys(), ...pendingPreferences.keys(), ...deletionTargets, ...pendingDeletions.keys(), ...discarding.keys(), ...Object.keys(get().projectDeletions)]);
            const keep = (id: string) => protectedIds.has(id) || stale(id, read) || pendingLocal(id);
            loading = (async () => {
                const documents: CanvasDocument[] = [];
                await projects.iterate<CanvasDocument, void>((document) => { documents.push(document); });
                const restored = await Promise.allSettled(documents.map(restore));
                const markers = await readDeletions();
                const state = get();
                const deletedProjects = [...state.deletedProjects.filter((item) => keep(item.id)), ...markers.filter((item) => !keep(item.id))];
                const deletedIds = new Set(deletedProjects.map((item) => item.id));
                const visible = state.projects.filter((project) => keep(project.id));
                const projectDeletions = { ...state.projectDeletions };
                const saveStatus = Object.fromEntries(Object.entries(state.saveStatus).filter(([id]) => keep(id)));
                const loadedIds = new Set<string>();
                restored.forEach((result, index) => {
                    const { id } = documents[index];
                    if (keep(id)) return;
                    if (result.status === "rejected") throw result.reason;
                    visible.push(result.value);
                    loadedIds.add(id);
                    if (deletedIds.has(id)) projectDeletions[id] = "error";
                    saveStatus[id] = deletedIds.has(id) ? "error" : "saved";
                });
                for (const project of state.projects) if (!keep(project.id) && !loadedIds.has(project.id)) saved.set(project.id, "null");
                for (const document of documents) if (loadedIds.has(document.id)) saved.set(document.id, JSON.stringify(document));
                set({ projects: visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), deletedProjects, projectDeletions, saveStatus, hydrated: true, loadError: "" });
            })().catch(() => {
                set({ loadError: "画布暂时无法读取，请确认保存位置可用后重试。" });
            }).finally(() => { loading = undefined; });
            return loading;
        },
        flush: flushAccepted,
        subscribeSaves(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        reloadProject(id) {
            const read = refreshDocument(id, true);
            discarding.set(id, read);
            return read.finally(() => {
                if (discarding.get(id) !== read) return;
                discarding.delete(id);
                if (externalChanges.has(id)) void refreshExternal(id);
            });
        },
        createProject(title = "未命名画布") { return get().importProject({ title }); },
        importProject(source) {
            const now = new Date().toISOString();
            const project: CanvasProject = { ...initialPreferences, connections: [], title: "导入画布", createdAt: now, ...source, nodes: (source.nodes ?? []).map(cloneNodeForCopy), schemaVersion: 1, id: nanoid(), updatedAt: now };
            set((state) => ({ projects: [project, ...state.projects] }));
            schedule(project.id, project);
            void savePreferences(project.id, { viewport: project.viewport, backgroundMode: project.backgroundMode, showImageInfo: project.showImageInfo }).catch(() => undefined);
            return project.id;
        },
        openProject(id) { return get().projectDeletions[id] ? null : get().projects.find((project) => project.id === id) ?? null; },
        async receiveProject(id) {
            if (!get().openProject(id)) await refreshDocument(id, false);
            if (!get().openProject(id)) throw new StorageError("STORAGE_UNAVAILABLE");
        },
        renameProject(id, title) { get().updateProject(id, { title }); },
        beginProjectDeletion(ids) {
            const state = get();
            if (ids.some((id) => !state.projects.some((project) => project.id === id) && !state.deletedProjects.some((project) => project.id === id))) throw new StorageError("STORAGE_INVALID");
            const targets = ids.filter((id) => state.projects.some((project) => project.id === id));
            if (targets.length) deletionEpoch++;
            for (const id of targets) {
                latest.set(id, ++sequence);
                clearTimeout(timers.get(id));
                timers.delete(id);
            }
            if (targets.length) set({ projectDeletions: { ...state.projectDeletions, ...Object.fromEntries(targets.map((id) => [id, "pending" as const])) } });
            targets.forEach(refreshStatus);
        },
        failProjectDeletion(ids) {
            const state = get();
            const targets = ids.filter((id) => state.projectDeletions[id] && state.projects.some((project) => project.id === id));
            if (targets.length) set({ projectDeletions: { ...state.projectDeletions, ...Object.fromEntries(targets.map((id) => [id, "error" as const])) } });
            targets.forEach(refreshStatus);
        },
        async deleteProjects(ids) {
            get().beginProjectDeletion(ids);
            const targets = [...new Set(ids)];
            const operations = targets.map((id) => {
                const active = pendingDeletions.get(id);
                if (active) return active;
                const operation = Promise.resolve().then(async () => {
                    while (pending.has(id) || pendingPreferences.has(id)) {
                        await Promise.allSettled([pending.get(id)?.promise, pendingPreferences.get(id)?.promise]);
                    }
                    dirty.delete(id);
                    failed.delete(id);
                    dirtyPreferences.delete(id);
                    failedPreferences.delete(id);
                    commits.delete(id);
                    const current = get().deletedProjects;
                    const marked = current.some((project) => project.id === id);
                    const deletedProjects = marked ? current : [...current, { id, deletedAt: new Date().toISOString() }];
                    if (!marked) set({ deletedProjects });
                    if (!projects.tombstones && (!marked || dirtyPreferences.has("deletedProjects") || pendingPreferences.has("deletedProjects"))) {
                        deletionTargets.add(id);
                        await savePreferences("deletedProjects", deletedProjects);
                    }
                    if (projects.deleteProject) {
                        await (async () => {
                            const record = await projects.deleteProject!(id, marked ? { expectedDocument: JSON.parse(saved.get(id) ?? "null") } : {});
                            if (record.value !== null) {
                                showStoredProject(id, record.value, await restore(record.value), undefined, true);
                                throw new PluginError("PLUGIN_CONFLICT");
                            }
                            set((state) => ({ deletedProjects: changeTombstone(state.deletedProjects, id, { id, deletedAt: record.deletedAt! }) }));
                        })();
                    } else await projects.removeItem(id);
                    saved.set(id, "null");
                    await preferences.removeItem(id);
                });
                pendingDeletions.set(id, operation);
                return operation;
            });
            try {
                const results = await Promise.allSettled(operations);
                const failure = results.find((result) => result.status === "rejected");
                if (failure?.status === "rejected") {
                    get().failProjectDeletion(targets);
                    throw failure.reason instanceof StorageError || failure.reason instanceof PluginError ? failure.reason : new StorageError("STORAGE_UNAVAILABLE");
                }
                const removing = new Set(targets);
                for (const id of targets) {
                    deletionTargets.delete(id);
                    latest.set(id, ++sequence);
                }
                set((state) => ({
                    projects: state.projects.filter((project) => !removing.has(project.id)),
                    projectDeletions: Object.fromEntries(Object.entries(state.projectDeletions).filter(([id]) => !removing.has(id))),
                }));
                targets.forEach(refreshStatus);
            } finally {
                targets.forEach((id, index) => {
                    if (pendingDeletions.get(id) === operations[index]) pendingDeletions.delete(id);
                    if (externalChanges.has(id)) void refreshExternal(id);
                });
            }
        },
        replaceProjects(next, deletedProjects = []) {
            if (Object.keys(get().projectDeletions).length) throw new StorageError("STORAGE_UNAVAILABLE");
            const { projects: current, deletedProjects: previous } = get();
            const keeping = new Set(next.map((item) => item.id));
            const removing = current.filter((project) => !keeping.has(project.id));
            const prior = new Set(current);
            const markers = new Map(deletedProjects.map((item) => [item.id, item.deletedAt]));
            set({ projects: next, deletedProjects });
            saveDeletedProjects(previous, deletedProjects);
            for (const { id } of removing) {
                if (!projects.deleteProject || !markers.has(id)) schedule(id, null, undefined, markers.get(id));
            }
            next.forEach((project) => {
                if (prior.has(project)) return;
                schedule(project.id, project);
                void savePreferences(project.id, { viewport: project.viewport, backgroundMode: project.backgroundMode, showImageInfo: project.showImageInfo }).catch(() => undefined);
            });
        },
        updateProject(id, patch, commit) {
            const current = get().openProject(id);
            if (!current) return;
            const project = { ...current, ...patch };
            const changed = Object.entries(patch).some(([key, value]) => !["viewport", "backgroundMode", "showImageInfo"].includes(key) && current[key] !== value);
            if (changed) project.updatedAt = new Date().toISOString();
            // 先接收本次写入，再发布给同步订阅者；其重入的修改应排在本次之后。
            if (changed) schedule(id, project, patch.nodes !== undefined || patch.connections !== undefined ? commit : commits.get(id), undefined, false);
            const status = changed && saveStatus(id);
            try {
                set((state) => ({
                    projects: state.projects.map((item) => item.id === id ? project : item),
                    ...(status && state.saveStatus[id] !== status && { saveStatus: { ...state.saveStatus, [id]: status } }),
                }));
            } finally {
                if (patch.viewport || patch.backgroundMode !== undefined || patch.showImageInfo !== undefined) {
                    const accepted = get().openProject(id);
                    if (accepted) void savePreferences(id, { viewport: accepted.viewport, backgroundMode: accepted.backgroundMode, showImageInfo: accepted.showImageInfo }).catch(() => {});
                }
            }
        },
        savePluginDomain(id, record) {
            const project = get().openProject(id);
            if (!project) throw new StorageError("STORAGE_UNAVAILABLE");
            const others = (project.pluginDomains ?? []).filter((item) => item.owner !== record.owner || item.domain !== record.domain);
            get().updateProject(id, { pluginDomains: [...others, record] });
            return persistDomain(id, record);
        },
    }));
    const initialized = store.getState().load();
    projects.subscribe?.((key) => {
        void (async () => {
            await initialized;
            const keys = new Set(key ? [key] : store.getState().projects.map((project) => project.id));
            if (key === null) await projects.iterate<CanvasDocument, void>((document) => { keys.add(document.id); });
            for (const id of keys) await refreshExternal(id);
        })().catch(() => store.setState({ loadError: "暂时无法读取其他页面的修改，请稍后重试。" }));
    });
    return store;
}

export const useCanvasStore = createCanvasStore(storage.projects, storage.preferences);
