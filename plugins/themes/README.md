# 主题插件

提供「默认亮色」「默认暗色」以及 Catppuccin Latte / Mocha、Tokyo Night、Nord、Gruvbox Dark、Dracula、Rosé Pine / Dawn、Solarized Light、GitHub Light 共十二个主题，和一个「侧栏导航」布局。它们登记到 `themes` 与 `layouts` 扩展点，由宿主「设置 → 外观」统一列出和选择。默认主题直接使用宿主原始配色。

插件自身只保留两项设置（`settings` 标签）：自定义配色，保存后重新登记对应主题；导航入口的显隐与排序，通过 `navigation` 变换生效。

## 开发

在仓库根目录执行 `pnpm install`，然后 `pnpm --dir plugins/themes dev`。开发产物自动同步到工作台插件目录，在「设置 → 插件」启用「主题」。修改后使用插件的重新加载操作。

## 配色来源

新增十套主题的背景、文字和强调色取自 [Jiqize 的 PR #294](https://github.com/basketikun/infinite-canvas/pull/294)，其余语义色按当前插件结构补充。保留原主题名称以便识别；未引入原 PR 的主应用改动或 Ghostty 导入功能。
