"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import type { MembershipPlan } from "@/services/api/membership";
import { useAdminPlans } from "./use-admin-plans";

type PlanFormValues = Omit<Partial<MembershipPlan>, "price" | "features"> & {
    priceYuan?: number;
    features?: string[];
};

const levelOptions = [
    { label: "VIP", value: "vip" },
    { label: "SVIP", value: "svip" },
];

function formatPrice(cents: number) {
    return `¥ ${(cents / 100).toFixed(2)}`;
}

function parseFeatures(features: string): string[] {
    if (!features) return [];
    try {
        const parsed = JSON.parse(features);
        if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
    } catch {
        return features.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

export default function AdminPlansPage() {
    const { plans, keyword, page, pageSize, total, isLoading, searchPlans, changePage, changePageSize, resetFilters, refreshPlans, savePlan, deletePlan } = useAdminPlans();
    const [form] = Form.useForm<PlanFormValues>();
    const [keywordText, setKeywordText] = useState(keyword);
    const [editing, setEditing] = useState<Partial<MembershipPlan> | null>(null);
    const [deleting, setDeleting] = useState<MembershipPlan | null>(null);

    useEffect(() => setKeywordText(keyword), [keyword]);

    useEffect(() => {
        if (editing) {
            form.setFieldsValue({
                level: "vip",
                enabled: true,
                unlimited: false,
                priorityQueue: false,
                durationDays: 30,
                creditsGranted: 0,
                sort: 0,
                ...editing,
                priceYuan: editing.price !== undefined ? Number((editing.price / 100).toFixed(2)) : 0,
                features: parseFeatures(editing.features || ""),
            });
        }
    }, [editing, form]);

    const saveValues = async () => {
        const value = await form.validateFields();
        const { priceYuan, features, ...rest } = value;
        const priceCents = Math.round((Number(priceYuan) || 0) * 100);
        const featuresJSON = JSON.stringify((features || []).map((item) => String(item).trim()).filter(Boolean));
        await savePlan({ ...editing, ...rest, price: priceCents, features: featuresJSON });
        setEditing(null);
    };

    const columns: ProColumns<MembershipPlan>[] = [
        {
            title: "名称",
            dataIndex: "name",
            width: 200,
            render: (_, item) => (
                <Flex vertical>
                    <Typography.Text strong>{item.name}</Typography.Text>
                    <Typography.Text type="secondary">{item.id}</Typography.Text>
                </Flex>
            ),
        },
        {
            title: "等级",
            dataIndex: "level",
            width: 90,
            render: (_, item) => <Tag color={item.level === "svip" ? "magenta" : "gold"}>{item.level === "svip" ? "SVIP" : "VIP"}</Tag>,
        },
        {
            title: "价格",
            dataIndex: "price",
            width: 110,
            render: (_, item) => <Typography.Text strong>{formatPrice(item.price)}</Typography.Text>,
        },
        { title: "时长", dataIndex: "durationDays", width: 90, render: (value: number) => `${value} 天` },
        { title: "赠送算力点", dataIndex: "creditsGranted", width: 110 },
        {
            title: "权益",
            key: "features",
            width: 160,
            render: (_, item) => (
                <Space size={4} wrap>
                    {item.unlimited ? <Tag color="green">不限算力</Tag> : null}
                    {item.priorityQueue ? <Tag color="blue">优先队列</Tag> : null}
                </Space>
            ),
        },
        {
            title: "状态",
            dataIndex: "enabled",
            width: 80,
            render: (_, item) => <Tag color={item.enabled ? "green" : "default"}>{item.enabled ? "上架" : "下架"}</Tag>,
        },
        { title: "排序", dataIndex: "sort", width: 70 },
        { title: "更新时间", dataIndex: "updatedAt", width: 160, render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-") },
        {
            title: "操作",
            key: "actions",
            width: 96,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditing(item)} />
                    </Tooltip>
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
                                        placeholder="搜索套餐名称、等级或描述"
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => searchPlans(keywordText)}
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
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchPlans(keywordText)}>
                                            查询
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<MembershipPlan>
                    rowKey="id"
                    columns={columns}
                    dataSource={plans}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>会员套餐</Typography.Text>
                            <Tag>{total} 个</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshPlans() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ level: "vip", enabled: true })}>
                            新增
                        </Button>,
                    ]}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => `共 ${value} 个`,
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Flex>

            <Modal title={editing?.id ? "编辑套餐" : "新增套餐"} open={Boolean(editing)} width={680} onCancel={() => setEditing(null)} onOk={() => void saveValues()} okText="保存" cancelText="取消" destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="name" label="套餐名称" rules={[{ required: true, message: "请输入套餐名称" }]}>
                                <Input placeholder="例如 月度 VIP" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="level" label="会员等级" rules={[{ required: true }]}>
                                <Select options={levelOptions} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="description" label="套餐描述">
                                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="售卖时展示的卖点文案" />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="priceYuan" label="价格（元）" rules={[{ required: true }]}>
                                <InputNumber min={0} step={0.01} precision={2} style={{ width: "100%" }} addonAfter="元" />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="durationDays" label="时长（天）" rules={[{ required: true }]}>
                                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="creditsGranted" label="赠送算力点">
                                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="unlimited" label="不限算力点" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="priorityQueue" label="优先队列" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="enabled" label="上架" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="sort" label="排序（升序）">
                                <InputNumber precision={0} style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="features" label="自定义权益" extra="回车添加一条，例如「专属客服」「高清导出」">
                                <Select mode="tags" tokenSeparators={[",", "\n"]} placeholder="输入后回车添加" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title="删除套餐"
                open={Boolean(deleting)}
                onCancel={() => setDeleting(null)}
                onOk={async () => {
                    if (!deleting) return;
                    await deletePlan(deleting.id);
                    setDeleting(null);
                }}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
            >
                确定删除「{deleting?.name}」吗？已下单的订单仍可继续使用。
            </Modal>
        </main>
    );
}
