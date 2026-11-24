# 无限画布文档

基于 Next.js 和 Fumadocs 的中文文档站，使用 standalone 部署，提供文档导航、中文搜索和 Markdown / LLM 内容。

## 本地开发

从仓库根目录启动文档站。

```bash
pnpm install --frozen-lockfile
pnpm dev:docs
```

生产构建与启动：

```bash
pnpm --dir apps/docs build
pnpm --dir apps/docs start
```

在 Vercel 中将项目的 Root Directory 设为 `apps/docs`。Docker 运行方式见 [Docker 部署](content/docs/overview/docker.mdx)。

## 内容与路由

- `index.md`：文档索引。
- `content/docs/`：中文 MDX 正文和分类 `meta.json`，文件名不带语言后缀。
- `src/app/(home)/`：首页。
- `src/app/docs/`：文档页面，统一使用 `/docs/...` 路径。
- `src/app/api/search/`：中文搜索索引，与页面使用相同的中文分词器。
- `/llms.txt`、`/llms-full.txt`、`/llms.mdx/docs/.../content.md`：中文索引与正文。
- `src/lib/source.ts`、`source.config.ts`：文档内容加载和 MDX 配置。
