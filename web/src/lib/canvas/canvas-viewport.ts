export const MIN_CANVAS_SCALE = 0.05;
export const MAX_CANVAS_SCALE = 32;

export function clampCanvasScale(scale: number) {
    return Math.min(Math.max(scale, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
}

export function scaleToSliderValue(scale: number) {
    const bounded = clampCanvasScale(scale);
    return ((Math.log(bounded) - Math.log(MIN_CANVAS_SCALE)) / (Math.log(MAX_CANVAS_SCALE) - Math.log(MIN_CANVAS_SCALE))) * 1000;
}

export function sliderValueToScale(value: number) {
    const progress = Math.min(Math.max(value, 0), 1000) / 1000;
    return Math.exp(Math.log(MIN_CANVAS_SCALE) + progress * (Math.log(MAX_CANVAS_SCALE) - Math.log(MIN_CANVAS_SCALE)));
}
