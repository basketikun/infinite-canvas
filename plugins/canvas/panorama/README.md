# 3D 全景节点插件

DSH FreeCanvas 画布节点插件:查看 360° 等距柱状(equirectangular)全景图,可拖拽旋转。可从上游图片节点自动取图。three.js 运行时从 CDN 按需加载,不打进插件体积。

## 构建

```bash
npm install
npm run build      # 产物 dist/panorama.js,并同步到 web/public/plugins/panorama.js
npm run dev        # watch
```

## 安装

画布 → 左上菜单「节点插件」→ 安装 URL 填 `/plugins/panorama.js`(或托管后的公网 URL)。连接一个全景图片节点到本节点即可查看。

插件契约见 `plugins/canvas/README.md`。
