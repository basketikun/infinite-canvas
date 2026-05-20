"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";

import { type AdminUser, type AdminUserPayload, type AdminUserRole } from "@/services/api/users";

import { useAdminUsers } from "../hooks/use-admin-users";

type UserFormValues = {
  username: string;
  password?: string;
  role: AdminUserRole;
  credits: number;
};

const roleOptions: { label: string; value: AdminUserRole }[] = [
  { label: "普通用户", value: "user" },
  { label: "管理员", value: "admin" },
];

export default function AdminUsersPage() {
  const { users, keyword, page, pageSize, total, isLoading, searchUsers, changePage, changePageSize, resetFilters, refreshUsers, saveUser, deleteUser } = useAdminUsers();
  const { modal } = App.useApp();
  const [form] = Form.useForm<UserFormValues>();
  const [editingUser, setEditingUser] = useState<Partial<AdminUser> | null>(null);

  useEffect(() => {
    if (!editingUser) return;
    form.setFieldsValue({
      username: editingUser.username || "",
      password: "",
      role: (editingUser.role as AdminUserRole) || "user",
      credits: typeof editingUser.credits === "number" ? editingUser.credits : 4,
    });
  }, [editingUser, form]);

  const onSave = async () => {
    const values = await form.validateFields();
    const payload: AdminUserPayload = {
      id: editingUser?.id,
      username: values.username.trim(),
      role: values.role,
      credits: Math.max(0, Math.floor(values.credits || 0)),
    };
    if (values.password) {
      payload.password = values.password;
    }
    await saveUser(payload);
    setEditingUser(null);
  };

  const onDelete = (user: AdminUser) => {
    modal.confirm({
      title: "删除用户",
      content: `确定删除用户「${user.username}」吗？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => deleteUser(user.id),
    });
  };

  const columns: ProColumns<AdminUser>[] = [
    { title: "用户名", dataIndex: "username", width: 200, render: (_, item) => <Typography.Text strong>{item.username}</Typography.Text> },
    {
      title: "角色",
      dataIndex: "role",
      width: 120,
      render: (_, item) => (item.role === "admin" ? <Tag color="gold">管理员</Tag> : <Tag>普通用户</Tag>),
    },
    {
      title: "剩余额度",
      dataIndex: "credits",
      width: 140,
      render: (_, item) => (item.role === "admin" ? <Typography.Text type="secondary">无限制</Typography.Text> : <Typography.Text>{item.credits ?? 0}</Typography.Text>),
    },
    { title: "创建时间", dataIndex: "createdAt", width: 200, render: (_, item) => <Typography.Text type="secondary">{item.createdAt}</Typography.Text> },
    {
      title: "操作",
      key: "actions",
      width: 96,
      fixed: "right",
      render: (_, item) => (
        <Space size={4}>
          <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingUser(item)} /></Tooltip>
          <Tooltip title="删除"><Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => onDelete(item)} /></Tooltip>
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
                  <Input.Search value={keyword} placeholder="按用户名搜索" allowClear enterButton={<SearchOutlined />} onSearch={searchUsers} onChange={(event) => searchUsers(event.target.value)} />
                </Form.Item>
              </Col>
              <Col flex="none">
                <Form.Item>
                  <Space>
                    <Button onClick={resetFilters}>重置</Button>
                    <Button type="primary" icon={<ReloadOutlined />} onClick={() => void refreshUsers()}>查询</Button>
                  </Space>
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Card>
        <ProTable<AdminUser>
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={isLoading}
          search={false}
          defaultSize="middle"
          scroll={{ x: 880 }}
          cardProps={{ variant: "borderless" }}
          headerTitle={<Space><Typography.Text strong>用户列表</Typography.Text><Tag>{total} 个</Tag></Space>}
          options={{ density: true, setting: true, reload: () => void refreshUsers() }}
          toolBarRender={() => [
            <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingUser({ role: "user", credits: 4 })}>新增用户</Button>,
          ]}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (value) => `共 ${value} 个`, onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)) }}
        />
      </Flex>

      <Modal
        title={editingUser?.id ? "编辑用户" : "新增用户"}
        open={Boolean(editingUser)}
        onCancel={() => setEditingUser(null)}
        onOk={() => void onSave()}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label={editingUser?.id ? "重置密码（留空则保持不变）" : "密码"} rules={editingUser?.id ? [] : [{ required: true, message: "请输入密码" }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="credits" label="生图额度" extra="管理员不消耗额度，此项仅对普通用户生效">
            <InputNumber min={0} step={1} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
