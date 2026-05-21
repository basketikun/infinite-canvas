"use client";

import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, Button, Card, Col, Flex, Form, Input, Row, Select, Space, Tag, Typography } from "antd";

import { useAdminCreditLogs } from "../hooks/use-admin-credit-logs";
import { formatLocalDateTime } from "@/lib/format-datetime";
import type { AdminCreditLogItem } from "@/services/api/admin-activities";
import type { CreditLogType } from "@/services/api/user";

const typeOptions = [
  { label: "全部类型", value: "" },
  { label: "生图消耗", value: "consume" },
  { label: "管理员调整", value: "admin_adjust" },
  { label: "注册赠送", value: "signup_bonus" },
];

const typeLabel: Record<CreditLogType, { label: string; color: string }> = {
  consume: { label: "生图消耗", color: "red" },
  admin_adjust: { label: "管理员调整", color: "blue" },
  signup_bonus: { label: "注册赠送", color: "green" },
};

export default function AdminCreditLogsPage() {
  void App.useApp();
  const { items, total, isLoading, keyword, type, page, pageSize, searchKeyword, changeType, changePage, changePageSize, resetFilters, refresh } = useAdminCreditLogs();

  const columns: ProColumns<AdminCreditLogItem>[] = [
    { title: "时间", dataIndex: "createdAt", width: 180, render: (_, item) => <Typography.Text type="secondary">{formatLocalDateTime(item.createdAt)}</Typography.Text> },
    { title: "用户", dataIndex: "username", width: 140, render: (_, item) => <Typography.Text strong>{item.username || item.userId}</Typography.Text> },
    {
      title: "类型",
      dataIndex: "type",
      width: 132,
      render: (_, item) => {
        const cfg = typeLabel[item.type] || { label: item.type, color: "default" };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: "变动",
      dataIndex: "amount",
      width: 100,
      render: (_, item) => (
        <Typography.Text strong style={{ color: item.amount >= 0 ? "#16a34a" : "#dc2626" }}>
          {item.amount > 0 ? `+${item.amount}` : item.amount}
        </Typography.Text>
      ),
    },
    { title: "变动后余额", dataIndex: "balance", width: 110 },
    { title: "模型", dataIndex: "model", width: 160, render: (_, item) => item.model ? <Tag>{item.model}</Tag> : <Typography.Text type="secondary">-</Typography.Text> },
    { title: "操作员", dataIndex: "operatorUsername", width: 140, render: (_, item) => item.operatorUsername ? <Typography.Text>{item.operatorUsername}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text> },
    { title: "备注", dataIndex: "remark", render: (_, item) => <Typography.Text type="secondary">{item.remark || "-"}</Typography.Text> },
  ];

  return (
    <main style={{ padding: 24 }}>
      <Flex vertical gap={16}>
        <Card variant="borderless">
          <Form layout="vertical">
            <Row gutter={16} align="bottom">
              <Col flex="320px">
                <Form.Item label="关键词">
                  <Input.Search value={keyword} placeholder="按用户名 / 备注 / 模型" allowClear enterButton={<SearchOutlined />} onSearch={searchKeyword} onChange={(event) => searchKeyword(event.target.value)} />
                </Form.Item>
              </Col>
              <Col flex="180px">
                <Form.Item label="类型">
                  <Select value={type} onChange={changeType} options={typeOptions} />
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
        <ProTable<AdminCreditLogItem>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={isLoading}
          search={false}
          defaultSize="middle"
          scroll={{ x: 1200 }}
          cardProps={{ variant: "borderless" }}
          headerTitle={<Space><Typography.Text strong>积分流水</Typography.Text><Tag>{total} 条</Tag></Space>}
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
    </main>
  );
}
