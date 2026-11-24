import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkg = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "infinite-canvas-desktop-"));
try {
    const require = createRequire(import.meta.url);
    const cliRequire = createRequire(require.resolve("@basketikun/infinite-canvas/package.json"));
    const pnpm = await import(pathToFileURL(join(dirname(cliRequire.resolve("pnpm/package.json")), "native-binary.mjs")).href);
    await cp(new URL("main.mjs", import.meta.url), join(temporary, "main.mjs"));
    await writeFile(join(temporary, "package.json"), JSON.stringify({ name: "infinite-canvas", productName: pkg.productName, version: pkg.version, type: "module", main: "main.mjs" }));
    await packager({
        dir: temporary, out: fileURLToPath(new URL("dist/", import.meta.url)), name: pkg.productName,
        appBundleId: "com.infinitecanvas.desktop", electronVersion: pkg.devDependencies.electron,
        asar: false, prune: false, overwrite: true,
        afterCopy: [async ({ buildPath }) => {
            execFileSync(pnpm.resolveInstalledBinary(), ["--filter", "@basketikun/infinite-canvas", "deploy", "--legacy", "--prod", "--ignore-scripts", join(buildPath, "cli")], {
                cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: "inherit",
            });
        }],
    });
} finally {
    await rm(temporary, { recursive: true, force: true });
}
