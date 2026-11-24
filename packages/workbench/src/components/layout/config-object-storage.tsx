import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import type { ObjectStorageConfig } from "@infinite-canvas/shared/object-storage";
import { useWorkspaceConfigStore } from "@workbench/stores/use-workspace-config-store";
import { SettingsNetworkSwitch, SettingsPasswordInput } from "./settings-network-controls";
import "./config-network.css";

const fields: { key: Exclude<keyof ObjectStorageConfig, "forcePathStyle">; label: string; placeholder?: string; passwordAutoComplete?: string }[] = [
    { key: "endpoint", label: "上传服务地址", placeholder: "https://s3.example.com" },
    { key: "region", label: "存储区域", placeholder: "cn-beijing" },
    { key: "bucket", label: "存储桶名称" },
    { key: "publicBaseUrl", label: "公开访问地址", placeholder: "https://media.example.com" },
    { key: "accessKeyId", label: "Access Key ID", passwordAutoComplete: "off" },
    { key: "secretAccessKey", label: "Secret Access Key", passwordAutoComplete: "new-password" },
];

export function ConfigObjectStorage() {
    const storage = useWorkspaceConfigStore((state) => state.objectStorage);
    const update = useWorkspaceConfigStore((state) => state.updateObjectStorage);
    return (
        <div className="settings-network generation-workspace-controls">
            <p className="mb-4 text-sm opacity-65">需要公开链接的调用方式会将本地参考素材上传到这里；已有公开链接直接使用。支持 S3 兼容存储，包括 TOS、R2、MinIO。</p>
            <div className="grid gap-x-4 md:grid-cols-2">
                {fields.map(({ key, label, placeholder, passwordAutoComplete }) => {
                    const id = `object-storage-${key}`;
                    return <div key={key} className="mb-6 min-w-0">
                        <label htmlFor={id} className="mb-2 block w-fit">{label}</label>
                        {passwordAutoComplete ? <SettingsPasswordInput id={id} label={label} value={storage[key]} autoComplete={passwordAutoComplete} onChange={(event) => void update(key, event.target.value)} />
                            : <Input id={id} className="settings-network-field" value={storage[key]} placeholder={placeholder} onChange={(event) => void update(key, event.target.value)} />}
                    </div>;
                })}
            </div>
            <label htmlFor="object-storage-path-style" className="mb-2 block w-fit">在地址路径中包含存储桶名称</label>
            <div className="flex min-h-8 items-center">
                <SettingsNetworkSwitch id="object-storage-path-style" aria-describedby="object-storage-path-hint" checked={storage.forcePathStyle} onCheckedChange={(checked) => void update("forcePathStyle", checked)} />
            </div>
            <p id="object-storage-path-hint" className="mb-6 min-h-6 text-muted-foreground">开启：地址/存储桶/文件；关闭：存储桶.地址/文件。按存储服务要求选择。</p>
            <p className="text-sm opacity-65">公开访问地址必须允许模型服务读取文件。上传的参考素材需在存储服务中自行管理。</p>
        </div>
    );
}
