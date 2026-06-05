"use client";

import { App, Button, Card, Empty, Flex, Popconfirm, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { cancelMembershipOrder, fetchMyMembership, fetchMyMembershipOrders, mockPayMembershipOrder, refreshMembershipOrderPay, type MembershipOrder, type MembershipOrderStatus } from "@/services/api/membership";
import { WechatPayModal } from "@/components/wechat-pay-modal";
import { useUserStore } from "@/stores/use-user-store";

const statusLabel: Record<MembershipOrderStatus, { color: string; text: string }> = {
    pending: { color: "blue", text: "待支付" },
    paid: { color: "green", text: "已支付" },
    cancelled: { color: "default", text: "已取消" },
};

const providerLabel: Record<string, string> = {
    wechat: "微信支付",
    alipay: "支付宝",
    mock: "模拟支付",
};

function formatPrice(cents: number) {
    return `¥ ${(cents / 100).toFixed(2)}`;
}

export default function OrdersPage() {
    return (
        <Suspense fallback={null}>
            <OrdersContent />
        </Suspense>
    );
}

function OrdersContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = useUserStore((state) => state.token);
    const isReady = useUserStore((state) => state.isReady);
    const setSession = useUserStore((state) => state.setSession);
    const focusId = searchParams.get("focus") || "";
    const payStatus = searchParams.get("payStatus") || "";

    const [orders, setOrders] = useState<MembershipOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [wechatOrder, setWechatOrder] = useState<MembershipOrder | null>(null);

    const reload = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const res = await fetchMyMembershipOrders(token, { pageSize: 100 });
            setOrders(res.items || []);
        } catch (err) {
            message.error((err as Error).message || "加载订单失败");
        } finally {
            setLoading(false);
        }
    }, [token, message]);

    useEffect(() => {
        if (!isReady) return;
        if (!token) {
            router.replace("/login?redirect=/orders");
            return;
        }
        void reload();
    }, [isReady, token, router, reload]);

    useEffect(() => {
        if (payStatus === "success") message.success("支付完成，会员权益已发放");
        else if (payStatus === "fail") message.error("支付校验失败，请刷新订单或联系客服");
    }, [payStatus, message]);

    const refreshMembership = async () => {
        if (!token) return;
        try {
            const fresh = await fetchMyMembership(token);
            setSession(token, fresh);
        } catch {
            // 忽略
        }
    };

    const cancel = async (order: MembershipOrder) => {
        if (!token) return;
        try {
            await cancelMembershipOrder(token, order.id);
            message.success("已取消订单");
            await reload();
        } catch (err) {
            message.error((err as Error).message || "取消失败");
        }
    };

    const mockPay = async (order: MembershipOrder) => {
        if (!token) return;
        try {
            await mockPayMembershipOrder(token, order.id);
            message.success("模拟支付成功，权益已发放");
            await Promise.all([reload(), refreshMembership()]);
        } catch (err) {
            message.error((err as Error).message || "支付失败");
        }
    };

    const continuePay = async (order: MembershipOrder) => {
        if (!token) return;
        try {
            const fresh = order.payUrl ? order : await refreshMembershipOrderPay(token, order.id);
            const url = fresh.payUrl;
            if (!url) {
                message.error("未获取到支付链接");
                return;
            }
            if (url.startsWith("weixin://")) {
                setWechatOrder(fresh);
                return;
            }
            window.location.href = url;
        } catch (err) {
            message.error((err as Error).message || "拉起支付失败");
        }
    };

    const columns: ColumnsType<MembershipOrder> = [
        {
            title: "订单",
            dataIndex: "id",
            render: (_, item) => (
                <Flex vertical>
                    <Typography.Text strong>{item.planName}</Typography.Text>
                    <Typography.Text type="secondary" copyable>
                        {item.id}
                    </Typography.Text>
                </Flex>
            ),
        },
        { title: "金额", dataIndex: "amount", width: 120, render: (value: number) => <Typography.Text strong>{formatPrice(value)}</Typography.Text> },
        {
            title: "支付方式",
            dataIndex: "paymentProvider",
            width: 120,
            render: (value: string) => providerLabel[value] || value || "-",
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 110,
            render: (value: MembershipOrderStatus) => {
                const item = statusLabel[value] || { color: "default", text: value };
                return <Tag color={item.color}>{item.text}</Tag>;
            },
        },
        {
            title: "下单时间",
            dataIndex: "createdAt",
            width: 180,
            render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-"),
        },
        {
            title: "操作",
            key: "actions",
            width: 240,
            align: "right",
            render: (_, item) =>
                item.status === "pending" ? (
                    <Flex justify="end" gap={4}>
                        {item.paymentProvider !== "mock" ? (
                            <Button size="small" type="primary" onClick={() => void continuePay(item)}>
                                去支付
                            </Button>
                        ) : (
                            <Button size="small" type="primary" onClick={() => void mockPay(item)}>
                                模拟支付
                            </Button>
                        )}
                        <Button size="small" onClick={() => void reload()}>
                            刷新状态
                        </Button>
                        <Popconfirm title="确认取消该订单？" onConfirm={() => void cancel(item)}>
                            <Button size="small">取消</Button>
                        </Popconfirm>
                    </Flex>
                ) : null,
        },
    ];

    if (!isReady || !token) {
        return (
            <Flex align="center" justify="center" className="h-full">
                <Spin />
            </Flex>
        );
    }

    return (
        <main className="mx-auto h-full max-w-5xl overflow-auto px-6 py-10">
            <Flex vertical gap={16}>
                <Flex align="center" justify="space-between">
                    <Typography.Title level={4} className="!mb-0">
                        我的订单
                    </Typography.Title>
                    <Button onClick={() => void reload()}>刷新</Button>
                </Flex>
                {!loading && orders.length === 0 ? (
                    <Card variant="borderless">
                        <Empty description="暂无订单">
                            <Button type="primary" onClick={() => router.push("/membership")}>
                                去会员中心
                            </Button>
                        </Empty>
                    </Card>
                ) : (
                    <Card variant="borderless">
                        <Table
                            rowKey="id"
                            loading={loading}
                            columns={columns}
                            dataSource={orders}
                            pagination={false}
                            rowClassName={(record) => (record.id === focusId ? "bg-yellow-50 dark:bg-yellow-900/20" : "")}
                        />
                    </Card>
                )}
            </Flex>
            <WechatPayModal
                order={wechatOrder}
                onClose={() => setWechatOrder(null)}
                onPaid={() => {
                    void reload();
                    void refreshMembership();
                }}
            />
        </main>
    );
}
