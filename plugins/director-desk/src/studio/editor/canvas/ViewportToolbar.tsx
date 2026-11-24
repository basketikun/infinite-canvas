import { motionDuration } from "../schema/motion";
import { useMotionClock, playMotion, stopMotion } from "../store/motionPlayback";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type MutableRefObject,
} from "react";
import {
  Box,
  Boxes,
  Camera,
  ChevronRight,
  Ellipsis,
  Grid2X2,
  Grid3X3,
  Image,
  ImagePlus,
  Move3D,
  Plus,
  Play,
  Ratio,
  Rotate3D,
  Scale3D,
  Square,
  Trash2,
  UserPlus,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { requestViewportCapture } from "../io/captureBridge";
import { readLocalModelFile } from "../loaders/localModelImport";
import { readPanoramaFile } from "../loaders/panoramaImport";
import { discardRecording, finishRecording, startRecording, useRecordingState } from "../io/recording";
import { addCapturedShots, notify, sendRecording } from "../io/session";
import {
  VIEWPORT_ASPECT_RATIO_OPTIONS,
  type ViewportAspectRatio,
} from "../schema/viewportAspectRatio";
import { BODY_TYPE_OPTIONS, type CharacterBodyType } from "../runtime/mannequin/bodyTypes";
import { GEOMETRY_PRIMITIVE_OPTIONS, type GeometryPrimitiveType } from "../schema/directorProject";
import {
  useDirectorStore,
  type CameraShotSnapshot,
  type CrowdCharactersInput,
  type TransformMode,
} from "../store/directorStore";

type ToolbarAction = {
  label: string;
  icon: LucideIcon;
  mode?: TransformMode;
  onClick: () => void;
};

const DEFAULT_VIEWPORT_TOOLBAR_HEIGHT = 46;
const VIEWPORT_TOOLBAR_BOTTOM_OFFSET = 40;
const DEFAULT_CROWD_ROWS = 3;
const DEFAULT_CROWD_COLUMNS = 3;
const DEFAULT_CROWD_SPACING = 1.2;
const MIN_CROWD_GRID_SIZE = 1;
const MAX_CROWD_GRID_SIZE = 12;
const MIN_CROWD_SPACING = 0.1;
const MAX_CROWD_SPACING = 10;

function clampCrowdGridSize(value: number) {
  if (!Number.isFinite(value)) return MIN_CROWD_GRID_SIZE;
  return Math.min(MAX_CROWD_GRID_SIZE, Math.max(MIN_CROWD_GRID_SIZE, Math.round(value)));
}

function clampCrowdSpacing(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CROWD_SPACING;
  return Math.min(MAX_CROWD_SPACING, Math.max(MIN_CROWD_SPACING, Number(value.toFixed(2))));
}

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function ViewportToolbar({
  getViewportCameraSnapshot,
  toolbarContainerRef,
  getRecordingView,
}: {
  getViewportCameraSnapshot?: () => CameraShotSnapshot;
  toolbarContainerRef?: MutableRefObject<HTMLDivElement | null>;
  getRecordingView(): { view: HTMLCanvasElement; frame: { left: number; top: number; width: number; height: number } | null };
}) {
  const recording = useRecordingState();
  const duration = useDirectorStore(state => motionDuration(state.project.objects));
  const previewing = useMotionClock(state => state.time !== null);
  const recordingLabel = { idle: "开始录制", recording: "停止录制", sending: "正在添加视频", retry: "重新添加视频" }[recording];
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const aspectRatioPanelRef = useRef<HTMLDivElement | null>(null);
  const characterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const geometryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const crowdTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelLibraryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const characterMenuRef = useRef<HTMLDivElement | null>(null);
  const geometryMenuRef = useRef<HTMLDivElement | null>(null);
  const crowdPanelRef = useRef<HTMLDivElement | null>(null);
  const modelLibraryPanelRef = useRef<HTMLDivElement | null>(null);
  const sceneLocalModelInputRef = useRef<HTMLInputElement | null>(null);
  const libraryLocalModelInputRef = useRef<HTMLInputElement | null>(null);
  const panoramaInputRef = useRef<HTMLInputElement | null>(null);
  const [characterMenuOpen, setCharacterMenuOpen] = useState(false);
  const [geometryMenuOpen, setGeometryMenuOpen] = useState(false);
  const [crowdPanelOpen, setCrowdPanelOpen] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
  const [aspectRatioPanelOpen, setAspectRatioPanelOpen] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
  const [characterMenuStyle, setCharacterMenuStyle] = useState<CSSProperties>({});
  const [geometryMenuStyle, setGeometryMenuStyle] = useState<CSSProperties>({});
  const [crowdPanelStyle, setCrowdPanelStyle] = useState<CSSProperties>({});
  const [modelLibraryPanelStyle, setModelLibraryPanelStyle] = useState<CSSProperties>({});
  const [crowdBodyType, setCrowdBodyType] = useState<CharacterBodyType>(BODY_TYPE_OPTIONS[0]?.bodyType ?? "mannequin");
  const [crowdRows, setCrowdRows] = useState(String(DEFAULT_CROWD_ROWS));
  const [crowdColumns, setCrowdColumns] = useState(String(DEFAULT_CROWD_COLUMNS));
  const [crowdSpacing, setCrowdSpacing] = useState(String(DEFAULT_CROWD_SPACING));
  const addImportedAsset = useDirectorStore((state) => state.addImportedAsset);
  const addObjectFromAsset = useDirectorStore((state) => state.addObjectFromAsset);
  const removeImportedAsset = useDirectorStore((state) => state.removeImportedAsset);
  const assets = useDirectorStore((state) => state.project.assets);
  const addPresetCharacter = useDirectorStore((state) => state.addPresetCharacter);
  const addCrowdCharacters = useDirectorStore((state) => state.addCrowdCharacters);
  const addGeometryPrimitive = useDirectorStore((state) => state.addGeometryPrimitive);
  const addCameraShot = useDirectorStore((state) => state.addCameraShot);
  const activeCameraId = useDirectorStore((state) => state.project.activeCameraId);
  const viewMode = useDirectorStore((state) => state.viewMode);
  const transformMode = useDirectorStore((state) => state.transformMode);
  const viewportAspectRatio = useDirectorStore((state) => state.viewportAspectRatio);
  const setViewMode = useDirectorStore((state) => state.setViewMode);
  const setTransformMode = useDirectorStore((state) => state.setTransformMode);
  const setViewportAspectRatio = useDirectorStore((state) => state.setViewportAspectRatio);
  const moreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (moreRef.current?.open && !moreRef.current.contains(event.target as Node)) moreRef.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (moreRef.current?.open) {
        moreRef.current.open = false;
        moreRef.current.querySelector("summary")?.focus();
      } else if (characterMenuOpen || crowdPanelOpen || modelLibraryOpen || aspectRatioPanelOpen) {
        const trigger = characterMenuOpen || crowdPanelOpen ? characterTriggerRef.current : modelLibraryOpen ? modelLibraryTriggerRef.current : toolbarRef.current?.querySelector<HTMLButtonElement>('[aria-label="选择画幅比例"]');
        setCharacterMenuOpen(false);
        setGeometryMenuOpen(false);
        setCrowdPanelOpen(false);
        setModelLibraryOpen(false);
        setAspectRatioPanelOpen(false);
        trigger?.focus();
      } else return;
      event.preventDefault();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [characterMenuOpen, crowdPanelOpen, modelLibraryOpen, aspectRatioPanelOpen]);

  useEffect(() => {
    if (!characterMenuOpen && !crowdPanelOpen && !modelLibraryOpen && !aspectRatioPanelOpen) return;

    function closeMenusOnOutsidePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && characterMenuRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && geometryMenuRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && crowdPanelRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && modelLibraryPanelRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && aspectRatioPanelRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && sceneLocalModelInputRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && libraryLocalModelInputRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && panoramaInputRef.current?.contains(event.target)) return;

      setCharacterMenuOpen(false);
      setGeometryMenuOpen(false);
      setCrowdPanelOpen(false);
      setModelLibraryOpen(false);
      setAspectRatioPanelOpen(false);
    }

    document.addEventListener("pointerdown", closeMenusOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeMenusOnOutsidePointerDown);
    };
  }, [aspectRatioPanelOpen, characterMenuOpen, crowdPanelOpen, modelLibraryOpen]);

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = Math.max(element.offsetHeight, DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
      setToolbarHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => {
        window.removeEventListener("resize", updateHeight);
      };
    }

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useLayoutEffect(() => {
    const toolbarElement = toolbarRef.current;
    const frameElement = toolbarElement?.parentElement;
    if (!toolbarElement || !frameElement) return;

    const updateFloatingPositions = () => {
      const frameRect = frameElement.getBoundingClientRect();

      if (characterMenuOpen && characterTriggerRef.current) {
        const triggerRect = characterTriggerRef.current.getBoundingClientRect();
        setCharacterMenuStyle({
          left: `${triggerRect.left - frameRect.left + triggerRect.width / 2}px`,
          bottom: `${frameRect.bottom - triggerRect.top + 8}px`,
        });
      }

      if (geometryMenuOpen && geometryTriggerRef.current) {
        const triggerRect = geometryTriggerRef.current.getBoundingClientRect();
        setGeometryMenuStyle({
          left: `${triggerRect.right - frameRect.left + 8}px`,
          bottom: `${frameRect.bottom - triggerRect.bottom}px`,
        });
      }

      if (crowdPanelOpen && crowdTriggerRef.current) {
        const triggerRect = crowdTriggerRef.current.getBoundingClientRect();
        setCrowdPanelStyle({
          left: `${triggerRect.right - frameRect.left + 8}px`,
          bottom: `${frameRect.bottom - triggerRect.bottom}px`,
        });
      }

      if (modelLibraryOpen) {
        const toolbarRect = toolbarElement.getBoundingClientRect();
        setModelLibraryPanelStyle({
          left: `${toolbarRect.left - frameRect.left + toolbarRect.width / 2}px`,
          bottom: `${frameRect.bottom - toolbarRect.top + 10}px`,
        });
      }
    };

    updateFloatingPositions();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFloatingPositions);
      return () => {
        window.removeEventListener("resize", updateFloatingPositions);
      };
    }

    const resizeObserver = new ResizeObserver(updateFloatingPositions);
    resizeObserver.observe(frameElement);
    resizeObserver.observe(toolbarElement);
    if (characterTriggerRef.current) {
      resizeObserver.observe(characterTriggerRef.current);
    }
    if (geometryTriggerRef.current) {
      resizeObserver.observe(geometryTriggerRef.current);
    }
    if (crowdTriggerRef.current) {
      resizeObserver.observe(crowdTriggerRef.current);
    }
    if (modelLibraryTriggerRef.current) {
      resizeObserver.observe(modelLibraryTriggerRef.current);
    }
    window.addEventListener("resize", updateFloatingPositions);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFloatingPositions);
    };
  }, [characterMenuOpen, crowdPanelOpen, geometryMenuOpen, modelLibraryOpen]);

  async function handleLocalModelChange(
    event: ChangeEvent<HTMLInputElement>,
    addToScene: boolean
  ) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    try {
      for (const file of files) {
        const result = await readLocalModelFile(file);
        addImportedAsset({
          kind: "prop",
          ...result,
          addToScene,
          assetSource: "local",
        });
      }
    } catch {
      notify("导入失败，请检查文件格式后重试。");
    } finally {
      input.value = "";
    }
  }

  async function handlePanoramaChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const result = await readPanoramaFile(file);
      addImportedAsset({ kind: "panorama", ...result });
    } catch {
      notify("导入失败，请检查文件格式后重试。");
    } finally {
      input.value = "";
    }
  }

  async function handleCapture(preset: "current" | "four" | "twelve") {
    try {
      const targetCameraId =
        viewMode === "director" ? addCameraShot(getViewportCameraSnapshot?.()) : activeCameraId;

      setViewMode("camera");
      await waitForNextAnimationFrame();

      const results = await requestViewportCapture({
        preset,
        source: "camera-panel",
        cameraId: targetCameraId,
      });
      await addCapturedShots(targetCameraId, results);
    } catch {
      notify("截图未完成，请重试。");
    }
  }

  async function toggleRecording() {
    if (recording === "idle") {
      if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
        notify("此浏览器无法录制画面。请使用支持画布录制的浏览器。");
        return;
      }
      try {
        const { view, frame } = getRecordingView();
        startRecording(view, frame, sendRecording, duration);
        notify("正在录制当前视角");
      } catch { notify("录制未开始，请确认视口已打开后重试。"); }
    } else {
      try { await finishRecording(); }
      catch { notify("录制未能添加到画布，请重试。"); }
    }
  }

  function selectTransformMode(mode: TransformMode) {
    setTransformMode(mode);
  }

  function toggleCharacterMenu() {
    setCharacterMenuOpen((isOpen) => !isOpen);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
    setModelLibraryOpen(false);
    setAspectRatioPanelOpen(false);
  }

  function addCharacterWithBodyType(bodyType: CharacterBodyType) {
    addPresetCharacter(bodyType);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
  }

  function addGeometryWithType(geometryType: GeometryPrimitiveType) {
    addGeometryPrimitive(geometryType);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
  }

  function openCrowdPanel() {
    setCrowdPanelOpen(true);
    setGeometryMenuOpen(false);
  }

  function closeCrowdPanel() {
    setCrowdPanelOpen(false);
  }

  function getCrowdInputValue(): CrowdCharactersInput {
    return {
      bodyType: crowdBodyType,
      rows: clampCrowdGridSize(Number(crowdRows)),
      columns: clampCrowdGridSize(Number(crowdColumns)),
      spacing: clampCrowdSpacing(Number(crowdSpacing)),
    };
  }

  function applyCrowdValueDrafts(input: CrowdCharactersInput) {
    setCrowdRows(String(input.rows));
    setCrowdColumns(String(input.columns));
    setCrowdSpacing(String(input.spacing));
  }

  function addCrowd() {
    const nextInput = getCrowdInputValue();
    applyCrowdValueDrafts(nextInput);
    addCrowdCharacters(nextInput);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
  }

  function toggleModelLibrary() {
    setModelLibraryOpen((isOpen) => !isOpen);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
    setAspectRatioPanelOpen(false);
  }

  async function handleMyModelsImport() {
    libraryLocalModelInputRef.current?.click();
  }

  function addCameraFromViewport() {
    const snapshot = getViewportCameraSnapshot?.();
    addCameraShot(snapshot);
  }

  function toggleAspectRatioPanel() {
    setAspectRatioPanelOpen((isOpen) => !isOpen);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
    setModelLibraryOpen(false);
  }

  function selectAspectRatio(ratio: ViewportAspectRatio) {
    setViewportAspectRatio(ratio);
    setAspectRatioPanelOpen(false);
  }

  const actions: ToolbarAction[] = [
    { label: "移动", icon: Move3D, mode: "translate", onClick: () => selectTransformMode("translate") },
    { label: "旋转", icon: Rotate3D, mode: "rotate", onClick: () => selectTransformMode("rotate") },
    { label: "缩放", icon: Scale3D, mode: "scale", onClick: () => selectTransformMode("scale") },
    { label: "模型库", icon: Boxes, onClick: toggleModelLibrary },
    { label: "添加机位", icon: Video, onClick: addCameraFromViewport },
    { label: "选择画幅比例", icon: Ratio, onClick: toggleAspectRatioPanel },
  ];
  const moreActions: ToolbarAction[] = [
    { label: "导入全景图", icon: ImagePlus, onClick: () => panoramaInputRef.current?.click() },
    {
      label: "导入本地模型",
      icon: Box,
      onClick: () => {
        sceneLocalModelInputRef.current?.click();
      },
    },
    { label: "四方位截图", icon: Grid2X2, onClick: () => void handleCapture("four") },
    { label: "十二方位截图", icon: Grid3X3, onClick: () => void handleCapture("twelve") },
  ];

  function renderActionButton(action: ToolbarAction) {
    const Icon = action.icon;
    const active = action.mode ? transformMode === action.mode : false;

    return (
      <button
        key={action.label}
        aria-label={action.label}
        aria-pressed={action.mode ? active : undefined}
        className={`ui-icon-button viewport-toolbar-button${active ? " is-active" : ""}`}
        type="button"
        onClick={action.onClick}
      >
        <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
        <span className="viewport-toolbar-label">{action.label}</span>
      </button>
    );
  }

  const activeModelLibraryItems = assets.filter(asset => asset.sourceType === "model" && asset.assetSource === "local");
  const crowdInputValue = getCrowdInputValue();
  const crowdTotalCount = crowdInputValue.rows * crowdInputValue.columns;

  function setToolbarElement(element: HTMLDivElement | null) {
    toolbarRef.current = element;
    if (toolbarContainerRef) {
      toolbarContainerRef.current = element;
    }
  }

  const aspectRatioPanelStyle = {
    "--viewport-toolbar-height": `${toolbarHeight}px`,
  } as CSSProperties;

  return (
    <>
      <div className="viewport-toolbar" role="group" aria-label="3D视口快捷工具" ref={setToolbarElement}>
        {actions.slice(0, 3).map(renderActionButton)}
        <span className="tool-divider" aria-hidden />
        <div className="viewport-toolbar-menu-wrap">
          <button
            aria-expanded={characterMenuOpen}
            aria-label="添加角色"
            className="ui-icon-button viewport-toolbar-button"
            ref={characterTriggerRef}
            type="button"
            onClick={toggleCharacterMenu}
          >
            <UserPlus aria-hidden="true" size={17} strokeWidth={1.9} />
            <span className="viewport-toolbar-label">添加角色</span>
          </button>
        </div>
        {actions.slice(3).map((action) => {
          if (action.label !== "模型库") {
            return renderActionButton(action);
          }

          const Icon = action.icon;

          return (
            <button
              key={action.label}
              aria-label={action.label}
              className="ui-icon-button viewport-toolbar-button"
              ref={modelLibraryTriggerRef}
              type="button"
              onClick={action.onClick}
            >
              <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
              <span className="viewport-toolbar-label">{action.label}</span>
            </button>
          );
        })}
        <details className="more-tools" ref={moreRef} onToggle={event => {
          if (event.currentTarget.open) {
            setCharacterMenuOpen(false); setGeometryMenuOpen(false); setCrowdPanelOpen(false); setModelLibraryOpen(false); setAspectRatioPanelOpen(false);
          }
        }}>
          <summary className="ui-icon-button viewport-toolbar-button" aria-label="更多工具"><Ellipsis size={17} /><span className="viewport-toolbar-label">更多工具</span></summary>
          <div className="more-tools-list">{moreActions.map(({ label, icon: Icon, onClick }) => <button key={label} type="button" onClick={() => {
            moreRef.current!.open = false; moreRef.current!.querySelector("summary")?.focus(); onClick();
          }}><Icon size={15} />{label}</button>)}</div>
        </details>
        <span className="tool-divider capture-divider" aria-hidden />
        <div className="capture-tools">
          {duration > 0 && recording === "idle" && <button type="button" className="record-action" aria-pressed={previewing}
            onClick={() => previewing ? stopMotion() : playMotion(duration)}>
            {previewing ? <Square size={14} /> : <Play size={15} />}{previewing ? "停止预览" : "预览轨迹"}
          </button>}
          <button className="shot-action" type="button" aria-label="当前视角截图" onClick={() => void handleCapture("current")}><Camera size={16} />拍照</button>
          <button className="record-action" type="button" disabled={recording === "sending"} aria-pressed={recording === "recording"} aria-label={recordingLabel} onClick={() => void toggleRecording()}>
            {recording === "recording" ? <Square size={14} /> : <Video size={16} />}
            {recording === "idle" ? "录制" : recording === "recording" ? "停止录制" : recordingLabel}
          </button>
          {recording === "retry" && <button type="button" className="record-action" onClick={discardRecording}>放弃录制</button>}
        </div>
      </div>
      {characterMenuOpen ? (
        <div
          ref={characterMenuRef}
          className="viewport-toolbar-menu"
          role="menu"
          aria-label="选择角色体型"
          style={characterMenuStyle}
        >
          {BODY_TYPE_OPTIONS.map((option) => (
            <button
              key={option.bodyType}
              role="menuitem"
              type="button"
              onClick={() => addCharacterWithBodyType(option.bodyType)}
              onMouseEnter={() => {
                setGeometryMenuOpen(false);
                setCrowdPanelOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
          <div
            className="viewport-toolbar-submenu-wrap"
            onMouseEnter={openCrowdPanel}
          >
            <button
              ref={crowdTriggerRef}
              aria-expanded={crowdPanelOpen}
              aria-haspopup="dialog"
              className="viewport-toolbar-menu-subtrigger"
              role="menuitem"
              type="button"
              onFocus={openCrowdPanel}
              onMouseEnter={openCrowdPanel}
            >
              <span>群众 (3x3)</span>
              <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
          </div>
          <div
            className="viewport-toolbar-submenu-wrap"
            onMouseEnter={() => {
              setGeometryMenuOpen(true);
              setCrowdPanelOpen(false);
            }}
          >
            <button
              ref={geometryTriggerRef}
              aria-expanded={geometryMenuOpen}
              aria-haspopup="menu"
              className="viewport-toolbar-menu-subtrigger"
              role="menuitem"
              type="button"
              onMouseEnter={() => {
                setGeometryMenuOpen(true);
                setCrowdPanelOpen(false);
              }}
            >
              <span>几何模型</span>
              <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      ) : null}
      {crowdPanelOpen ? (
        <div
          ref={crowdPanelRef}
          className="viewport-toolbar-crowd-panel"
          role="dialog"
          aria-label="添加群众阵列"
          style={crowdPanelStyle}
        >
          <div className="viewport-toolbar-crowd-panel-header">
            <h2 className="viewport-toolbar-crowd-panel-title">添加群众阵列</h2>
            <span className="viewport-toolbar-crowd-panel-count">共{crowdTotalCount}人</span>
          </div>
          <div className="viewport-toolbar-crowd-grid">
            <label className="viewport-toolbar-crowd-field">
              <span>行数</span>
              <input
                className="ui-field"
                aria-label="群众行数"
                inputMode="numeric"
                type="number"
                min={MIN_CROWD_GRID_SIZE}
                max={MAX_CROWD_GRID_SIZE}
                value={crowdRows}
                onChange={(event) => setCrowdRows(event.currentTarget.value)}
              />
            </label>
            <span className="viewport-toolbar-crowd-separator" aria-hidden="true">
              ×
            </span>
            <label className="viewport-toolbar-crowd-field">
              <span>列数</span>
              <input
                className="ui-field"
                aria-label="群众列数"
                inputMode="numeric"
                type="number"
                min={MIN_CROWD_GRID_SIZE}
                max={MAX_CROWD_GRID_SIZE}
                value={crowdColumns}
                onChange={(event) => setCrowdColumns(event.currentTarget.value)}
              />
            </label>
            <label className="viewport-toolbar-crowd-field viewport-toolbar-crowd-field-spacing">
              <span>间距</span>
              <input
                className="ui-field"
                aria-label="群众间距"
                inputMode="decimal"
                type="number"
                min={MIN_CROWD_SPACING}
                max={MAX_CROWD_SPACING}
                step="0.1"
                value={crowdSpacing}
                onChange={(event) => setCrowdSpacing(event.currentTarget.value)}
              />
            </label>
          </div>
          <div className="viewport-toolbar-crowd-actions">
            <button className="viewport-toolbar-crowd-cancel camera-capture-clear-all" type="button" onClick={closeCrowdPanel}>
              取消
            </button>
            <button
              aria-label="添加群众"
              className="viewport-toolbar-crowd-confirm camera-capture-send-all"
              type="button"
              onClick={addCrowd}
            >
              添加
            </button>
          </div>
        </div>
      ) : null}
      {geometryMenuOpen ? (
        <div
          ref={geometryMenuRef}
          className="viewport-toolbar-submenu"
          role="menu"
          aria-label="选择几何模型"
          style={geometryMenuStyle}
        >
          {GEOMETRY_PRIMITIVE_OPTIONS.map((option) => (
            <button
              key={option.type}
              role="menuitem"
              type="button"
              onClick={() => addGeometryWithType(option.type)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {modelLibraryOpen ? (
        <div
          ref={modelLibraryPanelRef}
          className="model-library-panel"
          role="dialog"
          aria-label="模型库"
          style={modelLibraryPanelStyle}
        >
          <div className="model-library-header">
            <h2 className="model-library-title">模型库</h2>
            <button
              aria-label="关闭模型库"
              className="top-bar-action-button model-library-close-button"
              type="button"
              onClick={() => setModelLibraryOpen(false)}
            >
              <X aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
          {activeModelLibraryItems.length === 0 ? (
            <div className="model-library-empty-state object-search-empty-state" role="status" aria-label="暂无任何模型">
              <span className="object-search-empty-icon" data-testid="my-models-empty-icon">
                <Boxes aria-hidden="true" size={16} strokeWidth={1.8} />
              </span>
              <span>暂无任何模型</span>
              <button className="top-bar-action-button model-library-empty-action" type="button" onClick={() => void handleMyModelsImport()}>
                本地导入
              </button>
            </div>
          ) : (
            <div className="model-library-grid" role="list" aria-label="模型列表">
              {activeModelLibraryItems.map((item) => (

                  <div key={item.id} className="model-library-card-wrap">
                    <button
                      aria-label={`添加模型 ${item.name}`}
                      className="model-library-card"
                      type="button"
                      onClick={() => {
                        addObjectFromAsset(item.id);
                        setModelLibraryOpen(false);
                      }}
                    >
                      <span className="model-library-thumb" aria-hidden="true">
                        <Boxes size={24} strokeWidth={1.6} />
                      </span>
                      <span className="model-library-name">{item.name}</span>
                    </button>
                    <button
                      aria-label={`删除模型 ${item.name}`}
                      className="model-library-card-delete"
                      type="button"
                      onClick={() => {
                        removeImportedAsset(item.id);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={14} strokeWidth={1.9} />
                    </button>
                  </div>
              ))}

                <button
                  aria-label="本地导入"
                  className="model-library-card model-library-import-card"
                  type="button"
                  onClick={() => void handleMyModelsImport()}
                >
                  <span className="model-library-thumb model-library-thumb-import" aria-hidden="true">
                    <Plus size={28} strokeWidth={1.8} />
                  </span>
                  <span className="model-library-name">本地导入</span>
                </button>
            </div>
          )}
        </div>
      ) : null}
      {aspectRatioPanelOpen ? (
        <div
          ref={aspectRatioPanelRef}
          className="viewport-aspect-panel"
          role="dialog"
          aria-label="比例"
          style={aspectRatioPanelStyle}
        >
          <h2 className="viewport-aspect-panel-title">比例</h2>
          <div className="viewport-aspect-panel-grid" role="group" aria-label="画幅比例选项">
            {VIEWPORT_ASPECT_RATIO_OPTIONS.map((option) => {
              const active = option.id === viewportAspectRatio;
              const frameClassName = `viewport-aspect-option-frame viewport-aspect-option-frame-${option.id.replace(":", "-")}`;

              return (
                <button
                  key={option.id}
                  aria-pressed={active}
                  className={`viewport-aspect-option${active ? " is-active" : ""}`}
                  type="button"
                  onClick={() => selectAspectRatio(option.id)}
                >
                  <span className={frameClassName} aria-hidden="true" />
                  <span className="viewport-aspect-option-label">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <input
        ref={panoramaInputRef}
        aria-hidden="true"
        className="hidden-file-input"
        tabIndex={-1}
        accept=".jpg,.jpeg,.png,.webp"
        type="file"
        onChange={(event) => void handlePanoramaChange(event)}
      />
      <input
        ref={sceneLocalModelInputRef}
        aria-hidden="true"
        className="hidden-file-input"
        data-testid="scene-local-model-input"
        tabIndex={-1}
        accept=".fbx,.obj"
        type="file"
        onChange={(event) => void handleLocalModelChange(event, true)}
      />
      <input
        ref={libraryLocalModelInputRef}
        aria-hidden="true"
        className="hidden-file-input"
        data-testid="library-local-model-input"
        tabIndex={-1}
        accept=".fbx,.obj"
        multiple
        type="file"
        onChange={(event) => void handleLocalModelChange(event, false)}
      />
    </>
  );
}
