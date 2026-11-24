import { startBrowser } from "@infinite-canvas/workbench/startup/browser";

void startBrowser().then(() => import("./bootstrap")).catch((error) => {
    console.error("[web] startup failed", error);
    const root = document.getElementById("root")!;
    root.textContent = "暂时无法打开画布。请确认浏览器允许保存网站数据，然后重试。";
    const button = document.createElement("button");
    button.textContent = "重试";
    button.onclick = () => location.reload();
    root.append(button);
});
