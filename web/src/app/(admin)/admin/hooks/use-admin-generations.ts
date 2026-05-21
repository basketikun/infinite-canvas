"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";

import { fetchAdminGenerations } from "@/services/api/admin-activities";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 20;

export function useAdminGenerations() {
  const { message } = App.useApp();
  const token = useUserStore((state) => state.token);
  const clearSession = useUserStore((state) => state.clearSession);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const query = useQuery({
    queryKey: ["admin", "generations", token, keyword, status, page, pageSize],
    queryFn: () => fetchAdminGenerations(token, { keyword, status, page, pageSize }),
    enabled: Boolean(token),
    retry: false,
  });

  useEffect(() => {
    if (query.isError) {
      const errorMessage = query.error instanceof Error ? query.error.message : "读取生图记录失败";
      message.error(errorMessage);
      if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) {
        clearSession();
      }
    }
  }, [clearSession, message, query.error, query.isError]);

  const updateFilters = (next: Partial<{ keyword: string; status: string; page: number; pageSize: number }>) => {
    const state = { keyword, status, page, pageSize, ...next };
    if (next.keyword !== undefined || next.status !== undefined || next.pageSize !== undefined) state.page = 1;
    setKeyword(state.keyword);
    setStatus(state.status);
    setPage(state.page);
    setPageSize(state.pageSize);
  };

  return {
    items: query.data?.items || [],
    total: query.data?.total || 0,
    isLoading: query.isFetching,
    keyword,
    status,
    page,
    pageSize,
    searchKeyword: (value = keyword) => updateFilters({ keyword: value }),
    changeStatus: (value: string) => updateFilters({ status: value }),
    changePage: (value: number) => updateFilters({ page: value }),
    changePageSize: (value: number) => updateFilters({ pageSize: value }),
    resetFilters: () => updateFilters({ keyword: "", status: "", page: 1, pageSize: defaultPageSize }),
    refresh: () => query.refetch(),
  };
}
