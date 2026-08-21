# SVG 节点插件

DSH FreeCanvas 画布节点插件:编辑与渲染 SVG,无自身内容时自动取上游文本节点里的 SVG 源码。

## 构建

```bash
npm install
npm run build      # 产物 dist/svg.js,并同步到 web/public/plugins/svg.js
npm run dev        # watch
```

## 安装

画布 → 左上菜单「节点插件」→ 安装 URL 填 `/plugins/svg.js`(或托管后的公网 URL)。

插件契约见 `plugins/canvas/README.md`。
