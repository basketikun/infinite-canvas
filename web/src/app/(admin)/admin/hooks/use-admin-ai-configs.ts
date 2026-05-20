"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import {
  deleteAdminAIConfig,
  enableAdminAIConfig,
  fetchAdminAIConfigs,
  probeAdminAIConfigModels,
  saveAdminAIConfig,
  testAdminAIConfig,
  type AdminAIConfigPayload,
  type AdminAIConfigProbeRequest,
} from "@/services/api/ai-configs";
import { useUserStore } from "@/stores/use-user-store";

export function useAdminAIConfigs() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const token = useUserStore((state) => state.token);
  const clearSession = useUserStore((state) => state.clearSession);

  const query = useQuery({
    queryKey: ["admin", "ai-configs", token],
    queryFn: () => fetchAdminAIConfigs(token),
    enabled: Boolean(token),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: AdminAIConfigPayload) => saveAdminAIConfig(token, payload),
    onSuccess: async (_, payload) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "ai-configs"] });
      message.success(payload.id ? "配置已保存" : "配置已新增");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminAIConfig(token, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "ai-configs"] });
      message.success("配置已删除");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  const enableMutation = useMutation({
    mutationFn: (id: string) => enableAdminAIConfig(token, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "ai-configs"] });
      message.success("已切换启用配置");
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "启用失败");
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testAdminAIConfig(token, id),
    onSuccess: (result) => {
      message.success(`配置可用，上游返回 ${result.modelCount} 个模型`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "测试失败");
    },
  });

  const probeMutation = useMutation({
    mutationFn: (payload: AdminAIConfigProbeRequest) => probeAdminAIConfigModels(token, payload),
    onSuccess: (result) => {
      message.success(`已获取 ${result.items.length} 个模型`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "获取模型列表失败");
    },
  });

  useEffect(() => {
    if (query.isError) {
      const errorMessage = query.error instanceof Error ? query.error.message : "读取配置失败";
      message.error(errorMessage);
      if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) {
        clearSession();
      }
    }
  }, [clearSession, message, query.error, query.isError]);

  return {
    configs: query.data?.items || [],
    total: query.data?.total || 0,
    isLoading: query.isFetching || saveMutation.isPending || deleteMutation.isPending || enableMutation.isPending,
    isTesting: testMutation.isPending,
    isProbing: probeMutation.isPending,
    refreshConfigs: () => query.refetch(),
    saveConfig: (payload: AdminAIConfigPayload) => saveMutation.mutateAsync(payload),
    deleteConfig: (id: string) => deleteMutation.mutateAsync(id),
    enableConfig: (id: string) => enableMutation.mutateAsync(id),
    testConfig: (id: string) => testMutation.mutateAsync(id),
    probeModels: (payload: AdminAIConfigProbeRequest) => probeMutation.mutateAsync(payload),
  };
}
