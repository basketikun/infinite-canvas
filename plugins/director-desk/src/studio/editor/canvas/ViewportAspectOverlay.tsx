import { Grid3X3 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ViewportAspectRatio } from "../schema/viewportAspectRatio";
import {
  FRAME_TOP_PADDING,
  getViewportAspectFrameRect,
} from "./viewportAspectFrame";

export function ViewportAspectOverlay({
  ratio,
  bottomPadding = FRAME_TOP_PADDING,
  showRuleOfThirds = false,
  onToggleRuleOfThirds,
}: {
  ratio: ViewportAspectRatio;
  bottomPadding?: number;
  showRuleOfThirds?: boolean;
  onToggleRuleOfThirds?: (enabled: boolean) => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = overlayRef.current;
    if (!element) return;

    let timeoutId = 0;
    let animationFrameId = 0;
    let resizeObserver: ResizeObserver | null = null;

    const updateSize = () => {
      const nextSize = {
        width: element.clientWidth,
        height: element.clientHeight,
      };

      setOverlaySize((currentSize) =>
        currentSize.width === nextSize.width && currentSize.height === nextSize.height ? currentSize : nextSize
      );

      if ((nextSize.width === 0 || nextSize.height === 0) && timeoutId === 0) {
        timeoutId = window.setTimeout(() => {
          timeoutId = 0;
          updateSize();
        }, 60);
      }
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(updateSize);
    };

    updateSize();
    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.clearTimeout(timeoutId);
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener("resize", scheduleUpdate);
      };
    }

    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(element);

    return () => {
      window.clearTimeout(timeoutId);
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [ratio]);

  const frameRect = useMemo(() => {
    return getViewportAspectFrameRect(
      ratio,
      overlaySize.width,
      overlaySize.height,
      bottomPadding
    );
  }, [bottomPadding, overlaySize.height, overlaySize.width, ratio]);

  const shellStyle = useMemo(() => {
    if (!frameRect) return null;

    return {
      width: `${frameRect.width}px`,
      height: `${frameRect.height}px`,
      left: `${frameRect.left}px`,
      top: `${frameRect.top}px`,
    };
  }, [frameRect]);

  const maskStyle = useMemo(() => {
    if (!frameRect) return null;

    return {
      "--viewport-aspect-frame-left": `${frameRect.left}px`,
      "--viewport-aspect-frame-top": `${frameRect.top}px`,
      "--viewport-aspect-frame-width": `${frameRect.width}px`,
      "--viewport-aspect-frame-height": `${frameRect.height}px`,
    } as CSSProperties;
  }, [frameRect]);

  if (!shellStyle || !frameRect) return null;

  const guideToggleLabel = showRuleOfThirds ? "关闭九宫格辅助线" : "开启九宫格辅助线";

  return (
    <div className="viewport-aspect-overlay" ref={overlayRef}>
      {maskStyle ? (
        <div className="viewport-aspect-mask" aria-label="视口画幅遮罩" aria-hidden="true" style={maskStyle} />
      ) : null}
      <div className="viewport-aspect-frame-shell" aria-label="视口画幅框" data-aspect-ratio={ratio} style={shellStyle}>
        <button
          aria-label={guideToggleLabel}
          aria-pressed={showRuleOfThirds}
          className={`viewport-aspect-guide-toggle${showRuleOfThirds ? " is-active" : ""}`}
          type="button"
          onClick={() => onToggleRuleOfThirds?.(!showRuleOfThirds)}
        >
          <Grid3X3 aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
        {showRuleOfThirds ? (
          <div className="viewport-rule-of-thirds" aria-label="九宫格辅助线">
            <div
              aria-label="九宫格辅助线-竖线"
              aria-hidden="true"
              className="viewport-rule-of-thirds-line is-vertical is-one-third"
            />
            <div
              aria-label="九宫格辅助线-竖线"
              aria-hidden="true"
              className="viewport-rule-of-thirds-line is-vertical is-two-thirds"
            />
            <div
              aria-label="九宫格辅助线-横线"
              aria-hidden="true"
              className="viewport-rule-of-thirds-line is-horizontal is-one-third"
            />
            <div
              aria-label="九宫格辅助线-横线"
              aria-hidden="true"
              className="viewport-rule-of-thirds-line is-horizontal is-two-thirds"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
