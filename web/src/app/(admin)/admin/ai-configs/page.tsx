"use client";

import { CheckCircleOutlined, CloudDownloadOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, AutoComplete, Button, Card, Flex, Form, Input, Modal, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import { type AdminAIConfig, type AdminAIConfigPayload } from "@/services/api/ai-configs";

import { useAdminAIConfigs } from "../hooks/use-admin-ai-configs";

const DEFAULT_TEXT_MODEL = "gpt-5.4";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

type ConfigFormValues = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  imageModel: string;
  textModel: string;
};

export default function AdminAIConfigsPage() {
  const { configs, total, isLoading, isTesting, isProbing, refreshConfigs, saveConfig, deleteConfig, enableConfig, testConfig, probeModels } = useAdminAIConfigs();
  const { modal, message } = App.useApp();
  const [form] = Form.useForm<ConfigFormValues>();
  const [editing, setEditing] = useState<Partial<AdminAIConfig> | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!editing) {
      setModelOptions([]);
      return;
    }
    const isEdit = Boolean(editing.id);
    form.setFieldsValue({
      name: editing.name || "",
      baseUrl: editing.baseUrl || "",
      apiKey: "",
      imageModel: editing.imageModel || (isEdit ? "" : DEFAULT_IMAGE_MODEL),
      textModel: editing.textModel || (isEdit ? "" : DEFAULT_TEXT_MODEL),
    });
    setModelOptions([]);
  }, [editing, form]);

  const autoCompleteOptions = useMemo(() => modelOptions.map((value) => ({ value })), [modelOptions]);

  const onProbeModels = async () => {
    const baseUrl = (form.getFieldValue("baseUrl") as string | undefined)?.trim();
    const apiKey = (form.getFieldValue("apiKey") as string | undefined)?.trim();
    if (!baseUrl) {
      message.warning("请先填写 Base URL");
      return;
    }
    if (!editing?.id && !apiKey) {
      message.warning("请先填写 API Key");
      return;
    }
    try {
      const result = await probeModels({
        id: editing?.id,
        baseUrl,
        apiKey: apiKey || undefined,
      });
      setModelOptions(result.items);
    } catch {
      // hook 内已经弹错误提示
    }
  };

  const onSave = async () => {
    const values = await form.validateFields();
    const payload: AdminAIConfigPayload = {
      id: editing?.id,
      name: values.name.trim(),
      baseUrl: values.baseUrl.trim(),
      imageModel: values.imageModel.trim(),
      textModel: values.textModel.trim(),
    };
    if (values.apiKey?.trim()) {
      payload.apiKey = values.apiKey.trim();
    }
    await saveConfig(payload);
    setEditing(null);
  };

  const onToggleEnable = (record: AdminAIConfig, enabled: boolean) => {
    if (!enabled) {
      modal.info({ title: "不能直接关闭启用状态", content: "请启用其他配置以替换当前生效的配置。" });
      return;
    }
    void enableConfig(record.id);
  };

  const onTest = async (record: AdminAIConfig) => {
    setTestingId(record.id);
    try {
      await testConfig(record.id);
    } finally {
      setTestingId(null);
    }
  };

  const onDelete = (record: AdminAIConfig) => {
    modal.confirm({
      title: "删除配置",
      content: `确定删除配置「${record.name}」吗？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => deleteConfig(record.id),
    });
  };

  const columns: ProColumns<AdminAIConfig>[] = [
    {
      title: "启用",
      dataIndex: "enabled",
      width: 88,
      render: (_, item) => <Switch checked={item.enabled} onChange={(checked) => onToggleEnable(item, checked)} />,
    },
    {
      title: "名称",
      dataIndex: "name",
      width: 200,
      render: (_, item) => (
        <Space size={6}>
          <Typography.Text strong>{item.name}</Typography.Text>
          {item.enabled ? <Tag icon={<CheckCircleOutlined />} color="green">当前生效</Tag> : null}
        </Space>
      ),
    },
    { title: "Base URL", dataIndex: "baseUrl", width: 260, render: (_, item) => <Typography.Text type="secondary" copyable={{ text: item.baseUrl }}>{item.baseUrl}</Typography.Text> },
    { title: "API Key", dataIndex: "apiKey", width: 200, render: (_, item) => <Typography.Text type="secondary">{item.apiKey || "未设置"}</Typography.Text> },
    { title: "图像模型", dataIndex: "imageModel", width: 180 },
    { title: "文本模型", dataIndex: "textModel", width: 180 },
    {
      title: "操作",
      key: "actions",
      width: 120,
      fixed: "right",
      render: (_, item) => (
        <Space size={4}>
          <Tooltip title="测试连通"><Button type="text" size="small" icon={<ThunderboltOutlined />} loading={isTesting && testingId === item.id} onClick={() => void onTest(item)} /></Tooltip>
          <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditing(item)} /></Tooltip>
          <Tooltip title="删除"><Button danger type="text" size="small" icon={<DeleteOutlined />} disabled={item.enabled} onClick={() => onDelete(item)} /></Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <main style={{ padding: 24 }}>
      <Flex vertical gap={16}>
        <Card variant="borderless">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            所有用户在画布、图片工作流、画布助手中的 AI 请求都会使用当前启用的配置。同一时间只能启用一个配置，编辑时 API Key 留空表示保留原值。
          </Typography.Paragraph>
        </Card>
        <ProTable<AdminAIConfig>
          rowKey="id"
          columns={columns}
          dataSource={configs}
          loading={isLoading}
          search={false}
          defaultSize="middle"
          scroll={{ x: 1200 }}
          cardProps={{ variant: "borderless" }}
          headerTitle={<Space><Typography.Text strong>模型配置</Typography.Text><Tag>{total} 个</Tag></Space>}
          options={{ density: true, setting: true, reload: () => void refreshConfigs() }}
          toolBarRender={() => [
            <Button key="refresh" icon={<ReloadOutlined />} onClick={() => void refreshConfigs()}>刷新</Button>,
            <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>新增配置</Button>,
          ]}
          pagination={false}
        />
      </Flex>

      <Modal
        title={editing?.id ? "编辑配置" : "新增配置"}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void onSave()}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: "请输入配置名称" }]}>
            <Input placeholder="如 OpenAI 官方、国内中转" />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: "请输入 Base URL" }]}>
            <Input placeholder="如 https://api.openai.com" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label={editing?.id ? "API Key（留空保持不变）" : "API Key"}
            rules={editing?.id ? [] : [{ required: true, message: "请输入 API Key" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label=" " colon={false} style={{ marginBottom: 12 }}>
            <Space size={8} align="center">
              <Button icon={<CloudDownloadOutlined />} loading={isProbing} onClick={() => void onProbeModels()}>
                获取模型列表
              </Button>
              {modelOptions.length > 0 ? (
                <Typography.Text type="secondary">已获取 {modelOptions.length} 个模型</Typography.Text>
              ) : (
                <Typography.Text type="secondary">填写完 Base URL 和 API Key 后可一键拉取上游模型列表</Typography.Text>
              )}
            </Space>
          </Form.Item>
          <Form.Item name="imageModel" label="图像模型" rules={[{ required: true, message: "请选择或输入图像模型" }]}>
            <AutoComplete
              options={autoCompleteOptions}
              placeholder="如 gpt-image-2"
              filterOption={(input, option) => (option?.value as string)?.toLowerCase().includes(input.toLowerCase())}
              allowClear
            />
          </Form.Item>
          <Form.Item name="textModel" label="文本模型" rules={[{ required: true, message: "请选择或输入文本模型" }]}>
            <AutoComplete
              options={autoCompleteOptions}
              placeholder="如 gpt-5.4"
              filterOption={(input, option) => (option?.value as string)?.toLowerCase().includes(input.toLowerCase())}
              allowClear
            />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
