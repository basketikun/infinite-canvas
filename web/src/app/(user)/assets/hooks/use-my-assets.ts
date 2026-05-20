"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { deleteMyAsset, fetchMyAssets, saveMyAsset, type MyAsset } from "@/services/api/my-assets";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 12;

export function useMyAssets() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const token = useUserStore((state) => state.token);
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("");
  const [tag, setTag] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const query = useQuery({
    queryKey: ["my-assets", token, keyword, type, tag, page, pageSize],
    queryFn: () => fetchMyAssets(token, { keyword, type, tag, page, pageSize }),
    enabled: Boolean(token),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (asset: Partial<MyAsset>) => saveMyAsset(token, asset),
    onSuccess: async (_, asset) => {
      await queryClient.invalidateQueries({ queryKey: ["my-assets"] });
      message.success(asset.id ? "素材已保存" : "素材已新增");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMyAsset(token, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-assets"] });
      message.success("素材已删除");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  useEffect(() => {
    if (query.isError) {
      message.error(query.error instanceof Error ? query.error.message : "读取素材失败");
    }
  }, [message, query.error, query.isError]);

  const updateFilters = (next: Partial<{ keyword: string; type: string; tag: string[]; page: number; pageSize: number }>) => {
    const merged = { keyword, type, tag, page, pageSize, ...next };
    if (next.keyword !== undefined || next.type !== undefined || next.tag !== undefined || next.pageSize !== undefined) {
      merged.page = 1;
    }
    setKeyword(merged.keyword);
    setType(merged.type);
    setTag(merged.tag);
    setPage(merged.page);
    setPageSize(merged.pageSize);
  };

  const data = query.data;

  return {
    assets: data?.items || [],
    tags: data?.tags || [],
    total: data?.total || 0,
    keyword,
    type,
    tag,
    page,
    pageSize,
    isLoading: query.isFetching || saveMutation.isPending || deleteMutation.isPending,
    searchAssets: (value = keyword) => updateFilters({ keyword: value }),
    changeType: (value: string) => updateFilters({ type: value, tag: [] }),
    changeTag: (value: string[]) => updateFilters({ tag: value }),
    changePage: (value: number) => updateFilters({ page: value }),
    changePageSize: (value: number) => updateFilters({ pageSize: value }),
    resetFilters: () => updateFilters({ keyword: "", type: "", tag: [], page: 1, pageSize: defaultPageSize }),
    refresh: () => query.refetch(),
    saveAsset: async (asset: Partial<MyAsset>) => {
      return await saveMutation.mutateAsync(asset);
    },
    deleteAsset: async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
  };
}
