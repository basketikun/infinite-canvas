import { build, context } from "esbuild";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as radix from "radix-ui";

/**
 * 客户端使用原生 ESM 分片；随包的样式与资源及开发目录都只发布本次实际产物。
 */
export async function buildPlugin(metaUrl, overrides = {}) {
    const root = dirname(fileURLToPath(metaUrl));
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    // 与 shared 的 createPluginPackage 约定一致：id 取包名去掉作用域和 canvas-plugin- 前缀，名称、说明、版本、作者读 plugin.json，入口 dist/client.js，图标与说明按固定文件名查找。
    const exists = async (files) => { for (const file of files) if (await stat(join(root, file)).then(info => info.isFile(), () => false)) return file; };
    const describe = async (current) => {
        const meta = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));
        const id = current.name.replace(/^@[^/]+\//, "").replace(/^canvas-plugin-/, "");
        return {
            name: current.name, version: meta.version ?? current.version, description: meta.description ?? current.description, author: meta.author ?? current.author,
            infiniteCanvas: { id, name: meta.name, client: "dist/client.js", icon: await exists(["icon.svg", "icon.png", "icon.webp"]), readme: await exists(["GUIDE.md", "README.md"]) },
        };
    };
    const manifest = (await describe(pkg)).infiniteCanvas;
    const watch = process.argv.includes("--watch");
    const publicDir = overrides.publicDir && fileURLToPath(overrides.publicDir);
    const assets = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".mp3", ".wav"];
    const clientFiles = {
        name: "client-files",
        setup(builder) {
            if (watch) {
                builder.onResolve({ filter: /.*/ }, args => args.kind === "entry-point" ? { path: args.path, namespace: "client-entry" } : undefined);
                builder.onLoad({ filter: /.*/, namespace: "client-entry" }, async args => {
                    const current = (await describe(JSON.parse(await readFile(join(root, "package.json"), "utf8")))).infiniteCanvas;
                    return { contents: `export { default } from ${JSON.stringify(args.path)};`, resolveDir: root, watchFiles: ["package.json", "plugin.json", current.icon, current.readme].filter(Boolean).map(file => join(root, file)) };
                });
            }
            builder.onResolve({ filter: /\.css\?inline$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -7)), namespace: "inline-css" }));
            builder.onLoad({ filter: /.*/, namespace: "inline-css" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text", watchFiles: [args.path] }));
            // file loader 的相对地址应相对插件模块，不能相对用户当前打开的工作台页面。
            builder.onResolve({ filter: /\.(png|jpe?g|gif|svg|webp|avif|woff2?|[ot]tf|mp4|webm|mp3|wav)$/i }, async args => {
                if (args.kind !== "import-statement" || args.path.startsWith("client-file:")) return;
                const result = await builder.resolve(args.path, { resolveDir: args.resolveDir, kind: "url-token" });
                if (result.errors.length) return { errors: result.errors };
                return { path: result.path, namespace: "client-file-url" };
            });
            builder.onLoad({ filter: /.*/, namespace: "client-file-url" }, args => ({
                contents: `import path from ${JSON.stringify("client-file:" + args.path)}; export default new URL(path, import.meta.url).href;`,
            }));
            builder.onResolve({ filter: /^client-file:/ }, args => ({ path: args.path.slice(12), namespace: "file" }));
            builder.onEnd(async (result) => {
                if (result.errors.length) return;
                const files = Object.keys(result.metafile.outputs).map(file => relative(root, resolve(root, file)).split(sep).join("/")).filter(file => !file.endsWith(".map")).sort();
                const styles = files.filter(file => file.endsWith(".css"));
                const index = { files, styles };
                await writeFile(join(root, manifest.client + ".files.json"), JSON.stringify(index));
                if (!publicDir) return;
                const currentPackage = await describe(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
                if (currentPackage.infiniteCanvas.id !== manifest.id || currentPackage.infiniteCanvas.client !== manifest.client) throw new Error("插件入口已修改，请重新启动插件构建。");
                const target = join(publicDir, manifest.id);
                const resources = [...new Set([...files, currentPackage.infiniteCanvas.icon, currentPackage.infiniteCanvas.readme].filter(Boolean))];
                const digest = createHash("sha256").update(JSON.stringify(currentPackage));
                const contents = await Promise.all(resources.map(async file => [file, await readFile(join(root, file))]));
                for (const [file, bytes] of contents) digest.update(file).update(createHash("sha256").update(bytes).digest());
                const generation = digest.digest("hex");
                await mkdir(target, { recursive: true });
                const staging = await mkdtemp(join(target, ".build-"));
                try {
                    for (const [file, bytes] of contents) {
                        const dest = join(staging, file);
                        await mkdir(dirname(dest), { recursive: true });
                        await writeFile(dest, bytes);
                    }
                    try { await rename(staging, join(target, generation)); }
                    catch (error) { if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error; }
                } finally {
                    await rm(staging, { recursive: true, force: true });
                }
                const pointer = join(target, "development.json");
                const old = await readFile(pointer, "utf8").then(JSON.parse, error => { if (error.code !== "ENOENT") throw error; });
                const temp = join(target, randomUUID() + ".json");
                await writeFile(temp, JSON.stringify({ package: currentPackage, clientFiles: { ...index, generation } }));
                await rename(temp, pointer);
                // 保留上一代，已打开的旧实例仍要懒加载它的分片。
                const keep = new Set([generation, old?.clientFiles.generation]);
                for (const name of await readdir(target)) if (/^[a-f0-9]{64}$/.test(name) && !keep.has(name)) await rm(join(target, name), { recursive: true, force: true });
            });
        },
    };
    const reactBridge = {
        name: "host-react",
        setup(builder) {
            builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: "radix-ui", namespace: "host-radix" }));
            builder.onLoad({ filter: /.*/, namespace: "host-radix" }, () => ({ contents: `export const { ${Object.keys(radix).join(", ")} } = globalThis.InfiniteCanvasRuntime.radix;` }));
            builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: "react-dom", namespace: "host-react-dom" }));
            builder.onLoad({ filter: /.*/, namespace: "host-react-dom" }, () => ({ contents: `const ReactDOM = globalThis.InfiniteCanvasRuntime.reactDom; export default ReactDOM; export const { createPortal, flushSync, unstable_batchedUpdates, preconnect, prefetchDNS, preload, preloadModule, preinit, preinitModule, requestFormReset, useFormState, useFormStatus, version } = ReactDOM;` }));
            builder.onResolve({ filter: /^react(?:\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (args) => ({ path: args.path, namespace: "host-react" }));
            builder.onLoad({ filter: /^react\/jsx-runtime$/, namespace: "host-react" }, () => ({ contents: `export const { jsx, jsxs, Fragment } = globalThis.InfiniteCanvasRuntime.jsxRuntime;` }));
            builder.onLoad({ filter: /^react\/jsx-dev-runtime$/, namespace: "host-react" }, () => ({ contents: `export const { jsxDEV, Fragment } = globalThis.InfiniteCanvasRuntime.jsxDevRuntime;` }));
            builder.onLoad({ filter: /.*/, namespace: "host-react" }, () => ({ contents: `const React = globalThis.InfiniteCanvasRuntime.React; export default React; export const { Children, Component, Fragment, PureComponent, StrictMode, Suspense, cloneElement, createContext, createElement, createRef, forwardRef, isValidElement, lazy, memo, startTransition, use, useActionState, useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition } = React;` }));
        },
    };
    const options = {
        absWorkingDir: root,
        entryPoints: [join(root, overrides.entries?.client ?? "src/plugin.ts")],
        outdir: dirname(join(root, manifest.client)), entryNames: basename(manifest.client, extname(manifest.client)), chunkNames: "chunk-[hash]", assetNames: "assets/[name]-[hash]", outExtension: { ".js": extname(manifest.client) }, splitting: true, metafile: true,
        bundle: true, format: "esm", platform: "browser", target: "es2022",
        jsx: "automatic", jsxImportSource: "react",
        loader: Object.fromEntries(assets.map(ext => [ext, "file"])), minify: !watch,
        plugins: [reactBridge, clientFiles, ...(overrides.clientPlugins ?? [])],
        ...overrides.esbuild,
    };
    if (watch) await (await context(options)).watch();
    else await build(options);
}
