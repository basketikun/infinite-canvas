import { keepFile } from "../io/session";
export const LOCAL_MODEL_EXTENSION_RE = /\.(fbx|obj|glb)$/i;

export async function readLocalModelFile(file: File, companions: File[] = []) {
  if (!LOCAL_MODEL_EXTENSION_RE.test(file.name)) {
    throw new Error("当前仅支持 FBX、OBJ 或 GLB 模型文件");
  }

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    name: file.name.replace(LOCAL_MODEL_EXTENSION_RE, ""),
    url: await keepFile(file),
    ...(companions.length ? { companions: Object.fromEntries(await Promise.all(companions.map(async (file) => [
      (file.webkitRelativePath || file.name).replace(/\\/g, "/").toLowerCase(), await keepFile(file),
    ]))) } : {}),
  };
}
