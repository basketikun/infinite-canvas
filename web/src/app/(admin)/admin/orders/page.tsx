"use client";

import { CheckOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Input, Modal, Popconfirm, Row, Space, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import type { MembershipOrder, MembershipOrderStatus } from "@/services/api/membership";
import { useAdminOrders } from "./use-admin-orders";

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

export default function AdminOrdersPage() {
    const { orders, keyword, page, pageSize, total, isLoading, searchOrders, changePage, changePageSize, resetFilters, refreshOrders, markPaid, deleteOrder } = useAdminOrders();
    const [keywordText, setKeywordText] = useState(keyword);
    const [deleting, setDeleting] = useState<MembershipOrder | null>(null);

    useEffect(() => setKeywordText(keyword), [keyword]);

    const columns: ProColumns<MembershipOrder>[] = [
        {
            title: "订单",
            dataIndex: "id",
            width: 260,
            render: (_, item) => (
                <Flex vertical>
                    <Typography.Text strong>{item.planName}</Typography.Text>
                    <Typography.Text type="secondary" copyable>
                        {item.id}
                    </Typography.Text>
                </Flex>
            ),
        },
        { title: "用户", dataIndex: "userId", width: 180, render: (value: string) => <Typography.Text type="secondary" copyable>{value}</Typography.Text> },
        { title: "金额", dataIndex: "amount", width: 110, render: (value: number) => <Typography.Text strong>{formatPrice(value)}</Typography.Text> },
        { title: "支付方式", dataIndex: "paymentProvider", width: 110, render: (value: string) => providerLabel[value] || value || "-" },
        {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: MembershipOrderStatus) => {
                const item = statusLabel[value] || { color: "default", text: value };
                return <Tag color={item.color}>{item.text}</Tag>;
            },
        },
        { title: "支付凭证", dataIndex: "paymentId", width: 160, render: (value: string) => value || "-" },
        { title: "下单时间", dataIndex: "createdAt", width: 160, render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-") },
        { title: "支付时间", dataIndex: "paidAt", width: 160, render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-") },
        {
            title: "操作",
            key: "actions",
            width: 130,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    {item.status === "pending" ? (
                        <Tooltip title="标记为已支付">
                            <Popconfirm title="确认手动标记为已支付？将立即发放权益" onConfirm={() => void markPaid(item.id)}>
                                <Button type="text" size="small" icon={<CheckOutlined />} />
                            </Popconfirm>
                        </Tooltip>
                    ) : null}
                    <Tooltip title="删除">
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeleting(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="360px">
                                <Form.Item label="关键词">
                                    <Input.Search
                                        value={keywordText}
                                        placeholder="搜索订单号、用户 ID、套餐或支付凭证"
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => searchOrders(keywordText)}
                                        onChange={(event) => setKeywordText(event.target.value)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Form.Item>
                                    <Space>
                                        <Button
                                            onClick={() => {
                                                setKeywordText("");
                                                resetFilters();
                                            }}
                                        >
                                            重置
                                        </Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchOrders(keywordText)}>
                                            查询
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<MembershipOrder>
                    rowKey="id"
                    columns={columns}
                    dataSource={orders}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>会员订单</Typography.Text>
                            <Tag>{total} 单</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshOrders() }}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => `共 ${value} 单`,
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Flex>

            <Modal
                title="删除订单"
                open={Boolean(deleting)}
                onCancel={() => setDeleting(null)}
                onOk={async () => {
                    if (!deleting) return;
                    await deleteOrder(deleting.id);
                    setDeleting(null);
                }}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
            >
                确定删除该订单？删除后无法恢复，已发放的会员权益不会回收。
            </Modal>
        </main>
    );
}
