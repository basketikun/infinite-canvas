import { importBackground } from "../io/session";
import { useEffect, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import {
  InspectorAxisGroup,
  InspectorColorField,
  InspectorPanel,
  InspectorRangeNumberField,
  InspectorSection,
} from "./InspectorControls";
import { useDirectorStore } from "../store/directorStore";

const PANORAMA_RADIUS_MIN = 10;
const PANORAMA_RADIUS_MAX = 300;
const PANORAMA_YAW_MIN = -180;
const PANORAMA_YAW_MAX = 180;
const SCENE_SCALE_MIN = 0.1;
const SCENE_SCALE_MAX = 3;
const GROUND_HEIGHT_MIN = -5;
const GROUND_HEIGHT_MAX = 5;

function replaceAxis(tuple: [number, number, number], axis: 0 | 1 | 2, value: number): [number, number, number] {
  return tuple.map((item, index) => (index === axis ? value : item)) as [number, number, number];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ScenePanel() {
  const scene = useDirectorStore((state) => state.project.scene);
  const assets = useDirectorStore((state) => state.project.assets);
  const panoramaAssetId = useDirectorStore((state) => state.project.panoramaAssetId);
  const updateScene = useDirectorStore((state) => state.updateScene);
  const removePanoramaAsset = useDirectorStore((state) => state.removePanoramaAsset);
  const [sceneScaleDraft, setSceneScaleDraft] = useState(String(scene.scale));
  const [panoramaYawDraft, setPanoramaYawDraft] = useState(String(scene.panoramaYaw));
  const [panoramaRadiusDraft, setPanoramaRadiusDraft] = useState(String(scene.panoramaRadius));
  const [groundHeightDraft, setGroundHeightDraft] = useState(String(scene.groundHeight));
  const panoramaAsset = assets.find((item) => item.id === panoramaAssetId);
  const clampedPanoramaRadius = clampNumber(scene.panoramaRadius, PANORAMA_RADIUS_MIN, PANORAMA_RADIUS_MAX);

  useEffect(() => {
    setSceneScaleDraft(String(scene.scale));
  }, [scene.scale]);

  useEffect(() => {
    setPanoramaRadiusDraft(String(scene.panoramaRadius));
  }, [scene.panoramaRadius]);

  useEffect(() => {
    setPanoramaYawDraft(String(scene.panoramaYaw));
  }, [scene.panoramaYaw]);

  useEffect(() => {
    setGroundHeightDraft(String(scene.groundHeight));
  }, [scene.groundHeight]);

  function commitSceneScale(value: string) {
    const parsed = Number(value);
    const nextScale = Number.isFinite(parsed) ? clampNumber(parsed, SCENE_SCALE_MIN, SCENE_SCALE_MAX) : scene.scale;
    updateScene({ scale: nextScale });
    setSceneScaleDraft(String(nextScale));
  }

  function commitPanoramaYaw(value: string) {
    const parsed = Number(value);
    const nextYaw = Number.isFinite(parsed) ? clampNumber(parsed, PANORAMA_YAW_MIN, PANORAMA_YAW_MAX) : scene.panoramaYaw;
    updateScene({ panoramaYaw: nextYaw });
    setPanoramaYawDraft(String(nextYaw));
  }

  function commitPanoramaRadius(value: string) {
    const parsed = Number(value);
    const nextRadius = Number.isFinite(parsed)
      ? clampNumber(parsed, PANORAMA_RADIUS_MIN, PANORAMA_RADIUS_MAX)
      : scene.panoramaRadius;
    updateScene({ panoramaRadius: nextRadius });
    setPanoramaRadiusDraft(String(nextRadius));
  }

  function commitGroundHeight(value: string) {
    const parsed = Number(value);
    const nextHeight = Number.isFinite(parsed) ? clampNumber(parsed, GROUND_HEIGHT_MIN, GROUND_HEIGHT_MAX) : scene.groundHeight;
    updateScene({ groundHeight: nextHeight });
    setGroundHeightDraft(String(nextHeight));
  }

  return (
    <InspectorPanel title="场景属性" ariaLabel="3D场景右侧属性面板" className="scene-inspector">
      <InspectorRangeNumberField
        label="场景缩放"
        rangeAriaLabel="场景缩放滑杆"
        numberAriaLabel="场景缩放"
        max={SCENE_SCALE_MAX}
        min={SCENE_SCALE_MIN}
        step="0.01"
        value={sceneScaleDraft}
        onValueChange={commitSceneScale}
        onRangeChange={commitSceneScale}
        onNumberBlur={commitSceneScale}
        onNumberChange={(value) => {
          setSceneScaleDraft(value);
          if (value !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
              updateScene({ scale: parsed });
            }
          }
        }}
      />
      <InspectorAxisGroup
        label="场景平移"
        axes={[
          {
            axis: "X",
            ariaLabel: "场景平移 X",
            step: "0.1",
            value: scene.position[0],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: "场景平移 Y",
            step: "0.1",
            value: scene.position[1],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: "场景平移 Z",
            step: "0.1",
            value: scene.position[2],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorAxisGroup
        label="场景旋转"
        axes={[
          {
            axis: "X",
            ariaLabel: "场景旋转 X",
            step: "1",
            value: scene.rotation[0],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: "场景旋转 Y",
            step: "1",
            value: scene.rotation[1],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: "场景旋转 Z",
            step: "1",
            value: scene.rotation[2],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorSection title="全景背景">
        {panoramaAsset ? (
          <div className="panorama-thumbnail-card" aria-label="全景图缩略图卡片">
            <button
              aria-label="删除全景图"
              className="panorama-thumbnail-delete"
              type="button"
              onClick={() => removePanoramaAsset()}
            >
              <Trash2 aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
            <img className="panorama-thumbnail-image" alt={`${panoramaAsset.fileName} 全景图缩略图`} src={panoramaAsset.url} />
            <span className="panorama-thumbnail-name">{panoramaAsset.fileName}</span>
          </div>
        ) : (
          <button type="button" className="panorama-connect" onClick={() => void importBackground()}><ImagePlus size={17} />使用连接图片</button>
        )}
        {panoramaAsset && <button type="button" className="panorama-connect" onClick={() => void importBackground()}><ImagePlus size={16} />替换为连接图片</button>}
        <InspectorColorField
          label="天空颜色"
          colorAriaLabel="天空颜色"
          hexAriaLabel="天空颜色 HEX"
          value={scene.backgroundColor}
          onColorChange={(value) => updateScene({ backgroundColor: value })}
          onHexChange={(value) => updateScene({ backgroundColor: value })}
        />
      </InspectorSection>
      <InspectorSection title="全景球">
        <InspectorRangeNumberField
          label="水平旋转"
          rangeAriaLabel="全景球水平旋转滑杆"
          numberAriaLabel="全景球水平旋转"
          max={PANORAMA_YAW_MAX}
          min={PANORAMA_YAW_MIN}
          step="1"
          value={panoramaYawDraft}
          onValueChange={commitPanoramaYaw}
          onRangeChange={commitPanoramaYaw}
          onNumberBlur={commitPanoramaYaw}
          onNumberChange={(value) => {
            setPanoramaYawDraft(value);
            if (value !== "") {
              const parsed = Number(value);
              if (Number.isFinite(parsed)) {
                updateScene({ panoramaYaw: parsed });
              }
            }
          }}
        />
        <InspectorRangeNumberField
          label="球形半径"
          rangeAriaLabel="全景球半径滑杆"
          numberAriaLabel="全景球半径"
          max={PANORAMA_RADIUS_MAX}
          min={PANORAMA_RADIUS_MIN}
          step="1"
          value={panoramaRadiusDraft}
          onValueChange={commitPanoramaRadius}
          onRangeChange={commitPanoramaRadius}
          onNumberBlur={commitPanoramaRadius}
          onNumberChange={(value) => {
            setPanoramaRadiusDraft(value);
            if (value !== "") {
              const parsed = Number(value);
              if (Number.isFinite(parsed)) {
                updateScene({ panoramaRadius: parsed });
              }
            }
          }}
        />
      </InspectorSection>
      <InspectorSection title="开关项">
        <div className="scene-switch-row" role="group" aria-label="开关项设置">
          <div className="inspector-toggle-row">
            <input
              aria-label="角色标签"
              checked={scene.showLabels}
              type="checkbox"
              onChange={(event) => updateScene({ showLabels: event.target.checked })}
            />
            <span>角色标签</span>
          </div>
          <div className="inspector-toggle-row">
            <input
              aria-label="网格吸附"
              checked={scene.snapToGrid}
              type="checkbox"
              onChange={(event) => updateScene({ snapToGrid: event.target.checked })}
            />
            <span>网格吸附</span>
          </div>
          <div className="inspector-toggle-row">
            <input
              aria-label="地面"
              checked={scene.showGround}
              type="checkbox"
              onChange={(event) => updateScene({ showGround: event.target.checked })}
            />
            <span>地面</span>
          </div>
        </div>
      </InspectorSection>
      {scene.showGround ? (
        <InspectorSection title="地面">
          <InspectorRangeNumberField
            label="透明度"
            rangeAriaLabel="地面透明度滑杆"
            numberAriaLabel="地面透明度"
            max="1"
            min="0"
            step="0.01"
            value={scene.groundOpacity}
            onValueChange={(value) => updateScene({ groundOpacity: Number(value) })}
          />
          <InspectorRangeNumberField
            label="高度"
            rangeAriaLabel="地面高度滑杆"
            numberAriaLabel="地面高度"
            max={GROUND_HEIGHT_MAX}
            min={GROUND_HEIGHT_MIN}
            step="0.1"
            value={groundHeightDraft}
            onValueChange={commitGroundHeight}
            onRangeChange={commitGroundHeight}
            onNumberBlur={commitGroundHeight}
            onNumberChange={(value) => {
              setGroundHeightDraft(value);
              if (value !== "") {
                const parsed = Number(value);
                if (Number.isFinite(parsed)) {
                  updateScene({ groundHeight: parsed });
                }
              }
            }}
          />
        </InspectorSection>
      ) : null}
    </InspectorPanel>
  );
}
