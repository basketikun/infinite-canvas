import npa from "npm-package-arg";
import { VERSION } from "@infinite-canvas/server/config";
import { PluginManager } from "@infinite-canvas/server/plugins/manager";
import { FsStorage } from "@infinite-canvas/server/storage/fs-storage";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";

/**
 * 停止本地工作台后管理插件；工作区目录独占由既有存储锁负责。
 */
export async function runPluginCommand(args: string[], directory: string, registry?: string) {
    const storage = await FsStorage.open(directory);
    const manager = new PluginManager(storage);
    try {
        if (registry) await manager.configure({ registry });
        const [command, value] = args;
        if (command === "add" || command === "update") {
            if (!value) throw new Error("PLUGIN_SPEC_REQUIRED");
            const spec = npa(value);
            if (!spec.name) throw new Error("PLUGIN_SPEC_REQUIRED");
            const record = await manager.install({ name: spec.name, version: spec.rawSpec === "*" ? "latest" : spec.rawSpec, host: VERSION });
            console.log(`已安装 ${record.package.infiniteCanvas.name} (${record.package.name}@${record.package.version})`);
        } else if (command === "remove" && value) {
            await manager.remove(value);
            console.log("插件已卸载，已有内容保留。");
        } else if ((command === "enable" || command === "disable") && value) {
            await manager.enable(value, command === "enable");
            console.log(command === "enable" ? "插件已启用。" : "插件已停用。");
        } else if (command === "registry") {
            if (value) await manager.configure({ registry: value });
            console.log((await manager.config()).registry);
        } else if (command === "list") {
            for (const record of await manager.list()) console.log(`${record.enabled ? "启用" : "停用"}\t${record.package.infiniteCanvas.id}\t${record.package.name}@${record.package.version}`);
        } else {
            console.log("用法：infinite-canvas plugin add <包名[@版本]> [--registry <软件源>] [--data-dir <工作区>]\n      infinite-canvas plugin update <包名[@版本]>\n      infinite-canvas plugin remove|enable|disable <插件ID>\n      infinite-canvas plugin list\n      infinite-canvas plugin registry [软件源]\n管理运行中的工作台请使用页面中的插件入口；命令行修改前先停止该工作区的服务。");
        }
    } catch (error) {
        console.error(getPluginErrorMessage(error));
        process.exitCode = 1;
    } finally {
        await manager.close();
        await storage.close();
    }
}
