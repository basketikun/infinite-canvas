import { startLocal } from "@infinite-canvas/workbench/startup/local";

void startLocal().then(() => import("./bootstrap")).catch((error) => {
    console.error("[workbench] startup failed", error);
    const root = document.getElementById("root")!;
    root.textContent = "暂时无法打开工作台。请确认本地程序仍在运行，并从启动命令显示的地址重新打开。";
    const button = document.createElement("button");
    button.textContent = "重试";
    button.onclick = () => location.reload();
    root.append(button);
});
