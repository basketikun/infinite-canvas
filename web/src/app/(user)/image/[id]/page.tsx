"use client";

import { use } from "react";

import { RequireAuth } from "@/components/require-auth";
import { ImageWorkspace } from "../image-workspace";

type Props = {
  params: Promise<{ id: string }>;
};

export default function ImageDetailPage({ params }: Props) {
  // Next.js 16 的 dynamic route params 是 Promise，使用 React.use() 解包。
  const { id } = use(params);
  return (
    <RequireAuth>
      <ImageWorkspace initialLogId={id} />
    </RequireAuth>
  );
}
