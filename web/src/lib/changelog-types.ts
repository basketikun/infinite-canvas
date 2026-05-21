// 客户端/服务端通用类型与工具，不依赖 node:fs。
// loadChangelog 等 server-only API 留在 ./changelog.ts。
export type ChangelogEntry = {
  tag: string; // 新增 / 修复 / 调整 / 安全 / 文档 / 清理 / 工程 / ...
  text: string;
};

export type ChangelogVersion = {
  version: string; // 例如 "Unreleased"、"v0.0.11"
  date: string;    // 例如 "2026-05-21"，Unreleased 为空字符串
  entries: ChangelogEntry[];
};

// tagColor 给不同 tag 配 Ant Design 内置色。
export function tagColor(tag: string): string {
  switch (tag) {
    case "新增":
      return "green";
    case "修复":
      return "red";
    case "调整":
      return "blue";
    case "安全":
      return "gold";
    case "文档":
      return "default";
    case "清理":
    case "工程":
      return "purple";
    default:
      return "default";
  }
}
