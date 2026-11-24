import { z } from "zod";

export type ObjectStorageConfig = {
    /**
     * S3 兼容上传服务的根地址。
     */
    endpoint: string;
    /**
     * 服务要求的签名区域。
     */
    region: string;
    /**
     * 接收参考素材的存储桶。
     */
    bucket: string;
    /**
     * 具有写入权限的访问标识。
     */
    accessKeyId: string;
    /**
     * 用于上传签名的访问密钥。
     */
    secretAccessKey: string;
    /**
     * 与桶内对象路径对应的公开读取地址。
     */
    publicBaseUrl: string;
    /**
     * true 使用路径式寻址，false 使用虚拟主机式寻址。
     */
    forcePathStyle: boolean;
};

export const objectStorageConfigSchema: z.ZodType<ObjectStorageConfig> = z.object({
    endpoint: z.string(), region: z.string(), bucket: z.string(), accessKeyId: z.string(),
    secretAccessKey: z.string(), publicBaseUrl: z.string(), forcePathStyle: z.boolean(),
});
