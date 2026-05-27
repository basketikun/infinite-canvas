"use client";

import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, DatePicker, Flex, Form, Input, InputNumber, Modal, Row, Space, Switch, Tag, Tooltip, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";

import type { Announcement } from "@/services/api/admin";
import { useAdminAnnouncements } from "./use-admin-announcements";

type AnnouncementFormValues = Partial<Announcement> & { dateRange?: [Dayjs, Dayjs] };

export default function AdminAnnouncementsPage() {
    const { announcements, keyword, page, pageSize, total, isLoading, searchAnnouncements, changePage, changePageSize, resetFilters, refreshAnnouncements, saveAnnouncement: saveAdminAnnouncement, deleteAnnouncement } = useAdminAnnouncements();
    const [form] = Form.useForm<AnnouncementFormValues>();
    const [keywordText, setKeywordText] = useState(keyword);
    const [editingAnnouncement, setEditingAnnouncement] = useState<Partial<Announcement> | null>(null);
    const [detailAnnouncement, setDetailAnnouncement] = useState<Announcement | null>(null);
    const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);

    useEffect(() => setKeywordText(keyword), [keyword]);
    useEffect(() => {
        if (!editingAnnouncement) return;
        form.setFieldsValue({
            ...editingAnnouncement,
            dateRange: editingAnnouncement.dateFrom && editingAnnouncement.dateTo ? [dayjs(editingAnnouncement.dateFrom), dayjs(editingAnnouncement.dateTo)] : undefined,
            enabled: editingAnnouncement.enabled ?? true,
            sortOrder: editingAnnouncement.sortOrder ?? 100,
        });
    }, [editingAnnouncement, form]);

    const saveAnnouncement = async () => {
        const value = await form.validateFields();
        await saveAdminAnnouncement({
            ...editingAnnouncement,
            ...value,
            dateFrom: value.dateRange?.[0]?.format("YYYY-MM-DD") || "",
            dateTo: value.dateRange?.[1]?.format("YYYY-MM-DD") || "",
            enabled: value.enabled ?? true,
            sortOrder: value.sortOrder ?? 100,
        });
        setEditingAnnouncement(null);
    };

    const columns: ProColumns<Announcement>[] = [
        {
            title: "标题",
            dataIndex: "title",
            width: 260,
            render: (_, item) => (
                <Typography.Link strong ellipsis style={{ maxWidth: 260, display: "block" }} onClick={() => setDetailAnnouncement(item)}>
                    {item.title}
                </Typography.Link>
            ),
        },
        {
            title: "展示期限",
            key: "dateRange",
            width: 220,
            render: (_, item) => <Typography.Text type="secondary">{item.dateFrom || "不限"} ~ {item.dateTo || "不限"}</Typography.Text>,
        },
        {
            title: "顺序",
            dataIndex: "sortOrder",
            width: 82,
            render: (_, item) => <Tag>{item.sortOrder}</Tag>,
        },
        {
            title: "状态",
            dataIndex: "enabled",
            width: 88,
            render: (_, item) => <Tag color={item.enabled ? "green" : "default"}>{item.enabled ? "启用" : "停用"}</Tag>,
        },
        {
            title: "更新时间",
            dataIndex: "updatedAt",
            width: 180,
            render: (_, item) => <Typography.Text type="secondary">{formatDateTime(item.updatedAt)}</Typography.Text>,
        },
        {
            title: "操作",
            key: "actions",
            width: 112,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title="预览">
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetailAnnouncement(item)} />
                    </Tooltip>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingAnnouncement(item)} />
                    </Tooltip>
                    <Tooltip title="删除">
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingAnnouncement(item)} />
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
                                    <Input.Search value={keywordText} placeholder="搜索标题或内容" allowClear enterButton={<SearchOutlined />} onSearch={() => searchAnnouncements(keywordText)} onChange={(event) => setKeywordText(event.target.value)} />
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Form.Item>
                                    <Space>
                                        <Button onClick={() => { setKeywordText(""); resetFilters(); }}>重置</Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchAnnouncements(keywordText)}>查询</Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<Announcement>
                    rowKey="id"
                    columns={columns}
                    dataSource={announcements}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={<Space><Typography.Text strong>公告列表</Typography.Text><Tag>{total} 条</Tag></Space>}
                    options={{ density: true, setting: true, reload: () => void refreshAnnouncements() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingAnnouncement({ enabled: true, sortOrder: 100 })}>发布公告</Button>,
                    ]}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => `共 ${value} 条`,
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Flex>

            <Modal title={editingAnnouncement?.id ? "编辑公告" : "发布公告"} open={Boolean(editingAnnouncement)} width={820} onCancel={() => setEditingAnnouncement(null)} onOk={() => void saveAnnouncement()} okText="保存" cancelText="取消" destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="title" label="公告标题" rules={[{ required: true, message: "请输入公告标题" }]}><Input /></Form.Item>
                    <Row gutter={16}>
                        <Col span={12}><Form.Item name="dateRange" label="公告期限"><DatePicker.RangePicker className="w-full" /></Form.Item></Col>
                        <Col span={6}><Form.Item name="sortOrder" label="展示顺序"><InputNumber className="w-full" min={0} step={1} /></Form.Item></Col>
                        <Col span={6}><Form.Item name="enabled" label="是否启用" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></Col>
                    </Row>
                    <Form.Item name="content" label="公告内容" extra="支持 Markdown、HTML 或纯文本。" rules={[{ required: true, message: "请输入公告内容" }]}>
                        <Input.TextArea rows={12} placeholder="例如：# 更新公告\n\n支持 **Markdown**，也可以直接粘贴 HTML。" />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal title={detailAnnouncement?.title} open={Boolean(detailAnnouncement)} width={820} onCancel={() => setDetailAnnouncement(null)} footer={<Button onClick={() => setDetailAnnouncement(null)}>关闭</Button>}>
                {detailAnnouncement ? <Input.TextArea value={detailAnnouncement.content} rows={12} readOnly /> : null}
            </Modal>

            <Modal title="删除公告" open={Boolean(deletingAnnouncement)} onCancel={() => setDeletingAnnouncement(null)} onOk={async () => { if (!deletingAnnouncement) return; await deleteAnnouncement(deletingAnnouncement.id); setDeletingAnnouncement(null); }} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除公告「{deletingAnnouncement?.title}」吗？
            </Modal>
        </main>
    );
}

function formatDateTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}
