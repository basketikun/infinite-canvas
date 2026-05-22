// /image 的工作台主体由同目录的 layout.tsx 渲染（ImageWorkspace 抬到 layout 跨
// /image 与 /image/[id] 共享同一个组件实例，避免 router.replace 引发的卸载重挂载
// 竞态）。这里只保留一个空 page 让 Next.js 把这条路由识别为合法路径。
export default function ImagePage() {
  return null;
}
