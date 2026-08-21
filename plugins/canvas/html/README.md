# HTML 节点插件

DSH FreeCanvas 画布节点插件:用沙箱 iframe 渲染 HTML。源码里的 `{{input}}` 会被替换为上游文本节点内容。

## 构建

```bash
npm install
npm run build      # 产物 dist/html.js,并同步到 web/public/plugins/html.js
npm run dev        # watch
```

## 安装

画布 → 左上菜单「节点插件」→ 安装 URL 填 `/plugins/html.js`(或托管后的公网 URL)。

插件契约见 `plugins/canvas/README.md`。
