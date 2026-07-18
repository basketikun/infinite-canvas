# 本机部署 QA 报告

## 结论

本机页面、APIFound 图片生成和火山 Seedance 视频生成均已通过真实任务验证。

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

## 已知差异

视频结果卡片显示 `1280 x 720`，但下载后的真实文件经 `ffprobe` 检查为 `640 x 640`。任务记录中的 `480p / 4s` 与真实文件相符，结果卡尺寸属于界面输入标签，不应作为真实媒体参数。

## 安全检查

- API Key 未写入源码、文档或 Git 文件。
- 浏览器自动化临时目录已加入 `.gitignore`。
- 模型配置仅保存在浏览器本地。

## 稳定生产前检查

1. 高优先级：给浏览器配置做安全备份或提供不含密钥的配置模板。
2. 高优先级：修正视频结果卡片尺寸展示，以真实媒体元数据为准。
3. 中优先级：加入失败任务一键重试，但必须避免重复计费。
4. 中优先级：补充批量任务与限流验证；当前只验证单张图片和单条视频。
5. 低优先级：若需长期后台运行，再改为 `launchd` 固定服务；当前按需启动更省资源。
