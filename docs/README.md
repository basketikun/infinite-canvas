# DSH FreeCanvas 文档站

这个目录只用于维护和预览项目文档，不是 DSH FreeCanvas 的用户运行入口。普通用户请直接在 DSH 插件市场安装 **DSH FreeCanvas**。

## 本地预览

参与文档开发时，在本目录安装依赖并启动预览：

```bash
bun install
bun run dev
```

## 目录说明

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, `loader()` provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

## Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different
options like frontmatter schema.

Read the [Fumadocs MDX introduction](https://fumadocs.dev/docs/mdx) for further details.
