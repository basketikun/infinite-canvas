# 本机部署 QA 报告

## 结论

本机页面、APIFound 图片生成、火山 Seedance 视频生成和绿联 NAS WebDAV 同步均已通过真实任务验证。

## 环境

- macOS，Apple Silicon `arm64`
- Node.js `v22.22.3`
- 本机地址：`http://localhost:3000`
- Infinite Canvas：`v0.9.0`

## 图片验证

- 模型：`gpt-image-2`
- 接口：`https://apifound.com/v1/imagine2/generate`
- 数量：1 张
- 结果：成功
- 耗时：33 秒
- 真实产物：PNG，`1254 x 1254`，约 `1.7 MB`
- 页面能力：可显示、添加到资产、加入参考图、下载
- 截图：`output/playwright/apifound-image-success.png`

## 视频验证

- 模型：`doubao-seedance-2-0-mini-260615`
- 接口：`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- 提交规格：`480p / 4 秒 / 1:1`
- 结果：成功，只提交 1 次
- 任务耗时：1 分 18 秒
- 真实 MP4：H.264，`640 x 640`，24 fps，`4.096 秒`，约 `1.1 MB`
- 音频：AAC 音轨
- 截图：`output/playwright/seedance-video-success.png`
- 样片：`output/qa/seedance-480p-4s-sample.mp4`

## 视频故障修复复验（2026-07-18）

- 故障根因 1：本机 AI 代理转发浏览器的压缩声明，并继续沿用上游响应长度；响应被自动解压后，浏览器可能因长度不一致而只返回网络错误。
- 故障根因 2：火山返回的对象存储 MP4 不允许浏览器跨域读取，视频结果无法可靠保存为本地媒体。
- 修复：代理不再转发 `Accept-Encoding` 或上游 `Content-Length`；远程视频结果改由本机 AI 代理下载。
- 复验规格：`480p / 4 秒 / 9:16 / 无参考图 / 不生成音频`。
- 火山任务：`cgt-20260718120952-mllkr`，状态 `succeeded`，只提交 1 次。
- 真实 MP4：H.264，`496 x 864`，24 fps，`4.041667 秒`，`1,229,474 bytes`。
- SHA-256：`928674fd70718644f8f7abb5f46c031b7a69d17af7f5dd94d35a3ad2a8d32a1b`。
- 目视检查：0.5 秒、2.0 秒和 3.5 秒抽帧中橙猫主体一致，前行动作明确，无人物、文字或明显肢体畸变。
- 样片：`output/qa/seedance-repair-test-480p-4s.mp4`。
- 抽帧：`output/qa/seedance-repair-test-frame-0.5s.jpg`、`output/qa/seedance-repair-test-frame-2.0s.jpg`、`output/qa/seedance-repair-test-frame-3.5s.jpg`。
- 说明：生成期间另一个 Agent 导航离开画布，页面轮询被取消，因此该次画布节点记录为“任务查询失败”；火山任务和落盘 MP4 均已独立核验成功。最终 MP4 代理下载修复使用该已完成任务验证，没有再次创建付费任务。

## 已知差异

视频结果卡片显示 `1280 x 720`，但下载后的真实文件经 `ffprobe` 检查为 `640 x 640`。任务记录中的 `480p / 4s` 与真实文件相符，结果卡尺寸属于界面输入标签，不应作为真实媒体参数。

Baile 聚合渠道的首次标准 `/v1/videos` 验证成功创建并下载了 `4.096 秒` MP4，但旧代码同时发送了 `size=720x1280` 和未被该接口采用的 `resolution_name=480p`，真实文件因此为 `720x1280`。样片为 H.264、24 fps、带 AAC 音轨；首尾帧目视检查中，小猫前行和张嘴动作明确，主体稳定，无明显重影或肢体畸变。代码现已改为在竖屏 480P 时发送 New API 兼容尺寸 `480x832`；遵守单次视频测试限制，修复后未再创建第二条付费任务。

## WebDAV 验证

- NAS：绿联，`192.168.1.44:5005`
- 远程目录：`home/infinite-canvas`
- 代理限制：仅允许 `localhost` 和 RFC 1918 私有网络地址，拒绝公网目标。
- 页面连接测试：成功。
- 页面同步：画布、我的资产、生图工作台、视频创作台四个业务域全部完成。
- NAS 读回：四个业务目录的 `manifest.json` 均返回有效 JSON，`app` 为 `infinite-canvas`、版本为 `1`。
- 测试浏览器为空白环境，因此本次清单中的项目、资产、记录和媒体文件数量均为 `0`；目录创建、清单上传和读回链路已真实验证。

## 安全检查

- API Key 未写入源码、文档或 Git 文件。
- 浏览器自动化临时目录已加入 `.gitignore`。
- 模型配置仅保存在浏览器本地。
- WebDAV 用户名和密码未写入源码、文档或 Git 文件。

## 稳定生产前检查

1. 高优先级：给浏览器配置做安全备份或提供不含密钥的配置模板。
2. 高优先级：修正视频结果卡片尺寸展示，以真实媒体元数据为准。
3. 中优先级：加入失败任务一键重试，但必须避免重复计费。
4. 中优先级：补充批量任务与限流验证；当前只验证单张图片和单条视频。
5. 低优先级：若需长期后台运行，再改为 `launchd` 固定服务；当前按需启动更省资源。
