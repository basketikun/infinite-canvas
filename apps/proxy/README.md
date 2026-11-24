# @basketikun/canvas-proxy

Infinite Canvas 的本地转发代理。浏览器直连第三方 AI 接口时经常被 CORS 拦截，启动它之后，网页会把请求先发到本机，再由本机转发到目标地址。

代理只做转发：不改写请求体，不校验 API Key，不落盘任何日志。

## 使用

```bash
npx @basketikun/canvas-proxy@latest
```

默认监听 `http://127.0.0.1:23210`。把这个地址填进 Infinite Canvas 的「配置 → 本地代理」，并打开开关即可。

带上 `@latest` 是因为 npx 会缓存已下载的版本，不加就可能一直运行旧版本。

可选参数：

```bash
npx @basketikun/canvas-proxy@latest --port 23210 --host 127.0.0.1
```

也支持 `PORT` / `HOST` 环境变量。

## 转发规则

把完整目标地址接在代理地址后面：

```
http://127.0.0.1:23210/https://api.openai.com/v1/models
        └─── 代理地址 ──┘└──────── 目标地址 ────────┘
```

请求方法、请求头（除 `host` 等逐跳头外）、请求体原样转发；响应状态码、响应头和响应体原样返回，并补上宽松的 CORS 头。SSE 流式响应按块透传，不做缓冲。

访问根路径 `/` 会返回代理版本信息，可用于连通性检测，不会记入转发日志。

同步使用独立路径 `/_sync/<encodeURIComponent(完整目标地址)>`。代理只解开外层编码，保留文件名中的百分号和目标地址内已编码的路径段。同步请求可以携带远端所需的认证头；本机 Cookie、工作区口令和代理认证头会被移除，上游的 `Set-Cookie` 也不会返回。远端要求跳转时同步停止，请在连接设置中填写最终服务地址。

同步响应带 `x-canvas-sync-proxy: 1`。旧代理会对陌生路径返回普通版本信息，工作台会停止本次操作；遇到这种情况请用上方命令启动新版代理再重试。实际的 `OPTIONS` 探测会转发给所选服务，浏览器附有 `Access-Control-Request-Method` 的跨域预检由代理直接应答。取消同步时已发出的网络读取也会中止。

## 转发日志

每转发一条请求就在终端打印一行，包含时间、方法、完整目标地址、上游状态码和耗时：

```
4:05:42 PM GET https://api.openai.com/v1/models -> 200 0.9s
4:05:43 PM POST https://api.openai.com/v1/images/generations -> 200 26.4s
4:05:45 PM GET https://api.example.com/v1/models -> failed (fetch failed) 1.6s
```

日志在收到上游响应头时打印，所以流式请求会立刻出现一行，而不是等整段响应结束。终端日志包含目标 URL，不记录请求头或请求体。分享日志前请检查 URL 中的签名和敏感参数。

## 安全提示

代理默认只监听 `127.0.0.1`，仅本机可访问。它会转发任何请求到任何地址，请不要用 `--host 0.0.0.0` 暴露到公网。API Key 依然由浏览器持有并随请求转发，代理本身不存储。

## 环境要求

Node.js >= 18。
