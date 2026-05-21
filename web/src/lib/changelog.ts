// 这个模块仅供 server component / Route Handler 使用，依赖 node:fs。
// client component 引入会触发 webpack/turbopack 报错；类型和纯工具请走 ./changelog-types。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ChangelogEntry, ChangelogVersion } from "./changelog-types";

export type { ChangelogEntry, ChangelogVersion } from "./changelog-types";
export { tagColor } from "./changelog-types";

// loadChangelog 在 server 端读取根目录 CHANGELOG.md 并解析成结构化版本数据。
// 不引入 markdown 渲染器，因为 CHANGELOG 的结构非常规整：
//   ## v0.0.x - YYYY-MM-DD
//   + [tag] 一句话描述...
// 子级缩进的 "- 多行细节" 会拼接到上一条 entry 的 text 后面。
export function loadChangelog(): ChangelogVersion[] {
  const path = resolve(process.cwd(), "..", "CHANGELOG.md");
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseChangelog(raw);
}

export function parseChangelog(raw: string): ChangelogVersion[] {
  const sections = raw.split(/^## /m).slice(1);
  const versions: ChangelogVersion[] = [];
  for (const section of sections) {
    const lines = section.split("\n");
    const head = lines.shift() || "";
    const [versionRaw, dateRaw] = head.split(" - ");
    const version = versionRaw.trim();
    if (!version) continue;
    const date = dateRaw?.trim() || "";
    const entries: ChangelogEntry[] = [];
    for (const line of lines) {
      const itemMatch = line.match(/^\+\s+(.+)$/);
      if (itemMatch) {
        const body = itemMatch[1];
        const tagMatch = body.match(/^\[(.+?)\]\s*(.+)$/);
        entries.push(
          tagMatch
            ? { tag: tagMatch[1].trim(), text: tagMatch[2].trim() }
            : { tag: "", text: body.trim() },
        );
        continue;
      }
      // 缩进的子条目（如 "  - 图片节点：..."）追加到上一条
      const subMatch = line.match(/^\s+-\s+(.+)$/);
      if (subMatch && entries.length) {
        const last = entries[entries.length - 1];
        last.text = `${last.text}\n${subMatch[1].trim()}`;
      }
    }
    if (entries.length) versions.push({ version, date, entries });
  }
  return versions;
}
