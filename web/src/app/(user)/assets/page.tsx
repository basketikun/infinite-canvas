"use client";

import { Copy, Download, PencilLine, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Card, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import copy from "copy-to-clipboard";

import { RequireAuth } from "@/components/require-auth";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { useImageUploader } from "@/lib/use-image-uploader";
import { cn } from "@/lib/utils";
import { useMyAssets } from "./hooks/use-my-assets";
import type { MyAsset, MyAssetType } from "@/services/api/my-assets";

type AssetFormValues = {
  type: MyAssetType;
  title: string;
  coverUrl: string;
  tags: string[];
  category?: string;
  description?: string;
  content?: string;
  url?: string;
};

const kindOptions = [
  { label: "全部", value: "" },
  { label: "文本", value: "text" },
  { label: "图片", value: "image" },
];

export default function AssetsPage() {
  return (
    <RequireAuth>
      <MyAssetsPage />
    </RequireAuth>
  );
}

function MyAssetsPage() {
  const { message } = App.useApp();
  const uploadWithToast = useImageUploader();
  const [form] = Form.useForm<AssetFormValues>();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const {
    assets,
    total,
    keyword,
    type,
    page,
    pageSize,
    searchAssets,
    changeType,
    changePage,
    changePageSize,
    saveAsset,
    deleteAsset,
  } = useMyAssets();

  const [keywordDraft, setKeywordDraft] = useState(keyword);
  const [editingAsset, setEditingAsset] = useState<MyAsset | null>(null);
  const [isAssetOpen, setIsAssetOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MyAsset | null>(null);
  const [deletingAsset, setDeletingAsset] = useState<MyAsset | null>(null);
  const [formKind, setFormKind] = useState<MyAssetType>("text");
  const coverUrl = Form.useWatch("coverUrl", form) || "";
  const title = Form.useWatch("title", form) || "";
  const tags = Form.useWatch("tags", form) || [];
  const content = Form.useWatch("content", form) || "";

  useEffect(() => {
    setKeywordDraft(keyword);
  }, [keyword]);

  const openCreate = () => {
    setEditingAsset(null);
    setFormKind("text");
    form.setFieldsValue({ type: "text", title: "", coverUrl: "", tags: [], category: "手动添加", description: "", content: "", url: "" });
    setIsAssetOpen(true);
  };

  const openEdit = (asset: MyAsset) => {
    setEditingAsset(asset);
    setFormKind(asset.type === "video" ? "image" : asset.type);
    form.setFieldsValue({
      type: asset.type === "video" ? "image" : asset.type,
      title: asset.title,
      coverUrl: asset.coverUrl,
      tags: asset.tags || [],
      category: asset.category,
      description: asset.description,
      content: asset.type === "text" ? asset.content : "",
      url: asset.type === "image" ? asset.url : "",
    });
    setIsAssetOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload: Partial<MyAsset> = {
      ...(editingAsset?.id ? { id: editingAsset.id } : {}),
      title: values.title.trim(),
      type: values.type,
      coverUrl: values.coverUrl?.trim() || "",
      tags: values.tags || [],
      category: values.category?.trim() || "",
      description: values.description?.trim() || "",
      content: values.type === "text" ? (values.content || "").trim() : "",
      url: values.type === "image" ? (values.url || values.coverUrl || "").trim() : "",
    };

    if (payload.type === "image" && !payload.url && !payload.coverUrl) {
      message.error("请选择图片文件或填写图片 URL");
      return;
    }

    try {
      await saveAsset(payload);
      setIsAssetOpen(false);
    } catch {
      // hook handles error message
    }
  };

  const readCoverFile = async (file?: File) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    form.setFieldValue("coverUrl", dataUrl);
  };

  const readImageFile = async (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const image = await uploadWithToast(file, { label: "素材图片" });
    form.setFieldValue("url", image.url);
    if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", image.url);
    if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
  };

  const copyText = async (asset: MyAsset) => {
    if (asset.type !== "text") return;
    copy(asset.content);
    message.success("文本已复制");
  };

  const downloadImage = (asset: MyAsset) => {
    if (asset.type !== "image") return;
    const link = document.createElement("a");
    link.href = asset.url || asset.coverUrl;
    link.download = `${asset.title || "asset"}.png`;
    link.click();
  };

  const confirmDelete = async () => {
    if (!deletingAsset) return;
    try {
      await deleteAsset(deletingAsset.id);
    } finally {
      setDeletingAsset(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
      <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
        <div className="pb-8">
          <div className="mx-auto max-w-5xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">我的素材</h1>
            <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">收藏常用文本和图片，按类型、标题和标签快速查找。</p>
          </div>

          <div className="mx-auto mt-8 w-full max-w-2xl">
            <Input.Search
              className="w-full"
              size="large"
              allowClear
              prefix={<Search className="size-4 text-stone-400" />}
              value={keywordDraft}
              placeholder="搜索标题、内容、标签或来源"
              onChange={(event) => setKeywordDraft(event.target.value)}
              onSearch={(value) => searchAssets(value)}
            />
          </div>

          <div className="mx-auto mt-6 grid max-w-6xl gap-3 text-left">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center">
                <div className="text-xs font-medium text-stone-500 dark:text-stone-400">类型</div>
                <div className="flex flex-wrap gap-2">
                  {kindOptions.map((option) => (
                    <Tag.CheckableTag key={option.value || "all"} checked={type === option.value} className={cn("prompt-filter-tag", type === option.value && "is-active")} onChange={() => changeType(option.value)}>
                      {option.label}
                    </Tag.CheckableTag>
                  ))}
                </div>
              </div>
              <button type="button" className="cursor-pointer self-start text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline sm:self-center dark:text-stone-300" onClick={openCreate}>
                新增素材
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onOpen={() => setPreviewAsset(asset)}
                onEdit={() => openEdit(asset)}
                onCopy={copyText}
                onDownload={downloadImage}
                onDelete={() => setDeletingAsset(asset)}
              />
            ))}
          </div>

          {!assets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到素材" className="py-20" /> : null}

          <div className="flex justify-center">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={[10, 20, 50, 100]}
              onChange={(nextPage, nextPageSize) => {
                if (nextPageSize !== pageSize) changePageSize(nextPageSize);
                else changePage(nextPage);
              }}
            />
          </div>
        </div>
      </main>

      <Modal title={editingAsset ? "编辑素材" : "新增素材"} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void handleSave()} okText="保存" cancelText="取消" destroyOnHidden>
        <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Form form={form} layout="vertical" requiredMark={false} initialValues={{ type: "text", tags: [] }}>
            <Form.Item name="type" label="类型">
              <Select options={[{ label: "文本", value: "text" }, { label: "图片", value: "image" }]} onChange={(value) => setFormKind(value)} />
            </Form.Item>
            <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
              <Input size="large" placeholder="给素材起一个容易检索的名字" />
            </Form.Item>
            <Form.Item name="coverUrl" label="封面 URL">
              <Space.Compact className="w-full">
                <Input placeholder="可粘贴图片 URL，也可以上传本地封面" />
                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>上传</Button>
              </Space.Compact>
            </Form.Item>
            <Form.Item name="tags" label="标签">
              <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入标签后回车" />
            </Form.Item>
            <div className="grid gap-4 sm:grid-cols-2">
              <Form.Item name="category" label="来源">
                <Input placeholder="手动添加 / 画布 / 提示词库" />
              </Form.Item>
              <Form.Item name="description" label="备注">
                <Input placeholder="可选" />
              </Form.Item>
            </div>
            {formKind === "text" ? (
              <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}>
                <Input.TextArea rows={8} placeholder="保存提示词、说明文案、参考描述等文本素材" />
              </Form.Item>
            ) : (
              <Form.Item name="url" label="图片内容" required>
                <Space.Compact className="w-full">
                  <Input placeholder="可粘贴图片 URL 或上传本地图片" />
                  <Button icon={<Upload className="size-3.5" />} onClick={() => imageInputRef.current?.click()}>上传</Button>
                </Space.Compact>
              </Form.Item>
            )}
          </Form>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
            <Typography.Text strong>预览</Typography.Text>
            <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
              {coverUrl ? <img src={coverUrl} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || "暂无封面"}</div>}
              <div className="p-4">
                <Typography.Text strong ellipsis className="block">{title || "未命名素材"}</Typography.Text>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.length ? tags.map((tag) => <Tag key={tag} className="m-0">{tag}</Tag>) : <Tag className="m-0">未打标签</Tag>}
                </div>
              </div>
            </div>
          </div>
        </div>
        <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
          void readCoverFile(event.target.files?.[0]);
          event.target.value = "";
        }} />
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
          void readImageFile(event.target.files?.[0]);
          event.target.value = "";
        }} />
      </Modal>

      <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyText} onDownload={downloadImage} />

      <Modal title="删除素材" open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={() => void confirmDelete()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
        确定删除「{deletingAsset?.title}」吗？删除后会从我的素材中移除。
      </Modal>
    </div>
  );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: MyAsset; onOpen: () => void; onEdit: () => void; onCopy: (asset: MyAsset) => void; onDownload: (asset: MyAsset) => void; onDelete: () => void }) {
  const cover = asset.coverUrl || (asset.type === "image" ? asset.url : "");
  const summary = assetSummary(asset);
  return (
    <Card
      hoverable
      className="overflow-hidden"
      styles={{ body: { padding: 0 } }}
      cover={
        <button type="button" className="block w-full text-left" onClick={onOpen}>
          {cover ? <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{asset.type === "text" ? asset.content : "暂无封面"}</div>}
        </button>
      }
    >
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
              <Typography.Text type="secondary" className="mt-1 block text-xs">{asset.category || "未标注来源"}</Typography.Text>
            </div>
            <Tag className="m-0 shrink-0 text-[11px]">{asset.type === "image" ? "图片" : "文本"}</Tag>
          </div>
          <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
            {summary}
          </Typography.Paragraph>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(asset.tags || []).slice(0, 3).map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>)}
            {!asset.tags?.length ? <Tag className="m-0 text-[11px]">无标签</Tag> : null}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2 px-4 pb-4">
        <Button size="small" onClick={onOpen}>查看</Button>
        <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>编辑</Button>
        {asset.type === "text" ? <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>复制</Button> : null}
        {asset.type === "image" ? <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>下载</Button> : null}
        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>删除</Button>
      </div>
    </Card>
  );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: MyAsset | null; onClose: () => void; onCopy: (asset: MyAsset) => void; onDownload: (asset: MyAsset) => void }) {
  const cover = asset ? asset.coverUrl || (asset.type === "image" ? asset.url : "") : "";
  return (
    <Drawer title="素材详情" open={Boolean(asset)} size="large" onClose={onClose}>
      {asset ? (
        <div className="space-y-5">
          {cover ? <Image src={cover} alt={asset.title} className="rounded-lg" /> : <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.type === "text" ? asset.content : "暂无封面"}</div>}
          <div>
            <Typography.Title level={4} className="!mb-2">{asset.title}</Typography.Title>
            <Space size={[4, 4]} wrap>
              <Tag>{asset.type === "image" ? "图片" : "文本"}</Tag>
              {(asset.tags || []).map((tag) => <Tag key={tag}>{tag}</Tag>)}
            </Space>
          </div>
          <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <Typography.Text type="secondary" className="block text-xs">内容</Typography.Text>
            {asset.type === "text" ? <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.content}</Typography.Paragraph> : <Typography.Text className="mt-2 block">{asset.url}</Typography.Text>}
          </div>
          {asset.description ? <div><Typography.Text type="secondary">备注</Typography.Text><Typography.Paragraph className="mt-1">{asset.description}</Typography.Paragraph></div> : null}
          <Space>
            {asset.type === "text" ? <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>复制文本</Button> : null}
            {asset.type === "image" ? <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>下载图片</Button> : null}
          </Space>
        </div>
      ) : null}
    </Drawer>
  );
}

function assetSummary(asset: MyAsset) {
  if (asset.type === "text") return asset.content;
  return asset.url || asset.coverUrl;
}
