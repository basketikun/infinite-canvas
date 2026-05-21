"use client";

import { RequireAuth } from "@/components/require-auth";
import { ImageWorkspace } from "./image-workspace";

export default function ImagePage() {
  return (
    <RequireAuth>
      <ImageWorkspace />
    </RequireAuth>
  );
}
