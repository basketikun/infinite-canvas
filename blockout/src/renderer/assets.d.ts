// Bundled static assets (vite returns the emitted URL).
declare module '*.png' {
  const url: string
  export default url
}
