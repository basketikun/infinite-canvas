// /image/[id] 的工作台主体由 ../layout.tsx 渲染。layout 通过 useParams() 拿到
// 当前 id，传给同一个 ImageWorkspace 实例；这里 page 只返回 null，让 Next.js
// 把 /image/{id} 识别为合法 dynamic 路径。
export default function ImageDetailPage() {
  return null;
}
