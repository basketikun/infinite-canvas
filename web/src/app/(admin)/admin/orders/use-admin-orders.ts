"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { deleteAdminMembershipOrder, fetchAdminMembershipOrders, markAdminMembershipOrderPaid } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminOrders() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const query = useQuery({
        queryKey: ["admin", "membership-orders", token, keyword, page, pageSize],
        queryFn: () => fetchAdminMembershipOrders(token, { keyword, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    const payMutation = useMutation({
        mutationFn: ({ id, paymentId }: { id: string; paymentId?: string }) => markAdminMembershipOrderPaid(token, id, paymentId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "membership-orders"] });
            message.success("订单已标记为已支付，权益已发放");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "操作失败"),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminMembershipOrder(token, id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "membership-orders"] });
            message.success("订单已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : "读取订单失败";
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError]);

    const updateFilters = (next: Partial<{ keyword: string; page: number; pageSize: number }>) => {
        const queryState = { keyword, page, pageSize, ...next };
        if (next.keyword !== undefined || next.pageSize !== undefined) queryState.page = 1;
        setKeyword(queryState.keyword);
        setPage(queryState.page);
        setPageSize(queryState.pageSize);
    };

    const data = query.data;

    return {
        orders: data?.items || [],
        keyword,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching || payMutation.isPending || deleteMutation.isPending,
        searchOrders: (value = keyword) => updateFilters({ keyword: value }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", page: 1, pageSize: defaultPageSize }),
        refreshOrders: () => query.refetch(),
        markPaid: (id: string, paymentId?: string) => payMutation.mutateAsync({ id, paymentId }),
        deleteOrder: (id: string) => deleteMutation.mutateAsync(id),
    };
}
