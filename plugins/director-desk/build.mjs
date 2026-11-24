import { build, context } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "@infinite-canvas/plugin-sdk/build";

const root = fileURLToPath(new URL("./", import.meta.url));
// 编辑器运行在独立文档里，连同样式编入插件，无需部署单独的网站或下载脚本。
const studio = {
    name: "director-studio",
    setup(builder) {
        builder.onResolve({ filter: /^director-studio:document$/ }, () => ({ path: "document", namespace: "director-studio" }));
        builder.onLoad({ filter: /.*/, namespace: "director-studio" }, async () => {
            const result = await build({ absWorkingDir: root, entryPoints: ["src/studio/main.tsx"], bundle: true, write: false, metafile: true, minify: true, format: "iife", jsx: "automatic", outfile: "studio.js", define: { "process.env.NODE_ENV": '"production"' } });
            const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
            const css = result.outputFiles.find(file => file.path.endsWith(".css")).text;
            const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body><div id="root">正在打开导演台…</div><script>${js.replace(/<(\/script|script|!--)/gi, "\\x3C$1")}</script></body></html>`;
            return { contents: html, loader: "text", watchFiles: Object.keys(result.metafile.inputs).map(path => resolve(root, path)) };
        });
    },
};
// 附属插件只导入公开契约，不打入导演台编辑器或私有状态。
const api = { absWorkingDir: root, entryPoints: ["src/api/camera-layouts.ts"], outfile: "dist/api/camera-layouts.js", bundle: true, format: "esm", platform: "browser", target: "es2022" };
if (process.argv.includes("--watch")) await (await context(api)).watch();
else await build(api);
await buildPlugin(import.meta.url, { publicDir: new URL("../../packages/workbench/public/plugins/", import.meta.url), clientPlugins: [studio] });
