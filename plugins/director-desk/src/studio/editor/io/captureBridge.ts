import type { ScreenshotResult } from "./screenshotExport";

export type ViewportCapturePreset = "current" | "four" | "twelve";

export interface ViewportCaptureRequest {
  preset: ViewportCapturePreset;
  source: "capture-panel" | "camera-panel";
  cameraId?: string | null;
}

export type ViewportCaptureHandler = (request: ViewportCaptureRequest) => Promise<ScreenshotResult[]>;

let viewportCaptureHandler: ViewportCaptureHandler | null = null;

export function setViewportCaptureHandler(handler: ViewportCaptureHandler) {
  viewportCaptureHandler = handler;
}

export function clearViewportCaptureHandler() {
  viewportCaptureHandler = null;
}

export async function requestViewportCapture(request: ViewportCaptureRequest) {
  if (!viewportCaptureHandler) {
    throw new Error("Viewport capture handler is not registered");
  }

  return viewportCaptureHandler(request);
}
