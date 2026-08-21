# Markdown 节点插件

DSH FreeCanvas 画布节点插件:在画布里编辑与渲染 Markdown。

## 构建

```bash
npm install
npm run build      # 产物 dist/markdown.js,并同步到 web/public/plugins/markdown.js
npm run dev        # watch,改动自动构建
```

## 安装

画布 → 左上菜单「节点插件」→ 安装 URL 填 `/plugins/markdown.js`(或托管后的公网 URL)。

## 本地开发

`npm run dev` 起 watch,在 `web/.env.local` 加 `VITE_DEV_PLUGINS=/plugins/markdown.js`,起画布后改 `src/index.jsx` 刷新页面即生效,无需反复安装。

插件契约见 `plugins/canvas/README.md`。

> 本插件演示了独立 CSS 文件用法:`src/styles.css` 经 esbuild `text` loader 打进 bundle,通过插件 `css` 字段自动注入/清理。
