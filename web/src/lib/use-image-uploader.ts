"use client";

import { App } from "antd";
import { useCallback, useRef } from "react";

import { uploadImage, type UploadedImage } from "@/services/image-storage";

type UploadOptions = {
  // 用户可见的描述，比如「参考图」「素材封面」；为空则用默认"图片"。
  label?: string;
  // 上传成功后是否弹 message.success；默认 true。
  silentSuccess?: boolean;
};

// useImageUploader 在 antd App 上下文里给 uploadImage 包一层 loading toast，
// 自动展示「正在上传 xxx…」、成功/失败提示，避免用户等待期间无反馈。
//
// 用法：
//   const upload = useImageUploader();
//   const { storageKey, url } = await upload(file, { label: "参考图" });
//
// 多次并发上传也安全：每次调用用独立 key 区分 toast。
export function useImageUploader() {
  const { message } = App.useApp();
  const counterRef = useRef(0);

  return useCallback(
    async (input: string | Blob, options: UploadOptions = {}): Promise<UploadedImage> => {
      const label = options.label?.trim() || "图片";
      const key = `upload-${++counterRef.current}-${Date.now()}`;
      message.loading({ content: `正在上传${label}…`, key, duration: 0 });
      try {
        const result = await uploadImage(input);
        if (options.silentSuccess === false) {
          message.success({ content: `${label}已上传`, key, duration: 1.5 });
        } else {
          // 默认静默成功：直接关闭 loading toast，不打扰
          message.destroy(key);
        }
        return result;
      } catch (error) {
        const text = error instanceof Error ? error.message : `${label}上传失败`;
        message.error({ content: text, key, duration: 3 });
        throw error;
      }
    },
    [message],
  );
}
