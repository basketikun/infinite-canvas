"use client";

import { EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, Button, Card, Col, Flex, Form, Image, Input, Modal, Row, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";

import { useAdminGenerations } from "../hooks/use-admin-generations";
import { imageUrl } from "@/services/image-storage";
import { formatLocalDateTime } from "@/lib/format-datetime";
import type { AdminGenerationItem } from "@/services/api/admin-activities";

const statusOptions = [
  { label: "全部状态", value: "" },
  { label: "正在生成", value: "running" },
  { label: "全部成功", value: "success" },
  { label: "部分成功", value: "partial" },
  { label: "全部失败", value: "failed" },
];

const statusTagColor: Record<string, string> = {
  running: "gold",
  success: "green",
  partial: "blue",
  failed: "red",
};

const statusLabel: Record<string, string> = {
  running: "正在生成",
  success: "成功",
  partial: "部分成功",
  failed: "失败",
};

const modeLabel: Record<string, string> = {
  image: "文生图",
  edit: "图生图",
};

export default function AdminGenerationsPage() {
  void App.useApp();
  const { items, total, isLoading, keyword, status, page, pageSize, searchKeyword, changeStatus, changePage, changePageSize, resetFilters, refresh } = useAdminGenerations();
  const [detail, setDetail] = useState<AdminGenerationItem | null>(null);

  const columns: ProColumns<AdminGenerationItem>[] = [
    {
      title: "用户",
      dataIndex: "username",
      width: 140,
      render: (_, item) => <Typography.Text strong>{item.username || item.userId}</Typography.Text>,
    },
    {
      title: "提示词",
      dataIndex: "prompt",
      ellipsis: true,
      render: (_, item) => (
        <Tooltip title={item.prompt}>
          <Typography.Link onClick={() => setDetail(item)}>{item.prompt}</Typography.Link>
        </Tooltip>
      ),
    },
    {
      title: "模式",
      dataIndex: "mode",
      width: 90,
      render: (_, item) => <Tag>{modeLabel[item.mode] || item.mode}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (_, item) => <Tag color={statusTagColor[item.status]}>{statusLabel[item.status] || item.status}</Tag>,
    },
    {
      title: "成功 / 总数",
      width: 110,
      render: (_, item) => (
        <Typography.Text>
          <Typography.Text type={item.successCount === item.count ? "success" : item.successCount === 0 ? "danger" : "warning"}>{item.successCount}</Typography.Text>
          <Typography.Text type="secondary"> / {item.count}</Typography.Text>
        </Typography.Text>
      ),
    },
    { title: "尺寸", dataIndex: "size", width: 90 },
    { title: "质量", dataIndex: "quality", width: 90 },
    { title: "模型", dataIndex: "model", width: 140, render: (_, item) => item.model ? <Tag>{item.model}</Tag> : <Typography.Text type="secondary">-</Typography.Text> },
    { title: "耗时", dataIndex: "durationMs", width: 100, render: (_, item) => <Typography.Text type="secondary">{(item.durationMs / 1000).toFixed(1)}s</Typography.Text> },
    { title: "时间", dataIndex: "createdAt", width: 180, render: (_, item) => <Typography.Text type="secondary">{formatLocalDateTime(item.createdAt)}</Typography.Text> },
    {
      title: "操作",
      key: "actions",
      width: 80,
      fixed: "right",
      render: (_, item) => (
        <Tooltip title="详情"><Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetail(item)} /></Tooltip>
      ),
    },
  ];

  return (
    <main style={{ padding: 24 }}>
      <Flex vertical gap={16}>
        <Card variant="borderless">
          <Form layout="vertical">
            <Row gutter={16} align="bottom">
              <Col flex="320px">
                <Form.Item label="关键词">
                  <Input.Search value={keyword} placeholder="按用户名或提示词" allowClear enterButton={<SearchOutlined />} onSearch={searchKeyword} onChange={(event) => searchKeyword(event.target.value)} />
                </Form.Item>
              </Col>
              <Col flex="180px">
                <Form.Item label="状态">
                  <Select value={status} onChange={changeStatus} options={statusOptions} />
                </Form.Item>
              </Col>
              <Col flex="none">
                <Form.Item>
                  <Space>
                    <Button onClick={resetFilters}>重置</Button>
                    <Button type="primary" icon={<ReloadOutlined />} onClick={() => void refresh()}>查询</Button>
                  </Space>
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Card>
        <ProTable<AdminGenerationItem>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={isLoading}
          search={false}
          defaultSize="middle"
          scroll={{ x: 1400 }}
          cardProps={{ variant: "borderless" }}
          headerTitle={<Space><Typography.Text strong>生图记录</Typography.Text><Tag>{total} 条</Tag></Space>}
          options={{ density: true, setting: true, reload: () => void refresh() }}
          toolBarRender={false}
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

      <Modal
        title={detail ? `生图详情 · ${detail.username || detail.userId}` : "生图详情"}
        open={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        width={840}
        destroyOnHidden
      >
        {detail ? (
          <Flex vertical gap={16}>
            <Space wrap>
              <Tag color={statusTagColor[detail.status]}>{statusLabel[detail.status] || detail.status}</Tag>
              <Tag>{modeLabel[detail.mode] || detail.mode}</Tag>
              {detail.model ? <Tag>{detail.model}</Tag> : null}
              <Tag>尺寸 {detail.size || "auto"}</Tag>
              <Tag>质量 {detail.quality || "auto"}</Tag>
              <Tag>成功 {detail.successCount} / {detail.count}</Tag>
              <Tag>耗时 {(detail.durationMs / 1000).toFixed(1)}s</Tag>
              <Tag>{formatLocalDateTime(detail.createdAt)}</Tag>
            </Space>
            <div>
              <Typography.Text strong>提示词</Typography.Text>
              <Input.TextArea readOnly value={detail.prompt} autoSize={{ minRows: 2, maxRows: 8 }} style={{ marginTop: 8 }} />
            </div>
            {detail.references?.length ? (
              <div>
                <Typography.Text strong>参考图（{detail.references.length}）</Typography.Text>
                <Image.PreviewGroup>
                  <Flex wrap gap={8} style={{ marginTop: 8 }}>
                    {detail.references.map((key) => (
                      <Image key={key} src={imageUrl(key)} alt={key} width={96} height={96} style={{ objectFit: "cover", borderRadius: 6 }} fallback="/logo.svg" />
                    ))}
                  </Flex>
                </Image.PreviewGroup>
              </div>
            ) : null}
            {detail.thumbnails?.length ? (
              <div>
                <Typography.Text strong>生成结果（{detail.thumbnails.length}）</Typography.Text>
                <Image.PreviewGroup>
                  <Flex wrap gap={8} style={{ marginTop: 8 }}>
                    {detail.thumbnails.map((key) => (
                      <Image key={key} src={imageUrl(key)} alt={key} width={140} height={140} style={{ objectFit: "cover", borderRadius: 6 }} fallback="/logo.svg" />
                    ))}
                  </Flex>
                </Image.PreviewGroup>
              </div>
            ) : null}
            {detail.errors && detail.errors.length ? (
              <div>
                <Typography.Text strong type="danger">错误信息（{detail.errors.length}）</Typography.Text>
                <Flex vertical gap={6} style={{ marginTop: 8 }}>
                  {detail.errors.map((err, idx) => (
                    <Input.TextArea key={idx} readOnly value={err} autoSize={{ minRows: 1, maxRows: 4 }} />
                  ))}
                </Flex>
              </div>
            ) : null}
            {detail.requestParams && Object.keys(detail.requestParams).length ? (
              <div>
                <Typography.Text strong>请求参数</Typography.Text>
                <Input.TextArea
                  readOnly
                  value={JSON.stringify(detail.requestParams, null, 2)}
                  autoSize={{ minRows: 2, maxRows: 10 }}
                  style={{ marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                />
              </div>
            ) : null}
            {detail.upstreamMeta ? (
              <div>
                <Typography.Text strong>上游响应（去 b64_json）</Typography.Text>
                <Input.TextArea
                  readOnly
                  value={formatJsonText(detail.upstreamMeta)}
                  autoSize={{ minRows: 3, maxRows: 16 }}
                  style={{ marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                />
              </div>
            ) : null}
          </Flex>
        ) : null}
      </Modal>
    </main>
  );
}

// formatJsonText 尝试把 upstreamMeta 美化为缩进 JSON；解析失败就原样返回。
function formatJsonText(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
