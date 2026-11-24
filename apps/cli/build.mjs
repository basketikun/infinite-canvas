import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const dependencies = JSON.parse(await readFile(new URL("package.json", root), "utf8")).dependencies;
await rm(new URL("dist/", root), { recursive: true, force: true });
await mkdir(new URL("dist/", root), { recursive: true });
await build({
    entryPoints: [fileURLToPath(new URL("src/index.ts", root))],
    outfile: fileURLToPath(new URL("dist/index.js", root)),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: Object.keys(dependencies),
});
await cp(new URL("../../packages/server/agent-instructions.md", root), new URL("agent-instructions.md", root));
await cp(new URL("ui/dist/", root), new URL("dist/ui/", root), { recursive: true });
