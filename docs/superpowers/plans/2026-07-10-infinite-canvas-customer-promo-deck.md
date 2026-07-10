# 无限创作 AI 内容生产平台客户宣传 PPT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一套 12 页的客户宣传演示，交付可播放真实视频的 HTML、可编辑 PPTX 和 10/20 分钟讲解稿。

**Architecture:** 所有成品与媒体放在 `D:\AI\workspace\output\infinite-canvas-customer-promo`，不修改无限画布源码。使用 Dashiai PPT `theme02` 的 12 个唯一页面组件，通过真实官方截图、当前视频创作台截图、用户提供的真实视频和 1 张 AI 概念主视觉完成内容填充；先生成并验证 HTML，再导出 PPTX。

**Tech Stack:** Dashiai PPT 0.1.36、Node.js 24.9.0、npm 11.6.0、FFmpeg/FFprobe、Codex Browser、OpenAI imagegen。

---

## File Map

**Reference:**

- `D:\AI\workspace\有趣小项目\infinite-canvas\docs\superpowers\specs\2026-07-10-infinite-canvas-customer-promo-deck-design.md`：已批准的内容与验收规格。
- `D:\AI\workspace\有趣小项目\infinite-canvas\README.md`：产品定位、功能和官方截图来源。
- `D:\AI\workspace\有趣小项目\infinite-canvas\docs\content\docs\business\license.mdx`：AGPL-3.0 与商业授权边界。
- `$env:USERPROFILE\Downloads\result.mp4`：真实视频案例源文件。

**Create:**

- `D:\AI\workspace\output\infinite-canvas-customer-promo\goal.json`：Dashiai PPT 的完整 12 页计划。
- `D:\AI\workspace\output\infinite-canvas-customer-promo\speaker-notes.md`：10 分钟和 20 分钟讲解词。
- `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\`：命名稳定的原始媒体。
- `D:\AI\workspace\output\infinite-canvas-customer-promo\ppt\index.html`：可编辑 HTML 演示。
- `D:\AI\workspace\output\infinite-canvas-customer-promo\ppt\assets\user-media\`：已登记的演示媒体。
- `D:\AI\workspace\output\infinite-canvas-customer-promo\exports\infinite-canvas-customer-promo.pptx`：可编辑 PPTX。

**Do not modify:**

- `D:\AI\workspace\有趣小项目\infinite-canvas\web\` 下的任何源码或用户已有改动。
- Dashiai PPT 的模板组件、CSS、manifest 和生成器源码。

## Locked Layout Map

| Page | Purpose | Layout |
|---|---|---|
| 1 | 封面 | `theme02_page004` |
| 2 | 客户困境 | `theme02_page051` |
| 3 | 产品愿景 | `theme02_page055` |
| 4 | 平台全景 | `theme02_page065` |
| 5 | 核心工作流 | `theme02_page044` |
| 6 | 真实产品展示 | `theme02_page029` |
| 7 | AI 协同创作 | `theme02_page013` |
| 8 | 多模态与真实视频 | `theme02_page053` |
| 9 | 多行业场景 | `theme02_page015` |
| 10 | 开放技术底座 | `theme02_page018` |
| 11 | 演进路线 | `theme02_page056` |
| 12 | 行动邀请 | `theme02_page074` |

### Task 1: Verify Inputs And Prepare Output

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\`
- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\exports\`

- [ ] **Step 1: Verify the approved spec, video source, runtime, and local app**

Run in PowerShell:

```powershell
$spec = 'D:\AI\workspace\有趣小项目\infinite-canvas\docs\superpowers\specs\2026-07-10-infinite-canvas-customer-promo-deck-design.md'
$video = Join-Path $env:USERPROFILE 'Downloads\result.mp4'
Get-Item -LiteralPath $spec, $video | Select-Object FullName, Length
node -v
npm.cmd -v
ffmpeg -version | Select-Object -First 1
ffprobe -version | Select-Object -First 1
(Invoke-WebRequest -Uri 'http://127.0.0.1:3001/video' -UseBasicParsing).StatusCode
```

Expected: both files exist; Node reports `v24.9.0`; npm reports `11.6.0`; FFmpeg and FFprobe respond; the local video page returns HTTP `200`.

- [ ] **Step 2: Create a clean request-specific output directory**

Run:

```powershell
$deck = 'D:\AI\workspace\output\infinite-canvas-customer-promo'
if (Test-Path -LiteralPath $deck) {
  throw "Request-specific output already exists: $deck. Rename the old directory before continuing; do not reuse an earlier goal or rendered deck."
}
New-Item -ItemType Directory -Force -Path $deck, "$deck\source-media", "$deck\exports" | Out-Null
Get-ChildItem -LiteralPath $deck
```

Expected: only the request-specific `source-media` and `exports` directories are present before media preparation.

- [ ] **Step 3: Install the Dashiai runtime dependencies if missing**

Run:

```powershell
$dashi = 'C:\Users\10430\.codex\skills\dashiai-ppt\project'
npm.cmd --prefix $dashi install
```

Expected: command exits `0` and `C:\Users\10430\.codex\skills\dashiai-ppt\project\node_modules` exists.

### Task 2: Prepare The Real Video Case

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\result.mp4`
- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\video-frame-01.png`
- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\video-frame-02.png`
- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\video-frame-03.png`

- [ ] **Step 1: Copy the user-provided video without transcoding**

Run:

```powershell
$deck = 'D:\AI\workspace\output\infinite-canvas-customer-promo'
Copy-Item -LiteralPath (Join-Path $env:USERPROFILE 'Downloads\result.mp4') -Destination "$deck\source-media\result.mp4" -Force
```

Expected: the copied file remains approximately 6.7 MB.

- [ ] **Step 2: Verify the copied video contract**

Run:

```powershell
ffprobe -v error -show_entries format=duration,size:stream=codec_name,codec_type,width,height -of json 'D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\result.mp4'
```

Expected: duration is about `12.096`, video is H.264 at `720x1280`, and audio is AAC.

- [ ] **Step 3: Extract three representative keyframes**

Run:

```powershell
$video = 'D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\result.mp4'
$media = 'D:\AI\workspace\output\infinite-canvas-customer-promo\source-media'
ffmpeg -y -ss 00:00:01 -i $video -frames:v 1 "$media\video-frame-01.png"
ffmpeg -y -ss 00:00:06 -i $video -frames:v 1 "$media\video-frame-02.png"
ffmpeg -y -ss 00:00:11 -i $video -frames:v 1 "$media\video-frame-03.png"
```

Expected: three non-empty PNG files with portrait orientation.

- [ ] **Step 4: Inspect the extracted frames**

Open all three images with the local image viewer. Reject a frame only if it is black, blurred by a transition, or duplicates another frame; if rejected, re-extract at `00:00:02`, `00:00:07`, or `00:00:10` respectively.

### Task 3: Collect Verified Product Screenshots

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\official-01.png` through `official-08.png`
- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\video-workbench.png`

- [ ] **Step 1: Download the eight official README screenshots**

Run:

```powershell
$media = 'D:\AI\workspace\output\infinite-canvas-customer-promo\source-media'
$urls = @(
  'https://i.ibb.co/TDFvGWDT/image.png',
  'https://i.ibb.co/zVwJq3YS/image.png',
  'https://i.ibb.co/PvY3qhhK/image.png',
  'https://i.ibb.co/7D04LwN/image.png',
  'https://i.ibb.co/bj30FtS5/5.png',
  'https://i.ibb.co/hxRvjw51/image.png',
  'https://i.ibb.co/jkWsF8q1/image.png',
  'https://i.ibb.co/XrnfXHx7/image.png'
)
for ($i = 0; $i -lt $urls.Count; $i++) {
  Invoke-WebRequest -Uri $urls[$i] -OutFile (Join-Path $media ('official-{0:d2}.png' -f ($i + 1))) -UseBasicParsing
}
```

Expected: eight PNG files are downloaded successfully.

- [ ] **Step 2: Confirm the screenshot-to-page mapping**

Use these verified mappings:

```text
official-01.png = 文案节点与生成配置
official-02.png = 一次生成形成多结果分支
official-03.png = 参考与结果节点连接
official-04.png = 复杂画布与多级生成关系
official-05.png = 素材沉淀与提示词展示页
official-06.png = 提示词中心
official-07.png = Agent 操作画布
official-08.png = Agent 读取画布内容
```

Expected: captions describe visible product state and do not invent features outside each screenshot.

- [ ] **Step 3: Capture the current video workbench UI**

Use the Browser skill to open `http://localhost:3001/video`, verify the title is “无限画布”, and save a viewport screenshot to:

```text
D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\video-workbench.png
```

The screenshot may show zero browser-local records. It is used only to show the real video creation interface, not as evidence of a saved generation record.

### Task 4: Generate The Single Concept Visual And Stage Media

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\source-media\cover-hero.png`
- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\ppt\assets\user-media\*`

- [ ] **Step 1: Generate one cover image using the imagegen skill**

Use this exact prompt:

```text
Create a cinematic 16:9 hero image for an enterprise AI content creation platform presentation. Show a vast dark infinite digital canvas receding into depth, with connected floating content nodes containing abstract image thumbnails, prompt cards, video frames, and subtle workflow links. The central canvas should feel inspectable and real, not like a fantasy landscape. Use restrained emerald green and electric blue highlights on a near-black background, with crisp professional lighting, high contrast, clean negative space in the lower-left for Chinese presentation text, no logos, no readable text, no people, no purple-dominated palette, no bokeh or decorative orbs. Premium technology launch aesthetic, realistic interface-inspired composition, 16:9.
```

Save the final bitmap as `cover-hero.png`. Do not generate additional independent concept images.

- [ ] **Step 2: Inspect the concept visual**

Verify the image is 16:9, has clear lower-left text space, contains no readable text or logos, and visually matches the `theme02` green/blue palette.

- [ ] **Step 3: Stage every media file through Dashiai**

Run:

```powershell
$dashi = 'C:\Users\10430\.codex\skills\dashiai-ppt\project'
$deck = 'D:\AI\workspace\output\infinite-canvas-customer-promo'
$media = "$deck\source-media"
$files = Get-ChildItem -LiteralPath $media -File | Select-Object -ExpandProperty FullName
npm.cmd --prefix $dashi run media:stage -- $deck @files
```

Expected: each file is reported under `ppt/assets/user-media/`; `result.mp4` also receives a poster sibling when supported.

- [ ] **Step 4: Verify staged assets**

Run:

```powershell
Get-ChildItem -LiteralPath 'D:\AI\workspace\output\infinite-canvas-customer-promo\ppt\assets\user-media' -File | Select-Object Name, Length
```

Expected: `cover-hero.png`, eight official screenshots, `video-workbench.png`, three video frames, and `result.mp4` are present.

### Task 5: Build The Twelve-Page Goal

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\goal.json`

- [ ] **Step 1: Scaffold the 12-page theme02 goal**

Run:

```powershell
$dashi = 'C:\Users\10430\.codex\skills\dashiai-ppt\project'
$goal = 'D:\AI\workspace\output\infinite-canvas-customer-promo\goal.json'
npm.cmd --prefix $dashi run goal:scaffold -- --title '无限创作 AI 内容生产平台' --goal '面向综合型客户介绍连续 AI 内容生产工作流、真实产品能力、开放技术底座与合作路线' --theme theme02 --pages 12 --chunk-size 5 --out $goal
```

Expected: `goal.json` and `goal.fill-plan.json` are created.

- [ ] **Step 2: Replace the scaffold with the approved concrete goal**

Write exactly this JSON, preserving valid JSON syntax:

```json
{
  "title": "无限创作 AI 内容生产平台",
  "goal": "面向综合型客户介绍连续 AI 内容生产工作流、真实产品能力、开放技术底座与合作路线",
  "audience": "企业决策者、品牌营销负责人、内容创作团队、技术负责人和渠道伙伴",
  "owner": "产品与解决方案团队",
  "randomSeed": "theme02-20260710-canvas",
  "pageCount": 12,
  "themePack": "theme02",
  "slides": [
    {
      "layout": "theme02_page004",
      "props": {
        "kicker": "AI CONTENT PLATFORM",
        "title": "无限创作",
        "titleEm": "AI 内容生产平台",
        "quote": "让创意、生成与迭代发生在同一张画布",
        "metas": [
          {"value": "10 MIN", "label": "快速介绍"},
          {"value": "20 MIN", "label": "方案讲解"},
          {"value": "OPEN", "label": "开放底座"}
        ],
        "caption": "基于 Infinite Canvas 开源技术底座",
        "index": "01",
        "imageCount": 1,
        "images": ["assets/user-media/cover-hero.png"]
      }
    },
    {
      "layout": "theme02_page051",
      "props": {
        "kicker": "01 / 内容生产困境",
        "title": "工具越来越多",
        "titleEm": "流程却更割裂",
        "leftTag": "传统方式",
        "rightTag": "连续创作",
        "leftPoints": ["提示词散落在不同工具", "参考素材与结果彼此分离", "修改过程难以回看和复用"],
        "rightPoints": ["需求与素材留在同一空间", "生成分支可以持续比较", "优秀方案沉淀为内容资产"],
        "leftStat": {"value": "分散", "unit": "工作状态", "caption": "上下文在切换工具时不断丢失"},
        "rightStat": {"value": "连续", "unit": "创作过程", "caption": "画布保留结果，也保留演化路径"},
        "index": "02"
      }
    },
    {
      "layout": "theme02_page055",
      "props": {
        "kicker": "02 / 产品愿景",
        "claims": [
          {"lead": "让每一次灵感", "em": "可见", "tail": "不再转瞬即逝"},
          {"lead": "让每一轮生成", "em": "可追溯", "tail": "不再成为孤岛"},
          {"lead": "让优秀方案", "em": "可复用", "tail": "持续沉淀为资产"}
        ],
        "footnote": "画布记录结果，也记录创意如何一步步演化",
        "index": "03"
      }
    },
    {
      "layout": "theme02_page065",
      "props": {
        "kicker": "03 / 平台全景",
        "title": "一张画布连接",
        "titleEm": "完整创作能力",
        "index": "04",
        "center": {"label": "无限画布", "sub": "统一承载创作上下文"},
        "nodes": [
          {"label": "AI 图像", "desc": "文生图、图生图与参考图编辑"},
          {"label": "画布助手", "desc": "围绕选中节点持续问答与创作"},
          {"label": "提示与素材", "desc": "提示词查询、缓存和素材沉淀"},
          {"label": "多模态入口", "desc": "文本、音频与视频生成链路"},
          {"label": "Agent 接入", "desc": "通过本地 Agent 连接开发工具"}
        ]
      }
    },
    {
      "layout": "theme02_page044",
      "props": {
        "kicker": "04 / 核心工作流",
        "title": "从需求到成品",
        "titleEm": "形成连续创作闭环",
        "steps": [
          {"title": "需求与参考", "desc": "把目标、提示词和参考素材放进画布"},
          {"title": "多分支生成", "desc": "围绕同一方向探索多个视觉结果"},
          {"title": "对比与迭代", "desc": "沿节点关系继续修改、扩展和组合"},
          {"title": "选定与沉淀", "desc": "导出成品，并保留可复用的创作路径"}
        ],
        "index": "05"
      }
    },
    {
      "layout": "theme02_page029",
      "props": {
        "kicker": "05 / 真实产品展示",
        "title": "复杂创作过程",
        "titleEm": "在画布中保持清晰",
        "lead": "节点、连线、分支和全局视图共同呈现创意如何从输入走向结果。",
        "captions": ["节点式编排", "多结果分支", "参考与结果连接", "全局画布视图"],
        "index": "06",
        "imageCount": 4,
        "images": [
          "assets/user-media/official-01.png",
          "assets/user-media/official-02.png",
          "assets/user-media/official-03.png",
          "assets/user-media/official-04.png"
        ]
      }
    },
    {
      "layout": "theme02_page013",
      "props": {
        "kicker": "06 / AI 协同创作",
        "title": "从节点走向",
        "titleEm": "可扩展工作流",
        "lead": "画布助手、提示词资源、素材沉淀和多模态入口共同服务于当前创作上下文。",
        "captions": ["内容资产沉淀", "提示词灵感中心", "Agent 操作画布", "读取画布上下文", "视频创作入口"],
        "stat": {"value": "OPEN", "unit": "开放连接", "caption": "能力可以围绕真实场景继续扩展"},
        "tags": ["上下文理解", "工具调用", "多模态扩展"],
        "index": "07",
        "imageCount": 5,
        "images": [
          "assets/user-media/official-05.png",
          "assets/user-media/official-06.png",
          "assets/user-media/official-07.png",
          "assets/user-media/official-08.png",
          "assets/user-media/video-workbench.png"
        ]
      }
    },
    {
      "layout": "theme02_page053",
      "props": {
        "kicker": "07 / 真实视频案例",
        "title": "一条真实视频生成链路",
        "titleEm": "12 秒竖屏成片",
        "lead": "使用真实生成结果展示从提示、模型配置到视频输出的多模态链路。",
        "steps": [
          {"tag": "INPUT", "title": "描述镜头", "note": "明确主体动作、镜头运动和氛围"},
          {"tag": "MODEL", "title": "选择模型", "note": "按渠道能力设置尺寸、清晰度和时长"},
          {"tag": "GENERATE", "title": "提交生成", "note": "通过兼容接口进入视频生成任务"},
          {"tag": "RESULT", "title": "获得成片", "note": "HTML 中播放，PPTX 中展示关键帧"}
        ],
        "index": "08",
        "imageCount": 4,
        "images": [
          {"src": "assets/user-media/result.mp4", "kind": "video"},
          "assets/user-media/video-frame-01.png",
          "assets/user-media/video-frame-02.png",
          "assets/user-media/video-frame-03.png"
        ]
      }
    },
    {
      "layout": "theme02_page015",
      "props": {
        "kicker": "08 / 多行业场景",
        "title": "同一创作底座",
        "titleEm": "适配不同内容任务",
        "axes": {"x": "创作复杂度", "y": "内容频率", "xLow": "单点任务", "xHigh": "复杂流程", "yLow": "低频项目", "yHigh": "高频生产"},
        "quadrants": [
          {"label": "电商与品牌", "desc": "面向高频营销物料持续探索视觉方案", "items": ["商品主图", "活动海报", "视觉延展", "多版探索"]},
          {"label": "广告与设计", "desc": "围绕创意方向组织参考与提案过程", "items": ["参考管理", "方向对比", "提案沉淀"]},
          {"label": "短视频与新媒体", "desc": "衔接画面设定、素材和视频生成", "items": ["分镜设定", "视频生成", "素材复用"]},
          {"label": "企业内容", "desc": "支持通用宣传和内容资产整理", "items": ["产品介绍", "内部传播"]}
        ],
        "index": "09"
      }
    },
    {
      "layout": "theme02_page018",
      "props": {
        "kicker": "09 / 开放技术底座",
        "title": "模型、数据与部署",
        "titleEm": "由客户掌控",
        "layers": [
          {
            "tier": "体验层",
            "label": "浏览器工作台",
            "note": "统一承载画布编排、内容生成和资源管理",
            "segments": [
              {"name": "画布工作台", "companies": ["节点编排", "提示词库", "素材管理"]},
              {"name": "多模态入口", "companies": ["图片生成", "音频生成", "视频生成"]}
            ]
          },
          {
            "tier": "连接层",
            "label": "开放接口",
            "note": "连接兼容模型服务与本地 Agent 工具链",
            "segments": [
              {"name": "OpenAI 兼容", "companies": ["模型列表", "响应接口", "图像接口"]},
              {"name": "Agent 连接", "companies": ["Canvas Agent", "Codex", "Claude Code"]}
            ]
          },
          {
            "tier": "数据与部署",
            "label": "客户掌控",
            "note": "默认浏览器本地保存，并支持部署与同步扩展",
            "segments": [
              {"name": "本地数据", "companies": ["画布项目", "素材记录", "API 配置"]},
              {"name": "同步扩展", "companies": ["WebDAV", "导入导出", "浏览器缓存"]},
              {"name": "部署方式", "companies": ["静态站点", "Docker", "私有化评估"]}
            ]
          }
        ],
        "index": "10"
      }
    },
    {
      "layout": "theme02_page056",
      "props": {
        "kicker": "10 / 演进路线与合作",
        "title": "从体验验证",
        "titleEm": "走向行业方案",
        "lead": "以真实场景为起点，逐步完成模型、流程和交付方式的共同定义。",
        "phases": [
          {"period": "PHASE 01", "title": "体验与验证", "desc": "现场演示、需求梳理和关键场景验证"},
          {"period": "PHASE 02", "title": "接入与定制", "desc": "模型渠道、画布节点和内容流程定制"},
          {"period": "PHASE 03", "title": "方案共建", "desc": "围绕行业任务评估部署、支持与交付模式"}
        ],
        "index": "11"
      }
    },
    {
      "layout": "theme02_page074",
      "props": {
        "kicker": "NEXT STEP",
        "ghost": "CREATE",
        "statement": "让下一次内容生产",
        "statementEm": "从一张画布开始",
        "sub": "预约演示、申请体验，或一起讨论模型接入、部署与定制方案。",
        "signature": {"org": "无限创作 AI 内容生产平台", "date": "客户宣传演示", "note": "预约演示 / 申请体验 / 方案沟通"},
        "index": "12"
      }
    }
  ]
}
```

- [ ] **Step 3: Run safe-props normalization and inspect layout changes**

Run:

```powershell
$dashi = 'C:\Users\10430\.codex\skills\dashiai-ppt\project'
$goal = 'D:\AI\workspace\output\infinite-canvas-customer-promo\goal.json'
npm.cmd --prefix $dashi run props:safe -- --goal $goal --write
```

Expected: no selected layout is silently replaced. If `layoutChanges` is non-empty, restore the locked layout and fix the offending props using `inspect:layout`.

- [ ] **Step 4: Validate the goal contract**

Run:

```powershell
npm.cmd --prefix 'C:\Users\10430\.codex\skills\dashiai-ppt\project' run validate:goal-spec -- 'D:\AI\workspace\output\infinite-canvas-customer-promo\goal.json'
```

Expected: validation exits `0` with no copy-budget, array-shape, media-path, or free-HTML errors.

### Task 6: Write The Speaker Notes

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\speaker-notes.md`

- [ ] **Step 1: Write the page-by-page master script**

The file must include these page messages:

```markdown
# 无限创作 AI 内容生产平台讲解稿

## 第 1 页：开场
我们不是再增加一个生成工具，而是让需求、参考素材、生成结果和修改过程进入同一个连续空间。

## 第 2 页：客户困境
真正影响内容生产效率的，不只是模型能力，而是每次切换工具都会丢失上下文，好的结果也很难回到原来的创作路径中。

## 第 3 页：产品愿景
无限画布让创意过程变得可见、可追溯、可复用。画布保存的不只是最终图片，也保存方案如何一步步演化。

## 第 4 页：平台全景
平台围绕同一张画布连接图像生成、助手、提示词、素材、多模态入口和本地 Agent，减少工具之间的断点。

## 第 5 页：核心工作流
从需求和参考开始，形成多个生成分支，在画布中继续比较、修改和组合，最后导出成品并保留可复用路径。

## 第 6 页：真实产品
这里展示的都是项目真实界面。节点和连线让创作关系保持清晰，小地图和全局视图帮助用户管理更复杂的探索过程。

## 第 7 页：AI 协同创作
助手可以围绕当前画布和选中节点继续工作，提示词、素材和多模态入口则为这个上下文补充更多资源与工具。

## 第 8 页：真实视频案例
这是平台链路中真实生成的 12 秒竖屏视频。重点不是展示大量作品，而是证明从描述、模型配置到视频结果已经能够形成实际链路。

## 第 9 页：行业场景
不同产业的内容任务不同，但底层都需要管理需求、参考、生成结果和迭代关系，因此可以共用同一套画布式工作方式。

## 第 10 页：技术底座
平台通过浏览器连接 OpenAI 兼容接口，API 配置和业务数据默认保存在浏览器本地。部署和同步方式可以继续评估，但不把当前版本包装成成熟公网多人 SaaS。

## 第 11 页：合作路线
合作从演示和场景验证开始，再进入模型接入与流程定制，最终根据行业任务共同定义部署、支持和交付方式。

## 第 12 页：行动邀请
下一步可以预约演示、申请体验，或直接讨论需要接入的模型、部署环境和定制流程。

## 10 分钟路径
讲第 1-7、9、12 页；第 8 页视频最多播放 30 秒；第 10-11 页作为问答备用。

## 20 分钟路径
完整讲解 12 页；第 6 页安排约 3 分钟产品展示，第 8 页播放视频并讲生成链路，第 10 页安排约 2 分钟技术说明。
```

- [ ] **Step 2: Scan the notes for unsupported claims**

Run:

```powershell
rg -n '提升\d+%|客户数量|行业第一|成熟 SaaS|云端同步|多人实时协作|独立原创' 'D:\AI\workspace\output\infinite-canvas-customer-promo\speaker-notes.md'
```

Expected: no matches.

### Task 7: Render And Validate The HTML Deck

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\ppt\index.html`

- [ ] **Step 1: Render the goal on Windows using the commands from the Dashiai render script**

Run in order:

```powershell
$dashi = 'C:\Users\10430\.codex\skills\dashiai-ppt\project'
$goal = 'D:\AI\workspace\output\infinite-canvas-customer-promo\goal.json'
$html = 'D:\AI\workspace\output\infinite-canvas-customer-promo\ppt\index.html'
npm.cmd --prefix $dashi run props:safe -- --goal $goal --write
npm.cmd --prefix $dashi run validate:goal-spec -- $goal
npm.cmd --prefix $dashi run render:goal -- $goal $html
npm.cmd --prefix $dashi run validate:swiss -- $html
npm.cmd --prefix $dashi run validate:goal-copy -- $goal $html
```

Expected: all five commands exit `0`.

- [ ] **Step 2: Verify media references and template-copy cleanliness**

Run:

```powershell
$deck = 'D:\AI\workspace\output\infinite-canvas-customer-promo'
$html = Get-Content -Raw -LiteralPath "$deck\ppt\index.html"
$required = @('cover-hero.png','official-01.png','official-08.png','video-workbench.png','result.mp4','video-frame-03.png')
$required | ForEach-Object { [pscustomobject]@{File=$_;Referenced=$html.Contains($_);Exists=(Test-Path -LiteralPath "$deck\ppt\assets\user-media\$_")} }
rg -n 'AI Capital|投融资|SoundWave|声浪|Key Metrics|Roadmap|End of Report|请输入文本' "$deck\ppt\index.html"
```

Expected: all required media report `Referenced=True` and `Exists=True`; the contamination scan returns no matches.

- [ ] **Step 3: Start the Dashiai preview server on port 5320**

Run:

```powershell
$dashi = 'C:\Users\10430\.codex\skills\dashiai-ppt\project'
$ppt = 'D:\AI\workspace\output\infinite-canvas-customer-promo\ppt'
$logs = 'D:\AI\workspace\output\infinite-canvas-customer-promo'
Start-Process -FilePath 'npm.cmd' -ArgumentList @('--prefix',$dashi,'run','preview:start','--',$ppt,'5320') -WorkingDirectory $logs -WindowStyle Hidden -RedirectStandardOutput "$logs\preview.out.log" -RedirectStandardError "$logs\preview.err.log"
```

Expected: `http://127.0.0.1:5320/` returns HTTP `200`.

- [ ] **Step 4: Run a browser smoke check**

Use the Browser skill at `http://127.0.0.1:5320/` and verify:

```text
page count = 12
first page is nonblank
last page is nonblank
page 8 contains result.mp4
no visible text overlaps or covers navigation controls
```

Take one desktop screenshot of page 1 and one of page 8 for evidence. Do not perform unlimited visual refinement; fix only blank pages, broken media, severe overlap, or unrelated template text.

### Task 8: Export And Verify The PPTX

**Files:**

- Create: `D:\AI\workspace\output\infinite-canvas-customer-promo\exports\infinite-canvas-customer-promo.pptx`

- [ ] **Step 1: Attempt the preview export path**

Open `http://127.0.0.1:5320/` in the system browser and use the editable PPTX export action. Save the result to:

```text
D:\AI\workspace\output\infinite-canvas-customer-promo\exports\infinite-canvas-customer-promo.pptx
```

- [ ] **Step 2: Use the supported CLI fallback if the preview export is blocked**

If the preview export returns `403`, `5xx`, or does not produce a file, run:

```powershell
$dashi = 'C:\Users\10430\.codex\skills\dashiai-ppt\project'
$ppt = 'D:\AI\workspace\output\infinite-canvas-customer-promo\ppt'
$out = 'D:\AI\workspace\output\infinite-canvas-customer-promo\exports\infinite-canvas-customer-promo.pptx'
npm.cmd --prefix $dashi run export:pptx -- $ppt $out
```

Expected: command exits `0` and the PPTX file is non-empty.

- [ ] **Step 3: Verify slide count inside the PPTX package**

Run:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$pptx = 'D:\AI\workspace\output\infinite-canvas-customer-promo\exports\infinite-canvas-customer-promo.pptx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($pptx)
$slides = @($zip.Entries | Where-Object { $_.FullName -match '^ppt/slides/slide\d+\.xml$' }).Count
$zip.Dispose()
[pscustomobject]@{Path=$pptx;Bytes=(Get-Item -LiteralPath $pptx).Length;Slides=$slides}
```

Expected: `Slides=12` and file size is greater than zero.

### Task 9: Final Verification And Handoff

- [ ] **Step 1: Verify every required deliverable**

Run:

```powershell
$deck = 'D:\AI\workspace\output\infinite-canvas-customer-promo'
$goal = Get-Content -Raw -Encoding UTF8 -LiteralPath "$deck\goal.json" | ConvertFrom-Json
$layouts = @($goal.slides.layout)
[pscustomobject]@{
  HtmlExists = Test-Path -LiteralPath "$deck\ppt\index.html"
  PptxExists = Test-Path -LiteralPath "$deck\exports\infinite-canvas-customer-promo.pptx"
  NotesExist = Test-Path -LiteralPath "$deck\speaker-notes.md"
  PageCount = $goal.slides.Count
  UniqueLayouts = @($layouts | Sort-Object -Unique).Count
  VideoExists = Test-Path -LiteralPath "$deck\ppt\assets\user-media\result.mp4"
}
```

Expected: all booleans are `True`; `PageCount=12`; `UniqueLayouts=12`.

- [ ] **Step 2: Run the Dashiai version check**

Run:

```powershell
node 'C:\Users\10430\.codex\skills\dashiai-ppt\scripts\check_latest_version.mjs'
```

Expected: no output. If the script prints an update notice, include it verbatim at the end of the delivery message.

- [ ] **Step 3: Handoff**

Provide:

```text
HTML preview: http://127.0.0.1:5320/
PPTX: D:\AI\workspace\output\infinite-canvas-customer-promo\exports\infinite-canvas-customer-promo.pptx
Speaker notes: D:\AI\workspace\output\infinite-canvas-customer-promo\speaker-notes.md
```

Remind the user to open the preview URL in the system browser before using HTML-side export features.
