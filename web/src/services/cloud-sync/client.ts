export class CloudRevisionConflict extends Error {
    constructor(public currentRevision: number) {
        super("画布已在其他设备更新");
    }
}

type Envelope<T> = { code: number; data: T; msg: string };

export async function saveCloudProject<T>(id: string, revision: number, body: { title: string; payload: T }, token: string, baseUrl: string, fetcher: typeof fetch = fetch) {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/api/v1/canvas/projects/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "If-Match": String(revision) },
        body: JSON.stringify(body),
    });
    const payload = (await response.json()) as Envelope<{ currentRevision?: number }>;
    if (response.status === 409) throw new CloudRevisionConflict(payload.data?.currentRevision || 0);
    if (!response.ok || payload.code !== 0) throw new Error(payload.msg || "云同步请求失败");
    return payload.data;
}

export async function uploadCloudMedia(key: string, file: Blob, token: string, baseUrl: string, fetcher: typeof fetch = fetch) {
    const body = new FormData();
    body.set("key", key);
    body.set("file", file, "media");
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/api/v1/canvas/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
    const payload = (await response.json()) as Envelope<{ key: string; sha256: string }>;
    if (!response.ok || payload.code !== 0) throw new Error(payload.msg || "媒体上传失败");
    return payload.data;
}

export async function downloadCloudMedia(key: string, sha256: string, token: string, baseUrl: string, fetcher: typeof fetch = fetch) {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/api/v1/canvas/media/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("媒体下载失败");
    const blob = await response.blob();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (value) => value.toString(16).padStart(2, "0")).join("");
    if (sha256 && digest !== sha256) throw new Error("媒体完整性校验失败");
    return blob;
}
