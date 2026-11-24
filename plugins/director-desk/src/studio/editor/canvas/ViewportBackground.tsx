import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import {
  BackSide,
  ClampToEdgeWrapping,
  Color,
  EquirectangularReflectionMapping,
  LinearFilter,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import type { DirectorAssetRef, PanoramaProjectionMode } from "../schema/directorProject";
import { getPanoramaRotationRadians } from "./panoramaMath";

type PanoramaTextureState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; texture: Texture }
  | { status: "error"; error: Error };

export function configurePanoramaTexture(texture: Texture, projectionMode: PanoramaProjectionMode = "equirectangular") {
  texture.colorSpace = SRGBColorSpace;
  if (projectionMode === "equirectangular") {
    texture.mapping = EquirectangularReflectionMapping;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
  } else {
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.repeat.set(-1, 1);
    texture.offset.set(1, 0);
  }
  texture.needsUpdate = true;
  return texture;
}

function toTextureLoadError(error: unknown) {
  if (error instanceof Error) return error;
  return new Error("全景图纹理加载失败");
}

function usePanoramaTexture(url: string | null, projectionMode: PanoramaProjectionMode): PanoramaTextureState {
  const [state, setState] = useState<PanoramaTextureState>({ status: "idle" });

  useEffect(() => {
    if (!url) {
      setState({ status: "idle" });
      return undefined;
    }

    let cancelled = false;
    setState({ status: "loading" });

    let texture: Texture | null = null;

    try {
      texture = new TextureLoader().load(
        url,
        (loadedTexture) => {
          if (cancelled) {
            loadedTexture.dispose();
            return;
          }

          setState({ status: "ready", texture: configurePanoramaTexture(loadedTexture, projectionMode) });
        },
        undefined,
        (error) => {
          if (!cancelled) {
            setState({ status: "error", error: toTextureLoadError(error) });
          }
        }
      );
    } catch (error) {
      setState({ status: "error", error: toTextureLoadError(error) });
    }

    return () => {
      cancelled = true;
      texture?.dispose();
    };
  }, [projectionMode, url]);

  return state;
}

export function ViewportBackground({
  backgroundColor,
  panoramaAsset,
  panoramaRadius,
  panoramaYaw,
}: {
  backgroundColor: string;
  panoramaAsset?: DirectorAssetRef | null;
  panoramaRadius: number;
  panoramaYaw: number;
}) {
  const { gl, scene } = useThree();
  const projectionMode = panoramaAsset?.projectionMode ?? "equirectangular";
  const textureState = usePanoramaTexture(panoramaAsset?.url ?? null, projectionMode);
  const safeRadius = Math.max(10, panoramaRadius);
  const rotationY = getPanoramaRotationRadians(panoramaYaw);
  const fallbackColor = useMemo(() => new Color(backgroundColor), [backgroundColor]);

  useEffect(() => {
    const nextBackground =
      textureState.status === "ready" && projectionMode === "equirectangular" ? textureState.texture : fallbackColor;

    scene.background = nextBackground;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;
    scene.backgroundRotation.set(0, textureState.status === "ready" && projectionMode === "equirectangular" ? rotationY : 0, 0);
    gl.setClearColor(fallbackColor, 1);
  }, [fallbackColor, gl, projectionMode, rotationY, scene, textureState]);

  return (
    <>
      {textureState.status === "ready" && projectionMode === "backdrop" ? (
        <mesh
          frustumCulled={false}
          name="panorama-backdrop-dome"
          renderOrder={-1000}
          rotation={[0, rotationY, 0]}
        >
          <sphereGeometry args={[safeRadius, 96, 64]} />
          <meshBasicMaterial
            depthWrite={false}
            map={textureState.texture}
            side={BackSide}
            toneMapped={false}
          />
        </mesh>
      ) : null}
      {textureState.status === "error" ? (
        <Html center>
          <div className="viewport-error-card" role="status">
            <strong>全景图加载失败</strong>
            <span>请重新导入 JPG / PNG / WEBP 图片</span>
          </div>
        </Html>
      ) : null}
    </>
  );
}
