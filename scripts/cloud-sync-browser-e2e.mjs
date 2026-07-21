import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const apiUrl = process.env.API_URL || "http://127.0.0.1:8080";
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

if (!username || !password) throw new Error("请设置 E2E_USERNAME 和 E2E_PASSWORD");

const label = `浏览器验收-${Date.now()}`;
const mediaKey = `image:browser-e2e-${Date.now()}`;
const mediaText = `infinite-canvas-${Date.now()}`;
const browser = await chromium.launch({ headless: true });

try {
    const token = await login();
    const a = await browser.newPage();
    const b = await browser.newPage();
    await Promise.all([configureCloudMode(a, token), configureCloudMode(b, token)]);

    await a.goto(`${baseUrl}/canvas`);
    await a.getByRole("button", { name: "新建画布" }).first().click();
    await a.waitForURL(/\/canvas\/.+/);
    await a.waitForTimeout(1_000);
    await openCloudPanel(a);
    await a.getByRole("button", { name: "同步全部本地画布" }).click();
    const syncMessage = a.getByText(/已同步 \d+ 个本地画布/);
    await syncMessage.waitFor();
    assert.match(await syncMessage.innerText(), /已同步 1 个本地画布/);

    const project = (await api(token, "/api/v1/canvas/projects"))[0];
    assert(project?.id, "画布未上传到控制平面");
    const uploaded = await uploadMedia(a, token);
    let remote = await api(token, `/api/v1/canvas/projects/${encodeURIComponent(project.id)}`);
    remote = await saveRemote(a, token, project.id, remote.currentRevision, remote.payload, [uploaded]);

    await openCloudPanel(b);
    await b.getByRole("button", { name: "刷新云端列表" }).click();
    const remoteProject = b.getByText(label).locator("xpath=../..");
    await remoteProject.waitFor({ timeout: 15_000 });
    await remoteProject.getByRole("button", { name: "使用远端" }).click();
    await b.getByText("已恢复云端画布").waitFor();
    assert.equal(await readImageBlob(b, mediaKey), mediaText, "远端媒体没有写入 IndexedDB");

    remote = await saveRemote(a, token, project.id, remote.currentRevision, remote.payload, [uploaded]);
    await b.getByRole("button", { name: "同步全部本地画布" }).click();
    await b.getByText("在其他设备已有更新").waitFor();
    await b.getByRole("button", { name: "另存本地副本" }).click();
    await b.getByText("已另存为本地冲突副本").waitFor();
    await b.getByText("在其他设备已有更新").locator("xpath=..").getByRole("button", { name: "使用远端" }).click();
    await b.getByText("已恢复云端画布").waitFor();

    remote = await api(token, `/api/v1/canvas/projects/${encodeURIComponent(project.id)}`);
    remote = await saveRemote(a, token, project.id, remote.currentRevision, remote.payload, [uploaded]);
    await b.getByRole("button", { name: "同步全部本地画布" }).click();
    await b.getByText("在其他设备已有更新").waitFor();
    await b.getByText("在其他设备已有更新").locator("xpath=..").getByRole("button", { name: "用本地覆盖远端" }).click();
    await b.getByText("已用本地版本覆盖云端版本").waitFor();
    const finalRemote = await api(token, `/api/v1/canvas/projects/${encodeURIComponent(project.id)}`);
    assert.equal(finalRemote.currentRevision, remote.currentRevision + 1, "本地覆盖没有生成新修订");
    console.log("cloud-sync-browser-e2e=ok");
} finally {
    await browser.close();
}

async function login() {
    const response = await fetch(`${apiUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const body = await response.json();
    if (!body?.data?.token) throw new Error(body?.msg || "控制平面登录失败");
    return body.data.token;
}

async function configureCloudMode(page, token) {
    await page.goto(baseUrl);
    await page.evaluate(
        ({ token }) => {
            localStorage.setItem("infinite-canvas-control-plane-session", JSON.stringify({ state: { token }, version: 0 }));
            localStorage.setItem("infinite-canvas:ai_config_store", JSON.stringify({ state: { config: { channelMode: "remote" }, syncMode: "cloud", cloudRevisions: {} }, version: 0 }));
        },
        { token },
    );
    await page.reload();
    const session = await page.evaluate(async () => {
        const token = JSON.parse(localStorage.getItem("infinite-canvas-control-plane-session") || "{}").state?.token || "";
        const api = window.__RUNTIME_CONFIG__?.CONTROL_PLANE_URL || "";
        const response = await fetch(`${api}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        return { api, tokenLength: token.length, status: response.status, body: await response.text() };
    });
    if (session.status !== 200 || !session.tokenLength) throw new Error(`浏览器会话初始化失败：${JSON.stringify(session)}`);
}

async function openCloudPanel(page) {
    await page.goto(`${baseUrl}/config`);
    await page.getByRole("tab", { name: "同步" }).click();
    await page.waitForTimeout(2_000);
    if (!(await page.getByText("控制平面云同步").isVisible())) throw new Error(`云同步面板未显示：${await page.locator("body").innerText()}`);
}

async function api(token, path) {
    const response = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok || body.code !== 0) throw new Error(body.msg || `API 请求失败：${path}`);
    return body.data;
}

async function uploadMedia(page, token) {
    return page.evaluate(
        async ({ apiUrl, token, mediaKey, mediaText }) => {
            const form = new FormData();
            form.set("key", mediaKey);
            form.set("file", new File([mediaText], "browser-e2e.txt", { type: "text/plain" }));
            const response = await fetch(`${apiUrl}/api/v1/canvas/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
            const body = await response.json();
            if (!response.ok || body.code !== 0) throw new Error(body.msg || "上传媒体失败");
            return { storageKey: mediaKey, sha256: body.data.sha256, mimeType: body.data.mimeType, bytes: body.data.bytes };
        },
        { apiUrl, token, mediaKey, mediaText },
    );
}

async function saveRemote(page, token, id, revision, payload, media) {
    return page.evaluate(
        async ({ apiUrl, token, id, revision, payload, media, label }) => {
            const project = { ...(payload.project || payload), title: label };
            const response = await fetch(`${apiUrl}/api/v1/canvas/projects/${encodeURIComponent(id)}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "If-Match": String(revision) },
                body: JSON.stringify({ title: label, payload: { project, media } }),
            });
            const body = await response.json();
            if (!response.ok || body.code !== 0) throw new Error(body.msg || "更新远端项目失败");
            return body.data;
        },
        { apiUrl, token, id, revision, payload, media, label },
    );
}

async function readImageBlob(page, key) {
    return page.evaluate(
        (key) =>
            new Promise((resolve, reject) => {
                const request = indexedDB.open("infinite-canvas");
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const transaction = request.result.transaction("image_files", "readonly");
                    const get = transaction.objectStore("image_files").get(key);
                    get.onerror = () => reject(get.error);
                    get.onsuccess = async () => resolve(get.result ? await get.result.text() : "");
                };
            }),
        key,
    );
}
