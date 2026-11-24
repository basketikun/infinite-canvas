// 普通 CSS 随包加载；需要传给 definePlugin.css 的文本必须显式导入。
declare module "*.css" {}
declare module "*.css?inline" {
    const css: string;
    export default css;
}
declare module "*.png" { const url: string; export default url; }
declare module "*.jpg" { export { default } from "*.png"; }
declare module "*.jpeg" { export { default } from "*.png"; }
declare module "*.gif" { export { default } from "*.png"; }
declare module "*.svg" { export { default } from "*.png"; }
declare module "*.webp" { export { default } from "*.png"; }
declare module "*.avif" { export { default } from "*.png"; }
declare module "*.woff" { export { default } from "*.png"; }
declare module "*.woff2" { export { default } from "*.png"; }
declare module "*.ttf" { export { default } from "*.png"; }
declare module "*.otf" { export { default } from "*.png"; }
declare module "*.mp4" { export { default } from "*.png"; }
declare module "*.webm" { export { default } from "*.png"; }
declare module "*.mp3" { export { default } from "*.png"; }
declare module "*.wav" { export { default } from "*.png"; }
