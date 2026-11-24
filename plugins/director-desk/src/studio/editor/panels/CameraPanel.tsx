import { MotionPanel } from "./MotionPanel";
import { Camera, Download, Eye, Images, Send, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  InspectorAxisGroup,
  InspectorPanel,
  InspectorRangeNumberField,
  InspectorSection,
  InspectorSelectField,
  InspectorTextField,
} from "./InspectorControls";
import { requestViewportCapture } from "../io/captureBridge";
import { downloadDataUrl } from "../io/screenshotExport";
import { sendCaptures, addCapturedShots } from "../io/session";
import { getDirectorObjectFocusTarget, isCameraFocusableObject } from "../schema/cameraTarget";
import type { DirectorCameraCapture, DirectorCameraShot } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";

const VIEWER_ZOOM_MIN = 0.25;
const VIEWER_ZOOM_MAX = 5;
const VIEWER_ZOOM_STEP = 0.25;

function replaceAxis(tuple: [number, number, number], axis: 0 | 1 | 2, value: number): [number, number, number] {
  return tuple.map((item, index) => (index === axis ? value : item)) as [number, number, number];
}

export function CameraPanel() {
  const camera = useDirectorStore((state) =>
    state.project.cameras.find((item) => item.id === state.project.activeCameraId)
  );
  return camera ? <CameraControls key={camera.id} currentCamera={camera} /> : null;
}

function CameraControls({ currentCamera }: { currentCamera: DirectorCameraShot }) {
  const [activeTab, setActiveTab] = useState<"properties" | "captures" | "motion">("properties");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [hoveredCaptureId, setHoveredCaptureId] = useState<string | null>(null);
  const [viewerCapture, setViewerCapture] = useState<DirectorCameraCapture | null>(null);
  const [viewerScale, setViewerScale] = useState(1);
  const [viewerOffset, setViewerOffset] = useState({ x: 0, y: 0 });
  const [viewerDragging, setViewerDragging] = useState(false);
  const viewerDragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const objects = useDirectorStore((state) => state.project.objects);
  const setActiveCamera = useDirectorStore((state) => state.setActiveCamera);
  const updateCamera = useDirectorStore((state) => state.updateCamera);

  const captures = useMemo(() => currentCamera.captures ?? [], [currentCamera.captures]);
  const cameraCaptureGroups = useMemo(
    () =>
      cameras.map((item) => ({
        camera: item,
        captures: item.captures ?? [],
      })),
    [cameras]
  );
  const hasAnyCameraCapture = cameraCaptureGroups.some((group) => group.captures.length > 0);
  const focusableObjects = useMemo(() => objects.filter(isCameraFocusableObject), [objects]);
  const rig = objects.find(object => object.linkedCameraId === currentCamera.id);
  const targetSelectValue =
    currentCamera.targetMode === "object" && currentCamera.targetObjectId
      ? `object:${currentCamera.targetObjectId}`
      : "manual";

  useEffect(() => {
    if (!viewerCapture) {
      setViewerScale(1);
      setViewerOffset({ x: 0, y: 0 });
      setViewerDragging(false);
      viewerDragStateRef.current = null;
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setViewerCapture(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [viewerCapture]);

  useEffect(() => {
    if (viewerScale <= 1) {
      setViewerOffset({ x: 0, y: 0 });
      setViewerDragging(false);
      viewerDragStateRef.current = null;
    }
  }, [viewerScale]);

  useEffect(() => {
    if (!viewerDragging) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const dragState = viewerDragStateRef.current;
      if (!dragState) {
        return;
      }

      setViewerOffset({
        x: dragState.originX + event.clientX - dragState.startX,
        y: dragState.originY + event.clientY - dragState.startY,
      });
    }

    function handleMouseUp() {
      setViewerDragging(false);
      viewerDragStateRef.current = null;
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [viewerDragging]);

  const clampViewerScale = useCallback((value: number) => {
    return Math.min(VIEWER_ZOOM_MAX, Math.max(VIEWER_ZOOM_MIN, value));
  }, []);

  const updateViewerScale = useCallback((updater: (currentScale: number) => number) => {
    setViewerScale((currentScale) => clampViewerScale(Number(updater(currentScale).toFixed(2))));
  }, [clampViewerScale]);

  const sendCaptureToCanvas = useCallback((capture: DirectorCameraCapture) => {
    void sendCaptures([
      {
        dataUrl: capture.dataUrl,
        fileName: `${capture.name}.png`,
      },
    ]);
  }, []);

  const sendAllCapturesToCanvas = useCallback(() => {
    void sendCaptures(
      cameraCaptureGroups.flatMap((group) =>
        group.captures.map((capture) => ({
          dataUrl: capture.dataUrl,
          fileName: `${capture.name}.png`,
        }))
      )
    );
  }, [cameraCaptureGroups]);

  async function handleCameraCapture() {
    try {
      setCaptureError(null);
      const results = await requestViewportCapture({
        preset: "current",
        source: "camera-panel",
        cameraId: currentCamera.id,
      });
      await addCapturedShots(currentCamera.id, results);
    } catch {
      setCaptureError("机位截图失败，请重试。");
    }
  }

  function handleDeleteCapture(captureId: string) {
    const captureCamera = cameras.find((item) => (item.captures ?? []).some((capture) => capture.id === captureId));
    if (!captureCamera) return;

    const nextCaptures = (captureCamera.captures ?? []).filter((item) => item.id !== captureId);
    updateCamera(captureCamera.id, {
      captures: nextCaptures,
      lastCaptureUrl: nextCaptures[nextCaptures.length - 1]?.dataUrl ?? null,
    });
    setHoveredCaptureId((current) => (current === captureId ? null : current));
    setViewerCapture((current) => (current?.id === captureId ? null : current));
  }

  function handleClearAllCaptures() {
    cameras.forEach((item) => {
      if ((item.captures ?? []).length === 0 && !item.lastCaptureUrl) return;

      updateCamera(item.id, {
        captures: [],
        lastCaptureUrl: null,
      });
    });
    setHoveredCaptureId(null);
    setViewerCapture(null);
  }

  function handleViewerZoom(direction: "in" | "out") {
    updateViewerScale((current) => current + (direction === "in" ? VIEWER_ZOOM_STEP : -VIEWER_ZOOM_STEP));
  }

  function handleViewerWheel(event: React.WheelEvent<HTMLImageElement>) {
    event.preventDefault();
    event.stopPropagation();
    updateViewerScale((current) => current + (event.deltaY < 0 ? VIEWER_ZOOM_STEP : -VIEWER_ZOOM_STEP));
  }

  function handleViewerMouseDown(event: React.MouseEvent<HTMLImageElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (viewerScale <= 1) {
      return;
    }

    viewerDragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: viewerOffset.x,
      originY: viewerOffset.y,
    };
    setViewerDragging(true);
  }

  function closeViewer() {
    setViewerCapture(null);
  }

  function handleTargetSelection(value: string) {
    if (value === "manual") {
      updateCamera(currentCamera.id, {
        targetMode: "manual",
        targetObjectId: null,
      });
      return;
    }

    const objectId = value.replace(/^object:/, "");
    const targetObject = focusableObjects.find((item) => item.id === objectId);

    if (!targetObject) {
      updateCamera(currentCamera.id, {
        targetMode: "manual",
        targetObjectId: null,
      });
      return;
    }

    updateCamera(currentCamera.id, {
      targetMode: "object",
      targetObjectId: targetObject.id,
      target: getDirectorObjectFocusTarget(targetObject),
    });
  }

  function updateManualTarget(axis: 0 | 1 | 2, value: string) {
    updateCamera(currentCamera.id, {
      targetMode: "manual",
      targetObjectId: null,
      target: replaceAxis(currentCamera.target, axis, Number(value)),
    });
  }

  function renderCaptureCards(captureList: DirectorCameraCapture[]) {
    return (
      <div className="camera-capture-grid" aria-label="相机截图列表">
        {captureList.map((capture) => {
          const captureActive = hoveredCaptureId === capture.id;

          return (
            <div key={capture.id} className="camera-capture-card">
              <div
                className="camera-capture-thumb-wrap"
                onClick={() => setViewerCapture(capture)}
                onMouseEnter={() => setHoveredCaptureId(capture.id)}
                onMouseLeave={() => setHoveredCaptureId((current) => (current === capture.id ? null : current))}
              >
                <img className="camera-capture-thumb" alt={`${capture.name} 缩略图`} src={capture.dataUrl} />
                <div
                  aria-label={`${capture.name} 缩略图操作`}
                  className={`camera-capture-actions${captureActive ? " is-visible" : ""}`}
                  role="group"
                >
                  <button
                    aria-label={`删除截图 ${capture.name}`}
                    className="camera-capture-action"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteCapture(capture.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={14} strokeWidth={1.9} />
                  </button>
                  <button
                    aria-label={`发送到画布 ${capture.name}`}
                    className="camera-capture-action"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      sendCaptureToCanvas(capture);
                    }}
                  >
                    <Send aria-hidden="true" size={14} />
                  </button>
                  <button
                    aria-label={`查看截图 ${capture.name}`}
                    className="camera-capture-action"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setViewerCapture(capture);
                    }}
                  >
                    <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
                  </button>
                </div>
              </div>
              <span className="camera-capture-name">{capture.name}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderCurrentCameraCaptureGrid() {
    if (captures.length === 0) {
      return <div className="capture-list-placeholder">当前还没有机位截图，可先从当前机位生成一张预览。</div>;
    }

    return renderCaptureCards(captures);
  }

  function renderCaptureEmptyState() {
    return (
      <div className="camera-capture-empty object-search-empty-state" role="status" aria-label="暂无摄像机截图">
        <span className="object-search-empty-icon" data-testid="camera-capture-empty-icon">
          <Images aria-hidden="true" size={16} strokeWidth={1.8} />
        </span>
        <span>暂无摄像机截图</span>
      </div>
    );
  }

  function renderAllCameraCaptures() {
    return (
      <div className="camera-capture-overview">
        <div className="camera-capture-overview-scroll">
          {hasAnyCameraCapture ? (
            cameraCaptureGroups
              .filter((group) => group.captures.length > 0)
              .map((group) => (
                <section
                  key={group.camera.id}
                  aria-label={`${group.camera.name}截图`}
                  className="camera-capture-group"
                >
                  <h3>{group.camera.name}截图</h3>
                  {renderCaptureCards(group.captures)}
                </section>
              ))
          ) : (
            renderCaptureEmptyState()
          )}
        </div>
      </div>
    );
  }

  function renderCaptureOverviewFooter() {
    if (activeTab !== "captures") {
      return null;
    }

    return (
      <div className="camera-capture-overview-footer">
        <button className="camera-capture-clear-all" type="button" onClick={handleClearAllCaptures}>
          <Trash2 aria-hidden="true" data-testid="camera-capture-clear-icon" size={14} strokeWidth={1.9} />
          <span>清空全部</span>
        </button>
        <button
          className="camera-capture-send-all viewport-toolbar-crowd-confirm"
          type="button"
          onClick={sendAllCapturesToCanvas}
        >
          <Send aria-hidden="true" data-testid="camera-capture-send-icon" size={14} strokeWidth={1.9} />
          <span>发送到画布</span>
        </button>
      </div>
    );
  }

  function renderViewer() {
    if (!viewerCapture) {
      return null;
    }

    const viewerImageClassName = [
      "camera-capture-viewer-image",
      viewerScale > 1 ? "is-zoomed" : "",
      viewerDragging ? "is-dragging" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        aria-label="相机截图查看器"
        className="camera-capture-viewer"
        role="dialog"
        onClick={closeViewer}
      >
        <div
          aria-label="相机截图查看器工具栏"
          className="camera-capture-viewer-toolbar"
          role="toolbar"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            aria-label="放大图片"
            className="camera-capture-viewer-tool"
            type="button"
            onClick={() => handleViewerZoom("in")}
          >
            <ZoomIn aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          <button
            aria-label="缩小图片"
            className="camera-capture-viewer-tool"
            type="button"
            onClick={() => handleViewerZoom("out")}
          >
            <ZoomOut aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          <button
            aria-label="下载图片"
            className="camera-capture-viewer-tool"
            type="button"
            onClick={() => downloadDataUrl(viewerCapture.dataUrl, `${viewerCapture.name}.png`)}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          <button
            aria-label="关闭相机截图查看器"
            className="camera-capture-viewer-tool camera-capture-viewer-close"
            type="button"
            onClick={closeViewer}
          >
            <X aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="camera-capture-viewer-stage">
          <img
            className={viewerImageClassName}
            alt={`${viewerCapture.name} 查看大图`}
            src={viewerCapture.dataUrl}
            style={{ transform: `translate(${viewerOffset.x}px, ${viewerOffset.y}px) scale(${viewerScale})` }}
            onClick={(event) => event.stopPropagation()}
            onWheel={handleViewerWheel}
            onMouseDown={handleViewerMouseDown}
            draggable={false}
          />
        </div>
      </div>
    );
  }

  return (
    <InspectorPanel
      title="摄像机"
      ariaLabel="摄像机右侧属性面板"
      className={activeTab === "captures" ? "camera-inspector-captures" : undefined}
      footer={renderCaptureOverviewFooter()}
      tabs={[
        { label: "属性", active: activeTab === "properties", onClick: () => setActiveTab("properties") },
        ...(rig ? [{ label: "轨迹", active: activeTab === "motion", onClick: () => setActiveTab("motion") }] : []),
        { label: "摄像机截图", active: activeTab === "captures", onClick: () => setActiveTab("captures") },
      ]}
    >
      {activeTab === "motion" && rig ? <MotionPanel object={rig} /> : activeTab === "properties" ? (
        <>
          <InspectorTextField
            label="名称"
            ariaLabel="机位名称"
            value={currentCamera.name}
            onChange={(value) => updateCamera(currentCamera.id, { name: value })}
          />
          <InspectorSelectField
            label="切换机位"
            ariaLabel="切换机位"
            value={currentCamera.id}
            onChange={(value) => setActiveCamera(value)}
          >
            {cameras.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </InspectorSelectField>
          <InspectorAxisGroup
            label="位置"
            axes={[
              {
                axis: "X",
                ariaLabel: "机位位置 X",
                value: currentCamera.transform.position[0],
                onChange: (value) =>
                  updateCamera(currentCamera.id, {
                    transform: {
                      ...currentCamera.transform,
                      position: replaceAxis(currentCamera.transform.position, 0, Number(value)),
                    },
                  }),
              },
              {
                axis: "Y",
                ariaLabel: "机位位置 Y",
                value: currentCamera.transform.position[1],
                onChange: (value) =>
                  updateCamera(currentCamera.id, {
                    transform: {
                      ...currentCamera.transform,
                      position: replaceAxis(currentCamera.transform.position, 1, Number(value)),
                    },
                  }),
              },
              {
                axis: "Z",
                ariaLabel: "机位位置 Z",
                value: currentCamera.transform.position[2],
                onChange: (value) =>
                  updateCamera(currentCamera.id, {
                    transform: {
                      ...currentCamera.transform,
                      position: replaceAxis(currentCamera.transform.position, 2, Number(value)),
                    },
                  }),
              },
            ]}
          />
          <InspectorSelectField
            label="注视目标"
            ariaLabel="注视目标模式"
            value={targetSelectValue}
            onChange={handleTargetSelection}
          >
            <option value="manual">手动坐标</option>
            {focusableObjects.map((item) => (
              <option key={item.id} value={`object:${item.id}`}>
                {item.name}
              </option>
            ))}
          </InspectorSelectField>
          <InspectorAxisGroup
            label="注视坐标"
            axes={[
              {
                axis: "X",
                ariaLabel: "注视坐标 X",
                value: currentCamera.target[0],
                onChange: (value) => updateManualTarget(0, value),
              },
              {
                axis: "Y",
                ariaLabel: "注视坐标 Y",
                value: currentCamera.target[1],
                onChange: (value) => updateManualTarget(1, value),
              },
              {
                axis: "Z",
                ariaLabel: "注视坐标 Z",
                value: currentCamera.target[2],
                onChange: (value) => updateManualTarget(2, value),
              },
            ]}
          />
          <InspectorRangeNumberField
            label="视野角度 (FOV)"
            rangeAriaLabel="机位 FOV 滑杆"
            numberAriaLabel="机位 FOV"
            max="120"
            min="10"
            step="0.1"
            value={currentCamera.fov}
            onValueChange={(value) => updateCamera(currentCamera.id, { fov: Number(value) })}
          />
          <InspectorSection title="相机截图" className="camera-capture-section">
            <button
              className="camera-capture-current-button"
              type="button"
              onClick={() => void handleCameraCapture()}
            >
              <Camera aria-hidden="true" data-testid="camera-current-capture-icon" size={14} strokeWidth={1.9} />
              <span>当前机位截图</span>
            </button>
            {captureError ? <p>{captureError}</p> : null}
            {renderCurrentCameraCaptureGrid()}
          </InspectorSection>
        </>
      ) : (
        <div className="camera-capture-tab">
          {captureError ? <p>{captureError}</p> : null}
          {renderAllCameraCaptures()}
        </div>
      )}
      {renderViewer()}
    </InspectorPanel>
  );
}
