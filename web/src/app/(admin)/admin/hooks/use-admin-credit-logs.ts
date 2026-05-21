"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";

import { fetchAdminCreditLogs } from "@/services/api/admin-activities";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 20;

export function useAdminCreditLogs() {
  const { message } = App.useApp();
  const token = useUserStore((state) => state.token);
  const clearSession = useUserStore((state) => state.clearSession);
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const query = useQuery({
    queryKey: ["admin", "credit-logs", token, keyword, type, page, pageSize],
    queryFn: () => fetchAdminCreditLogs(token, { keyword, type, page, pageSize }),
    enabled: Boolean(token),
    retry: false,
  });

  useEffect(() => {
    if (query.isError) {
      const errorMessage = query.error instanceof Error ? query.error.message : "读取积分流水失败";
      message.error(errorMessage);
      if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) {
        clearSession();
      }
    }
  }, [clearSession, message, query.error, query.isError]);

  const updateFilters = (next: Partial<{ keyword: string; type: string; page: number; pageSize: number }>) => {
    const state = { keyword, type, page, pageSize, ...next };
    if (next.keyword !== undefined || next.type !== undefined || next.pageSize !== undefined) state.page = 1;
    setKeyword(state.keyword);
    setType(state.type);
    setPage(state.page);
    setPageSize(state.pageSize);
  };

  return {
    items: query.data?.items || [],
    total: query.data?.total || 0,
    isLoading: query.isFetching,
    keyword,
    type,
    page,
    pageSize,
    searchKeyword: (value = keyword) => updateFilters({ keyword: value }),
    changeType: (value: string) => updateFilters({ type: value }),
    changePage: (value: number) => updateFilters({ page: value }),
    changePageSize: (value: number) => updateFilters({ pageSize: value }),
    resetFilters: () => updateFilters({ keyword: "", type: "", page: 1, pageSize: defaultPageSize }),
    refresh: () => query.refetch(),
  };
}
