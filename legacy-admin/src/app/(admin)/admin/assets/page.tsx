"use client";

import { CopyOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Image, Input, Modal, Row, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import type { AdminAsset } from "@/services/api/admin";
import { useAdminAssets } from "./use-admin-assets";

type AssetFormValues = Partial<AdminAsset> & { tagText?: string };

const typeOptions = [
    { label: "全部类型", value: "" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
];

const editTypeOptions = typeOptions.slice(1);

export default function AdminAssetsPage() {
    const { assets, tags, keyword, kind, tag, page, pageSize, total, isLoading, searchAssets, changeKind, changeTag, changePage, changePageSize, resetFilters, refreshAssets, saveAsset: saveAdminAsset, deleteAsset } = useAdminAssets();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const [keywordText, setKeywordText] = useState(keyword);
    const [editingAsset, setEditingAsset] = useState<Partial<AdminAsset> | null>(null);
    const [detailAsset, setDetailAsset] = useState<AdminAsset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<AdminAsset | null>(null);
    const formType = Form.useWatch("type", form) || editingAsset?.type || "text";
    const tagOptions = tags.map((item) => ({ label: item, value: item }));

    useEffect(() => {
        if (editingAsset) form.setFieldsValue({ ...editingAsset, tagText: editingAsset.tags?.join(", ") || "" });
    }, [editingAsset, form]);

    useEffect(() => setKeywordText(keyword), [keyword]);

    const saveAsset = async () => {
        const value = await form.validateFields();
        const nextType = value.type || "text";
        await saveAdminAsset({
            ...editingAsset,
            ...value,
            type: nextType,
            coverUrl: value.coverUrl || (nextType === "image" ? value.url : ""),
            tags: (value.tagText || "")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        });
        setEditingAsset(null);
    };

    const columns: ProColumns<AdminAsset>[] = [
        {
            title: "封面",
            dataIndex: "coverUrl",
            width: 88,
            render: (_, item) => <Image src={item.coverUrl || item.url || "/logo.svg"} alt={item.title} width={56} height={42} style={{ objectFit: "cover", borderRadius: 6 }} preview={{ mask: "放大" }} fallback="/logo.svg" />,
        },
        {
            title: "标题",
            dataIndex: "title",
            width: 260,
            render: (_, item) => (
                <Typography.Link strong ellipsis style={{ maxWidth: 260, display: "block" }} onClick={() => setDetailAsset(item)}>
                    {item.title}
                </Typography.Link>
            ),
        },
        {
            title: "类型",
            dataIndex: "type",
            width: 84,
            render: (_, item) => <Tag>{item.type === "image" ? "图片" : "文本"}</Tag>,
        },
        {
            title: "标签",
            dataIndex: "tags",
            width: 180,
            render: (_, item) => (
                <Space size={[4, 4]} wrap>
                    {(item.tags || []).slice(0, 3).map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                    ))}
                </Space>
            ),
        },
        {
            title: "分类",
            dataIndex: "category",
            width: 120,
            render: (_, item) => <Typography.Text type="secondary">{item.category || "未标注"}</Typography.Text>,
        },
        {
            title: "操作",
            key: "actions",
            width: 112,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title="详情">
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetailAsset(item)} />
                    </Tooltip>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingAsset(item)} />
                    </Tooltip>
                    <Tooltip title="删除">
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingAsset(item)} />
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
                                    <Input.Search value={keywordText} placeholder="搜索标题、内容或标签" allowClear enterButton={<SearchOutlined />} onSearch={() => searchAssets(keywordText)} onChange={(event) => setKeywordText(event.target.value)} />
                                </Form.Item>
                            </Col>
                            <Col flex="180px">
                                <Form.Item label="类型">
                                    <Select value={kind} onChange={changeKind} options={typeOptions} />
                                </Form.Item>
                            </Col>
                            <Col flex="220px">
                                <Form.Item label="标签">
                                    <Select mode="multiple" allowClear maxTagCount="responsive" value={tag} onChange={changeTag} options={tagOptions} placeholder="全部标签" />
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
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchAssets(keywordText)}>
                                            查询
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminAsset>
                    rowKey="id"
                    columns={columns}
                    dataSource={assets}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>素材列表</Typography.Text>
                            <Tag>{total} 条</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshAssets() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingAsset({ type: "text", tags: [] })}>
                            新增
                        </Button>,
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

            <Modal title={editingAsset?.id ? "编辑素材" : "新增素材"} open={Boolean(editingAsset)} width={760} onCancel={() => setEditingAsset(null)} onOk={() => void saveAsset()} okText="保存" cancelText="取消" destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="type" label="类型" rules={[{ required: true, message: "请选择类型" }]}>
                        <Select options={editTypeOptions} />
                    </Form.Item>
                    <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="coverUrl" label="封面 URL">
                        <Input />
                    </Form.Item>
                    <Form.Item name="tagText" label="标签，用逗号分隔">
                        <Input />
                    </Form.Item>
                    <Form.Item name="category" label="分类">
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label="描述">
                        <Input.TextArea rows={3} />
                    </Form.Item>
                    {formType === "image" ? (
                        <Form.Item name="url" label="图片 URL" rules={[{ required: true, message: "请输入图片 URL" }]}>
                            <Input />
                        </Form.Item>
                    ) : (
                        <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}>
                            <Input.TextArea rows={6} />
                        </Form.Item>
                    )}
                </Form>
            </Modal>

            <Modal title="素材详情" open={Boolean(detailAsset)} width={760} onCancel={() => setDetailAsset(null)} footer={<Button onClick={() => setDetailAsset(null)}>关闭</Button>}>
                {detailAsset ? (
                    <Flex vertical gap={14}>
                        <Flex gap={14} align="start">
                            <Image src={detailAsset.coverUrl || detailAsset.url || "/logo.svg"} alt={detailAsset.title} width={116} height={84} style={{ objectFit: "cover", borderRadius: 8 }} preview={{ mask: "放大" }} fallback="/logo.svg" />
                            <Flex vertical gap={8} style={{ minWidth: 0 }}>
                                <Typography.Title level={5} style={{ margin: 0 }}>
                                    {detailAsset.title}
                                </Typography.Title>
                                <Space wrap>
                                    <Tag>{detailAsset.type === "image" ? "图片" : "文本"}</Tag>
                                    {detailAsset.category ? <Tag>{detailAsset.category}</Tag> : null}
                                    {(detailAsset.tags || []).map((tag) => (
                                        <Tag key={tag}>{tag}</Tag>
                                    ))}
                                </Space>
                            </Flex>
                        </Flex>
                        {detailAsset.description ? (
                            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                                {detailAsset.description}
                            </Typography.Paragraph>
                        ) : null}
                        <Input.TextArea value={detailAsset.type === "image" ? detailAsset.url || detailAsset.coverUrl : detailAsset.content} rows={7} readOnly />
                        <Button icon={<CopyOutlined />} onClick={() => copyText(detailAsset.type === "image" ? detailAsset.url || detailAsset.coverUrl : detailAsset.content)}>
                            复制内容
                        </Button>
                    </Flex>
                ) : null}
            </Modal>

            <Modal
                title="删除素材"
                open={Boolean(deletingAsset)}
                onCancel={() => setDeletingAsset(null)}
                onOk={async () => {
                    if (!deletingAsset) return;
                    await deleteAsset(deletingAsset.id);
                    setDeletingAsset(null);
                }}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
            >
                确定删除「{deletingAsset?.title}」吗？删除后会从服务器素材库中移除。
            </Modal>
        </main>
    );
}
