# Director Export Service

本地 Web 导出服务，接收 Blockout Web 的原始 RGBA 帧并调用系统 FFmpeg 生成 MP4，同时保存 PNG、Prompt、Metadata、ComfyUI、GLB/glTF 等导出文件。

```powershell
cd director-export-service
npm start
```

默认监听 `127.0.0.1:8787`，可通过 `DIRECTOR_EXPORT_PORT`、`DIRECTOR_FFMPEG` 和 `DIRECTOR_EXPORT_ROOT` 覆盖。服务只绑定本机回环地址；浏览器桥接会通过 CORS 调用它。
