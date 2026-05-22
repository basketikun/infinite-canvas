"use client";

import { useParams } from "next/navigation";

import { RequireAuth } from "@/components/require-auth";

import { ImageWorkspace } from "./image-workspace";

// 这层 layout 把 ImageWorkspace 抬到 /image 和 /image/[id] 之上共享挂载，避免
// router.replace 切换两个 page 时整个工作台被 React 卸载重挂载，
// 进而把 generate() 跑在旧实例 closure 里、新实例 ref 重置导致 results 被刷成
// "生成被中断" 的跨实例 race condition。
// page.tsx 改为返回 null，children 不渲染任何 UI；工作台主体走这里的 ImageWorkspace。
export default function ImageLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const rawId = params?.id;
  const initialLogId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : undefined;
  return (
    <RequireAuth>
      <ImageWorkspace initialLogId={initialLogId} />
      {children}
    </RequireAuth>
  );
}
