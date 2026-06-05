"use client";

import { Modal, QRCode, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

import { fetchMyMembership, fetchMyMembershipOrders, type MembershipOrder } from "@/services/api/membership";
import { useUserStore } from "@/stores/use-user-store";

type Props = {
    order: MembershipOrder | null;
    onClose: () => void;
    onPaid?: () => void;
};

// WechatPayModal 微信 Native 扫码弹窗，自动轮询订单状态。
// 当后端 payUrl 是 weixin:// 开头时使用本组件。
export function WechatPayModal({ order, onClose, onPaid }: Props) {
    const token = useUserStore((state) => state.token);
    const setSession = useUserStore((state) => state.setSession);
    const [status, setStatus] = useState<"pending" | "paid" | "cancelled">("pending");
    const stoppedRef = useRef(false);

    useEffect(() => {
        if (!order || !token) return;
        stoppedRef.current = false;
        setStatus("pending");
        const timer = setInterval(async () => {
            if (stoppedRef.current) return;
            try {
                const res = await fetchMyMembershipOrders(token, { pageSize: 20 });
                const fresh = res.items?.find((item) => item.id === order.id);
                if (!fresh) return;
                if (fresh.status === "paid") {
                    stoppedRef.current = true;
                    setStatus("paid");
                    try {
                        const me = await fetchMyMembership(token);
                        setSession(token, me);
                    } catch {
                        // 忽略
                    }
                    onPaid?.();
                    setTimeout(() => onClose(), 800);
                } else if (fresh.status === "cancelled") {
                    stoppedRef.current = true;
                    setStatus("cancelled");
                }
            } catch {
                // 静默重试
            }
        }, 3000);
        return () => {
            stoppedRef.current = true;
            clearInterval(timer);
        };
    }, [order, token, setSession, onPaid, onClose]);

    return (
        <Modal open={Boolean(order)} onCancel={onClose} footer={null} title="微信扫码支付" destroyOnHidden>
            {order ? (
                <div className="flex flex-col items-center gap-4 py-4">
                    {status === "paid" ? (
                        <>
                            <QRCode value={order.payUrl || " "} status="active" size={220} />
                            <Typography.Text type="success">支付成功，权益已发放</Typography.Text>
                        </>
                    ) : status === "cancelled" ? (
                        <Typography.Text type="warning">订单已取消</Typography.Text>
                    ) : (
                        <>
                            <QRCode value={order.payUrl || " "} size={220} />
                            <Typography.Text>请使用微信扫码支付</Typography.Text>
                            <Typography.Text type="secondary" className="text-xs">
                                金额 ¥ {(order.amount / 100).toFixed(2)} · 订单 {order.id}
                            </Typography.Text>
                            <Spin size="small" tip="等待支付结果中..." />
                        </>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}
