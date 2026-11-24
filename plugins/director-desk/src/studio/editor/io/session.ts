import { useSyncExternalStore } from "react";
import type { Attachment, DeskAction, Scene } from "../../../lib/desk-messages";
import type { DirectorProject } from "../schema/directorProject";
import { useDirectorStore, type DirectorStore } from "../store/directorStore";
import { finishRecording } from "./recording";
import { getSceneSummary } from "../schema/cameraLayouts";
import { readPanoramaFile } from "../loaders/panoramaImport";

let port: MessagePort;
let ready = false;
let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(): void }>();
const resources = new Map<string, Attachment>();
const sent = new Set<string>();
const released = new Set<(url: string) => void>();
let held = false;
let dirty = false;
let status = "";
const listeners = new Set<() => void>();

export function notify(text: string) {
    status = text;
    for (const listener of listeners) listener();
}
export function useStatus() {
    return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
}
function request<T>(action: DeskAction): Promise<T> {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve: value => resolve(value as T), reject });
        port.postMessage({ id, ...action });
    });
}
export function onFileReleased(listener: (url: string) => void) {
    released.add(listener);
}
function release(url: string) {
    resources.delete(url);
    URL.revokeObjectURL(url);
    for (const listener of released) listener(url);
}
function attach(item: Attachment) {
    const url = URL.createObjectURL(item.file);
    resources.set(url, item);
    return url;
}
function projectUrls(project: DirectorProject) {
    return [
        ...project.assets.map(asset => asset.url),
        ...project.cameras.flatMap(camera => [camera.lastCaptureUrl, ...(camera.captures ?? []).map(shot => shot.dataUrl)]),
    ].filter((url): url is string => Boolean(url));
}
function referencedUrls(state: DirectorStore) {
    return new Set([state.project, ...state.undoStack.map(item => item.project), ...(state.undoBatchSnapshot ? [state.undoBatchSnapshot.project] : [])].flatMap(projectUrls));
}
export async function keepFile(input: Blob | string) {
    const file = typeof input === "string" ? await (await fetch(input)).blob() : input;
    return attach({ key: crypto.randomUUID(), file });
}
function mapUrls(project: DirectorProject, map: (value: string) => string): DirectorProject {
    return { ...project, assets: project.assets.map(asset => ({ ...asset, url: map(asset.url) })),
        cameras: project.cameras.map(camera => ({ ...camera,
            lastCaptureUrl: camera.lastCaptureUrl && map(camera.lastCaptureUrl),
            captures: camera.captures?.map(shot => ({ ...shot, dataUrl: map(shot.dataUrl) })),
        })),
    };
}
function restoreProject(project: DirectorProject, urls: Map<string, string>) {
    const lost: string[] = [];
    const assets: DirectorProject["assets"] = [];
    for (const asset of project.assets) {
        const url = urls.get(asset.url);
        if (url) assets.push({ ...asset, url });
        else lost.push(asset.name ?? asset.fileName);
    }
    const kept = new Set(assets.map(asset => asset.id));
    const objects = project.objects.filter(object => !object.assetRefId || kept.has(object.assetRefId));
    const removed = new Set(project.objects.filter(object => !objects.includes(object)).map(object => object.id));
    let shots = 0;
    const cameras = project.cameras.map(camera => ({
        ...camera,
        ...(camera.targetObjectId && removed.has(camera.targetObjectId) ? { targetMode: "manual" as const, targetObjectId: null } : {}),
        lastCaptureUrl: camera.lastCaptureUrl ? urls.get(camera.lastCaptureUrl) ?? null : camera.lastCaptureUrl,
        captures: camera.captures?.flatMap(shot => {
            const url = urls.get(shot.dataUrl);
            if (!url) shots++;
            return url ? [{ ...shot, dataUrl: url }] : [];
        }),
    }));
    if (shots) lost.push(`${shots} 张截图`);
    return { lost, project: { ...project, assets, objects, cameras, panoramaAssetId: project.panoramaAssetId && kept.has(project.panoramaAssetId) ? project.panoramaAssetId : null } };
}

async function save() {
    const used = new Map<string, Attachment>();
    const project = mapUrls(useDirectorStore.getState().project, url => {
        const item = resources.get(url)!;
        used.set(item.key, item);
        return item.key;
    });
    const added = [...used.values()].filter(item => !sent.has(item.key));
    await request({ action: "save", scene: { project, keys: [...used.keys()] }, added });
    for (const item of added) sent.add(item.key);
    notify("已保存");
}
export function holdAutosave(value: boolean) {
    held = value;
    if (!held && dirty) autosave();
}
function autosave() {
    dirty = held;
    if (!held) void retrySave();
}
export async function retrySave() {
    try { await save(); return true; }
    catch { notify("场景尚未保存，请点击保存重试。"); return false; }
}
export async function saveAndClose() {
    try { await finishRecording(); }
    catch { notify("视频尚未添加，可重试或放弃这段录制后关闭。"); return; }
    if (ready && !await retrySave()) return;
    await request({ action: "close" });
    for (const url of [...resources.keys()]) release(url);
}
export async function sendCaptures(captures: { dataUrl: string; fileName: string }[]) {
    try {
        await request({ action: "captures", items: captures.map(shot => ({ file: resources.get(shot.dataUrl)!.file, name: shot.fileName })) });
        notify(`已添加 ${captures.length} 张图片到画布`);
    } catch { notify("图片未添加，请重新选择镜头后重试。"); }
}
export async function sendRecording(file: Blob) {
    const extension = file.type.includes("mp4") ? "mp4" : "webm";
    await request({ action: "recording", file, name: `导演台录制.${extension}` });
    notify("录制已添加到画布");
}

export async function addCapturedShots(cameraId: string | null | undefined, results: { label: string; dataUrl: string }[]) {
    const urls = await Promise.all(results.map(result => keepFile(result.dataUrl)));
    useDirectorStore.getState().addCameraCaptures(cameraId, urls);
    await sendCaptures(results.map((result, index) => ({ dataUrl: urls[index], fileName: `${result.label}.png` })));
}

export async function importBackground() {
    let image: { file: Blob; name: string };
    try { image = await request({ action: "background" }); }
    catch { notify("没有读取到连接的图片，请确认已把画布上的图片连接到导演台节点。"); return; }
    try {
        const result = await readPanoramaFile(new File([image.file], `${image.name}.${image.file.type.split("/")[1]}`, { type: image.file.type }));
        useDirectorStore.getState().addImportedAsset({ kind: "panorama", ...result, name: image.name });
    } catch { notify("背景图无法使用，请换一张 JPG、PNG 或 WEBP 图片。"); }
}
export async function openSession(channel: MessagePort) {
    port = channel;
    let sceneId: string;
    ready = false;
    channel.onmessage = ({ data }) => {
        if (data.theme) {
            const root = document.documentElement;
            root.dataset.theme = data.theme;
            const palette = { bg: "background", surface: "surface", "surface-hover": "surface", panel: "panel", field: "surface", border: "border", text: "text", "text-muted": "muted", accent: "accent" };
            const pixel = document.createElement("canvas").getContext("2d");
            for (const [token, field] of Object.entries(palette)) {
                if (data.colors && pixel) {
                    pixel.fillStyle = data.colors[field];
                    pixel.fillRect(0, 0, 1, 1);
                    root.style.setProperty("--" + token + "-rgb", Array.from(pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(" "));
                } else root.style.removeProperty("--" + token + "-rgb");
            }
            return;
        }
        if (data.requestId) {
            try {
                if (!ready || data.sceneId !== sceneId) throw new Error("SCENE_CLOSED");
                const state = useDirectorStore.getState();
                let value;
                if (data.action === "summary") value = getSceneSummary(state.project, state.selectedObjectIds, sceneId);
                else if (data.action === "apply-layout" && data.result.sceneId === sceneId) state.applyCameraLayout(data.result);
                else throw new Error("LAYOUT_REQUEST_INVALID");
                port.postMessage({ requestId: data.requestId, sceneId, ok: true, value });
            } catch (error) {
                console.error("[plugins] director-desk layout message", data.action, error);
                port.postMessage({ requestId: data.requestId, sceneId, ok: false });
            }
            return;
        }
        const waiter = pending.get(data.id);
        pending.delete(data.id);
        if (data.ok) waiter?.resolve(data.value);
        else waiter?.reject();
    };
    const saved = await request<{ scene: Scene | null; files: Attachment[]; sceneId: string }>({ action: "load" });
    sceneId = saved.sceneId;
    if (saved.scene) {
        const urls = new Map(saved.files.map(item => [item.key, attach(item)]));
        for (const item of saved.files) sent.add(item.key);
        const { project, lost } = restoreProject(saved.scene.project, urls);
        useDirectorStore.getState().replaceProject(project);
        if (lost.length) notify(`以下素材已丢失，已从场景中移除：${lost.join("、")}`);
    }
    useDirectorStore.subscribe((state, before) => {
        if (before.project === state.project) return;
        autosave();
        const kept = referencedUrls(state);
        for (const url of referencedUrls(before)) if (!kept.has(url)) release(url);
    });
    ready = true;
    port.postMessage({ ready: true, sceneId });
}
