import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";

export type MyAssetType = "text" | "image" | "video";

export type MyAsset = {
  id: string;
  userId: string;
  visibility: "private";
  title: string;
  type: MyAssetType;
  coverUrl: string;
  tags: string[];
  category: string;
  description: string;
  content: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type MyAssetListResponse = {
  items: MyAsset[];
  tags: string[];
  total: number;
};

export type MyAssetQuery = {
  keyword?: string;
  type?: string;
  tag?: string[];
  page?: number;
  pageSize?: number;
};

export async function fetchMyAssets(token: string, query: MyAssetQuery = {}) {
  return apiGet<MyAssetListResponse>("/api/assets/me", compactApiParams(query), token);
}

export async function saveMyAsset(token: string, asset: Partial<MyAsset>) {
  return apiPost<MyAsset>("/api/assets/me", asset, token);
}

export async function deleteMyAsset(token: string, id: string) {
  return apiDelete<boolean>(`/api/assets/me/${encodeURIComponent(id)}`, token);
}
