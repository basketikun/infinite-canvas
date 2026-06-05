"use client";

import { App, Badge, Button, Card, Empty, Flex, Modal, Segmented, Space, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { Check, Crown, Sparkles, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CreditSymbol } from "@/constant/credits";
import { WechatPayModal } from "@/components/wechat-pay-modal";
import {
    createMembershipOrder,
    fetchMembershipPlans,
    fetchMyMembership,
    mockPayMembershipOrder,
    type MembershipOrder,
    type MembershipPlan,
    type PaymentProvider,
} from "@/services/api/membership";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const providerLabels: Record<PaymentProvider, string> = {
    wechat: "微信支付",
    alipay: "支付宝",
    mock: "模拟支付",
};

function parseFeatures(features: string): string[] {
    if (!features) return [];
    try {
        const parsed = JSON.parse(features);
        if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
    } catch {
        // 回退：按行分割
        return features.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function formatPrice(cents: number) {
    return (cents / 100).toFixed(2);
}

function levelColor(level: string) {
    if (level === "svip") return "magenta";
    if (level === "vip") return "gold";
    return "default";
}

export default function MembershipPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const setSession = useUserStore((state) => state.setSession);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const membershipEnabled = publicSettings?.membership?.enabled !== false;
    const paymentMethods = (publicSettings?.membership?.paymentMethods || []) as PaymentProvider[];
    const serviceNotice = publicSettings?.membership?.serviceNotice || "";

    const [plans, setPlans] = useState<MembershipPlan[]>([]);
    const [loading, setLoading] = useState(false);
    const [purchasing, setPurchasing] = useState<MembershipPlan | null>(null);
    const [provider, setProvider] = useState<PaymentProvider>("wechat");
    const [submitting, setSubmitting] = useState(false);
    const [wechatOrder, setWechatOrder] = useState<MembershipOrder | null>(null);

    const availableProviders = useMemo<PaymentProvider[]>(() => {
        const list = paymentMethods.length > 0 ? paymentMethods : (["wechat", "alipay"] as PaymentProvider[]);
        return list.filter((item) => item === "wechat" || item === "alipay" || item === "mock");
    }, [paymentMethods]);

    useEffect(() => {
        if (availableProviders.length > 0 && !availableProviders.includes(provider)) {
            setProvider(availableProviders[0]);
        }
    }, [availableProviders, provider]);

    useEffect(() => {
        if (!isReady) return;
        if (!token) {
            router.replace("/login?redirect=/membership");
            return;
        }
        let cancelled = false;
        setLoading(true);
        fetchMembershipPlans(token, { pageSize: 50 })
            .then((res) => {
                if (!cancelled) setPlans(res.items || []);
            })
            .catch((err: Error) => message.error(err.message || "加载套餐失败"))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isReady, token, router, message]);

    const refreshMembership = async () => {
        if (!token || !user) return;
        try {
            const fresh = await fetchMyMembership(token);
            setSession(token, fresh);
        } catch (err) {
            message.error((err as Error).message || "刷新会员状态失败");
        }
    };

    const submitOrder = async () => {
        if (!purchasing || !token) return;
        setSubmitting(true);
        try {
            const order = await createMembershipOrder(token, purchasing.id, provider);
            if (provider === "mock") {
                await mockPayMembershipOrder(token, order.id);
                await refreshMembership();
                message.success("购买成功");
                setPurchasing(null);
                return;
            }
            setPurchasing(null);
            if (order.payUrl && order.payUrl.startsWith("weixin://")) {
                setWechatOrder(order);
                return;
            }
            if (order.payUrl) {
                message.info("正在跳转支付页面");
                window.location.href = order.payUrl;
                return;
            }
            message.warning("未获取到支付链接，请到我的订单重试");
            router.push(`/orders?focus=${encodeURIComponent(order.id)}`);
        } catch (err) {
            message.error((err as Error).message || "下单失败");
        } finally {
            setSubmitting(false);
        }
    };

    if (!isReady || !token) {
        return (
            <Flex align="center" justify="center" className="h-full">
                <Spin />
            </Flex>
        );
    }

    if (!membershipEnabled) {
        return (
            <Flex align="center" justify="center" className="h-full">
                <Empty description="会员功能尚未开启" />
            </Flex>
        );
    }

    const expiresAt = user?.membershipExpiresAt ? dayjs(user.membershipExpiresAt) : null;
    const isActive = user?.membershipLevel && user.membershipLevel !== "free" && expiresAt && expiresAt.isAfter(dayjs());

    return (
        <main className="mx-auto h-full max-w-5xl overflow-auto px-6 py-10">
            <Flex vertical gap={24}>
                <Card variant="borderless">
                    <Flex align="center" justify="space-between" wrap="wrap" gap={12}>
                        <Space size={16}>
                            <Crown className="text-yellow-500" />
                            <Flex vertical>
                                <Typography.Title level={4} className="!mb-0">
                                    会员中心
                                </Typography.Title>
                                <Typography.Text type="secondary">解锁更多算力点、专属功能与优先队列</Typography.Text>
                            </Flex>
                        </Space>
                        <Flex vertical align="end">
                            <Space size={8}>
                                <Tag color={levelColor(user?.membershipLevel || "free")}>{isActive ? (user?.membershipLevel === "svip" ? "SVIP" : "VIP") : "普通用户"}</Tag>
                                {isActive && expiresAt ? <Typography.Text type="secondary">有效期至 {expiresAt.format("YYYY-MM-DD")}</Typography.Text> : null}
                            </Space>
                            <Space size={4}>
                                <CreditSymbol className="text-sm text-yellow-500" />
                                <Typography.Text strong>{(user?.credits ?? 0).toLocaleString()} 算力点</Typography.Text>
                            </Space>
                        </Flex>
                    </Flex>
                </Card>

                {serviceNotice ? (
                    <Card variant="borderless">
                        <Typography.Paragraph type="secondary" className="!mb-0">
                            {serviceNotice}
                        </Typography.Paragraph>
                    </Card>
                ) : null}

                <Spin spinning={loading}>
                    {plans.length === 0 ? (
                        <Empty description="暂无可购买套餐" />
                    ) : (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {plans.map((plan) => (
                                <Badge.Ribbon key={plan.id} text={plan.level === "svip" ? "尊享" : "推荐"} color={plan.level === "svip" ? "magenta" : "gold"}>
                                    <Card variant="outlined" className="h-full">
                                        <Flex vertical gap={12}>
                                            <Space size={8}>
                                                <Sparkles className="size-4 text-yellow-500" />
                                                <Typography.Title level={5} className="!mb-0">
                                                    {plan.name}
                                                </Typography.Title>
                                            </Space>
                                            {plan.description ? <Typography.Paragraph type="secondary" className="!mb-0 min-h-10">{plan.description}</Typography.Paragraph> : null}
                                            <Flex align="baseline" gap={4}>
                                                <Typography.Text type="secondary">¥</Typography.Text>
                                                <Typography.Title level={2} className="!mb-0 tabular-nums">
                                                    {formatPrice(plan.price)}
                                                </Typography.Title>
                                                <Typography.Text type="secondary">/ {plan.durationDays} 天</Typography.Text>
                                            </Flex>
                                            <Flex vertical gap={6}>
                                                {plan.creditsGranted > 0 ? (
                                                    <Space size={6}>
                                                        <Check className="size-4 text-green-500" />
                                                        <Typography.Text>
                                                            赠送 <Typography.Text strong>{plan.creditsGranted.toLocaleString()}</Typography.Text> 算力点
                                                        </Typography.Text>
                                                    </Space>
                                                ) : null}
                                                {plan.unlimited ? (
                                                    <Space size={6}>
                                                        <Check className="size-4 text-green-500" />
                                                        <Typography.Text>会员期内不消耗算力点</Typography.Text>
                                                    </Space>
                                                ) : null}
                                                {plan.priorityQueue ? (
                                                    <Space size={6}>
                                                        <Zap className="size-4 text-green-500" />
                                                        <Typography.Text>优先队列处理</Typography.Text>
                                                    </Space>
                                                ) : null}
                                                {parseFeatures(plan.features).map((feature) => (
                                                    <Space key={feature} size={6}>
                                                        <Check className="size-4 text-green-500" />
                                                        <Typography.Text>{feature}</Typography.Text>
                                                    </Space>
                                                ))}
                                            </Flex>
                                            <Button type="primary" block onClick={() => setPurchasing(plan)}>
                                                立即购买
                                            </Button>
                                        </Flex>
                                    </Card>
                                </Badge.Ribbon>
                            ))}
                        </div>
                    )}
                </Spin>
            </Flex>

            <Modal
                title="确认订单"
                open={Boolean(purchasing)}
                onCancel={() => setPurchasing(null)}
                onOk={() => void submitOrder()}
                okButtonProps={{ loading: submitting }}
                okText={provider === "mock" ? "确认支付" : "去支付"}
                cancelText="取消"
                destroyOnHidden
            >
                {purchasing ? (
                    <Flex vertical gap={16}>
                        <Flex justify="space-between">
                            <Typography.Text type="secondary">套餐</Typography.Text>
                            <Typography.Text strong>{purchasing.name}</Typography.Text>
                        </Flex>
                        <Flex justify="space-between">
                            <Typography.Text type="secondary">价格</Typography.Text>
                            <Typography.Text strong>¥ {formatPrice(purchasing.price)}</Typography.Text>
                        </Flex>
                        <Flex justify="space-between">
                            <Typography.Text type="secondary">有效期</Typography.Text>
                            <Typography.Text>{purchasing.durationDays} 天</Typography.Text>
                        </Flex>
                        <Flex vertical gap={6}>
                            <Typography.Text type="secondary">支付方式</Typography.Text>
                            <Segmented
                                block
                                value={provider}
                                onChange={(value) => setProvider(value as PaymentProvider)}
                                options={availableProviders.map((item) => ({ label: providerLabels[item], value: item }))}
                            />
                        </Flex>
                        <Typography.Paragraph type="secondary" className="!mb-0 text-xs">
                            支持微信、支付宝官方直连或 ZPay 聚合支付，由管理员在系统设置中开启对应渠道；本地调试可使用"模拟支付"直接发放权益。
                        </Typography.Paragraph>
                    </Flex>
                ) : null}
            </Modal>

            <WechatPayModal
                order={wechatOrder}
                onClose={() => setWechatOrder(null)}
                onPaid={() => {
                    void refreshMembership();
                    message.success("支付成功");
                }}
            />
        </main>
    );
}
