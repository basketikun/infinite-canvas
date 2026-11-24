// 把已打包的插件加入插件源目录并更新 index.json。
// 用法：node scripts/publish-plugin-index.mjs <tgz 目录> <插件源目录> <插件目录>...
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [artifacts, target, ...pluginDirs] = process.argv.slice(2);
const major = Number(readFileSync("VERSION", "utf8").trim().replace(/^v/, "").split(".")[0]);
const host = `>=${major}.0.0 <${major + 1}.0.0`;
const pluginApi = Number(/PLUGIN_API_VERSION = (\d+)/.exec(readFileSync("packages/shared/src/plugins.ts", "utf8"))[1]);
const indexFile = join(target, "index.json");
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { version: 1, plugins: [] };

for (const dir of pluginDirs) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const meta = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
    const folder = `packages/${pkg.name}/${pkg.version}`;
    const tarball = `${folder}/${pkg.name}-${pkg.version}.tgz`;
    let entry = index.plugins.find((item) => item.name === pkg.name);
    if (!entry) index.plugins.push(entry = { name: pkg.name, title: meta.name, versions: {} });
    if (entry.versions[pkg.version]) throw new Error(`${pkg.name}@${pkg.version} 已发布，请先提升版本号`);
    mkdirSync(join(target, folder), { recursive: true });
    copyFileSync(join(artifacts, `${pkg.name}-${pkg.version}.tgz`), join(target, tarball));
    const integrity = `sha512-${createHash("sha512").update(readFileSync(join(target, tarball))).digest("base64")}`;
    const icon = ["icon.svg", "icon.png", "icon.webp"].find((file) => existsSync(join(dir, file)));
    if (icon) copyFileSync(join(dir, icon), join(target, folder, icon));
    Object.assign(entry, { title: meta.name, description: meta.description, author: meta.author, icon: icon && `${folder}/${icon}` });
    entry.versions[pkg.version] = { tarball, integrity, host, pluginApi };
}

index.plugins.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
