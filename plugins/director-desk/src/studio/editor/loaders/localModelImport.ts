import { keepFile } from "../io/session";
const LOCAL_MODEL_EXTENSION_RE = /\.(fbx|obj)$/i;

export async function readLocalModelFile(file: File) {
  if (!LOCAL_MODEL_EXTENSION_RE.test(file.name)) {
    throw new Error("当前仅支持 FBX / OBJ 模型文件");
  }

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    name: file.name.replace(LOCAL_MODEL_EXTENSION_RE, ""),
    url: await keepFile(file),
  };
}
