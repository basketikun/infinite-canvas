import { Copy, Download, PencilLine, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset, type VideoAsset, type AudioAsset, type CompositeItem } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;
type VideoDraft = VideoAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video", "audio", "composite"] as const;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [videoDraft, setVideoDraft] = useState<VideoDraft>(null);
    const [audioDraft, setAudioDraft] = useState<AudioAsset["data"] | null>(null);
    const [compositeItems, setCompositeItems] = useState<CompositeItem[]>([]);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "composite"), [assets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
            setEditingAsset(null);
            setImageDraft(null);
            setVideoDraft(null);
            setAudioDraft(null);
            setCompositeItems([]);
            setFormKind("text");
            form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data as ImageAsset["data"] : null);
        setAudioDraft(asset.kind === "audio" ? asset.data as AudioAsset["data"] : null);
        setCompositeItems(asset.kind === "composite" ? asset.data.items : []);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else if (values.kind === "audio") {
            if (!audioDraft) { message.error(t("assets.selectAudio")); return; }
            const asset = { ...base, kind: "audio" as const, data: audioDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else if (values.kind === "composite") {
            if (!compositeItems.length) { message.error(t("assets.compositeRequireOne")); return; }
            const asset = { ...base, kind: "composite" as const, data: { items: compositeItems } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) { message.error(t("assets.selectImage")); return; }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const readAudioFile = async (file?: File) => {
        if (!file || !file.type.startsWith("audio/")) return;
        const result = await uploadMediaFile(file, "audio");
        setAudioDraft({ url: result.url, storageKey: result.storageKey, bytes: result.bytes, mimeType: result.mimeType, durationMs: result.durationMs });
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = (asset: Asset) => {
        if (asset.kind === "image") { saveAs(asset.data.dataUrl, `${asset.title || "asset"}.${asset.data.mimeType.split("/")[1] || "png"}`); return; }
        if (asset.kind === "video") { saveAs(asset.data.url, `${asset.title || "asset"}.${asset.data.mimeType.split("/")[1] || "mp4"}`); return; }
        if (asset.kind === "audio") { saveAs(asset.data.url, `${asset.title || "audio"}.${asset.data.mimeType.split("/")[1] || "mp3"}`); return; }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        await exportAssets(validAssets, t("assets.packageName"));
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(t("assets.imported", { count: importedAssets.length }));
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success(t("assets.deleted"));
        setDeletingAsset(null);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t("assets.title")}</h1>
                        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">{t("assets.description")}</p>
                    </div>

                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <Input.Search
                            className="w-full"
                            size="large"
                            allowClear
                            prefix={<Search className="size-4 text-stone-400" />}
                            value={keyword}
                            placeholder={t("assets.search")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                            onSearch={(value) => {
                                setPage(1);
                                setKeyword(value);
                            }}
                        />
                    </div>

                    <div className="mx-auto mt-6 grid max-w-6xl gap-3 text-left">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center">
                                <div className="text-xs font-medium text-stone-500 dark:text-stone-400">{t("assets.type")}</div>
                                <div className="flex flex-wrap gap-2">
                                    {kindOptions.map((option) => (
                                        <Tag.CheckableTag
                                            key={option}
                                            checked={kindFilter === option}
                                            className={cn("prompt-filter-tag", kindFilter === option && "is-active")}
                                            onChange={() => {
                                                setPage(1);
                                                setKindFilter(option);
                                            }}
                                        >
                                            {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                                        </Tag.CheckableTag>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    onClick={() => void exportAllAssets()}
                                >
                                    {t("assets.export")}
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    onClick={() => assetInputRef.current?.click()}
                                >
                                    {t("assets.import")}
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    onClick={openCreate}
                                >
                                    {t("assets.add")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset) => (
                            <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />
                        ))}
                    </div>

                    {!visibleAssets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}

                    <div className="flex justify-center">
                        <Pagination
                            current={page}
                            pageSize={pageSize}
                            total={filteredAssets.length}
                            showSizeChanger
                            pageSizeOptions={[10, 20, 50, 100]}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    </div>
                </div>
            </main>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                    { label: t("assets.kinds.video"), value: "video" },
                                    { label: t("assets.kinds.audio"), value: "audio" },
                                    { label: t("assets.kinds.composite"), value: "composite" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, message: t("assets.fields.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : formKind === "audio" ? (
                            <Form.Item label={t("assets.fields.audioContent")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => audioInputRef.current?.click()}>
                                        {t("assets.selectAudioFile")}
                                    </Button>
                                    {audioDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {formatBytes(audioDraft.bytes)} {audioDraft.durationMs ? ` · ${Math.round(audioDraft.durationMs / 1000)}s` : ""}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noAudioSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        ) : formKind === "composite" ? (
                            <Form.Item label={t("assets.fields.compositeContent")} required>
                                <CompositeEditor items={compositeItems} onChange={setCompositeItems} assets={assets} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noImageSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(event) => { void readAudioFile(event.target.files?.[0]); event.target.value = ""; }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>
        </div>
    );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const summary = assetSummary(asset);
    return (
        <Card
            hoverable
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                {asset.source || t("assets.unknownSource")}
                            </Typography.Text>
                        </div>
                        <Tag className="m-0 shrink-0 text-[11px]">{t(`assets.kinds.${asset.kind}`)}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {summary}
                    </Typography.Paragraph>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {(asset.tags || []).slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags?.length ? <Tag className="m-0 text-[11px]">{t("assets.noTags")}</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>
                    {t("common.view")}
                </Button>
                <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                    {t("common.edit")}
                </Button>
                {asset.kind === "text" ? (
                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("common.copy")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" ? (
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>
                        {t("common.download")}
                    </Button>
                ) : null}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("common.delete")}
                </Button>
            </div>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={cover} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("assets.fields.textContent")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : asset.kind === "audio" ? (
                            <Typography.Text type="secondary" className="mt-2 block">
                                {formatBytes(asset.data.bytes)}{asset.data.durationMs ? ` · ${Math.round(asset.data.durationMs / 1000)}s` : ""}
                            </Typography.Text>
                        ) : asset.kind === "composite" ? (
                            <Typography.Text type="secondary" className="mt-2 block">
                                {asset.data.items.length} items
                            </Typography.Text>
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">{t("assets.fields.note")}</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.downloadVideo") : asset.kind === "audio" ? t("assets.downloadAudio") : t("assets.downloadImage")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    if (asset.kind === "audio") return `${formatBytes(asset.data.bytes)}${asset.data.durationMs ? ` · ${Math.round(asset.data.durationMs / 1000)}s` : ""}`;
    if (asset.kind === "composite") return `${asset.data.items.length} items`;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    const extra = asset.kind === "text" ? asset.data.content : asset.kind === "composite" ? `${asset.data.items.length} items` : asset.data.mimeType;
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), extra].join(" ").toLowerCase();
}

function CompositeEditor({ items, onChange, assets }: { items: CompositeItem[]; onChange: (items: CompositeItem[]) => void; assets: Asset[] }) {
    const { t } = useTranslation();
    const imgInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const [mediaKind, setMediaKind] = useState<"video" | "audio">("video");
    const [pendingIdx, setPendingIdx] = useState<number | null>(null);
    // Resolved blob: URLs for preview, keyed by item index
    const [previews, setPreviews] = useState<Record<number, string>>({});

    // Cache of resolved blob: URLs keyed by storageKey — cleaned up on unmount
    const urlCache = useRef<Record<string, string>>({});
    const resolveUrl = useCallback(async (item: CompositeItem) => {
        if (item.itemType === "image" && item.storageKey) {
            if (!urlCache.current[item.storageKey]) urlCache.current[item.storageKey] = await resolveImageUrl(item.storageKey, item.url);
            return urlCache.current[item.storageKey];
        }
        if ((item.itemType === "video" || item.itemType === "audio") && item.storageKey) {
            if (!urlCache.current[item.storageKey]) urlCache.current[item.storageKey] = await resolveMediaUrl(item.storageKey, item.url);
            return urlCache.current[item.storageKey];
        }
        const imgItem = item as Extract<CompositeItem, { itemType: "image" }>;
        return imgItem.url ?? "";
    }, []);

    // Resolve previews when items change
    useEffect(() => {
        let cancelled = false;
        items.forEach(async (item, idx) => {
            const mediaItem = item as Extract<CompositeItem, { itemType: "image" | "video" | "audio" }>;
            if (mediaItem.storageKey) {
                const url = await resolveUrl(mediaItem);
                if (!cancelled) setPreviews(prev => ({ ...prev, [idx]: url }));
            }
        });
        return () => { cancelled = true; };
    }, [items, resolveUrl]);

    // Revoke blob: URLs on unmount
    useEffect(() => {
        return () => { Object.values(urlCache.current).forEach(url => URL.revokeObjectURL(url)); };
    }, []);

    const handleImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file || pendingIdx === null) return;
        const result = await uploadImage(file);
        updateItem(pendingIdx, { url: result.url, storageKey: result.storageKey, width: result.width, height: result.height, bytes: result.bytes, mimeType: result.mimeType });
        setPendingIdx(null); e.target.value = "";
    };
    const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file || pendingIdx === null) return;
        const result = await uploadMediaFile(file, mediaKind);
        updateItem(pendingIdx, { url: result.url, storageKey: result.storageKey, bytes: result.bytes, mimeType: result.mimeType, durationMs: result.durationMs });
        setPendingIdx(null); e.target.value = "";
    };
    const openImgUpload = (idx: number) => { setPendingIdx(idx); imgInputRef.current?.click(); };
    const openMediaUpload = (idx: number, kind: "video" | "audio") => { setMediaKind(kind); setPendingIdx(idx); mediaInputRef.current?.click(); };
    const addItem = (itemType: CompositeItem["itemType"]) => {
        const base: CompositeItem =
            itemType === "text" ? { itemType: "text", content: "" }
            : itemType === "image" ? { itemType: "image", url: "", width: 0, height: 0, bytes: 0, mimeType: "" }
            : itemType === "video" ? { itemType: "video", url: "", width: 0, height: 0, bytes: 0, mimeType: "" }
            : itemType === "audio" ? { itemType: "audio", url: "", bytes: 0, mimeType: "" }
            : { itemType: "assetRef", refId: "", refKind: "text" };
        onChange([...items, base]);
    };
    const updateItem = (index: number, patch: Partial<CompositeItem>) => {
        const next = [...items];
        next[index] = { ...next[index], ...patch } as CompositeItem;
        onChange(next);
    };
    const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index));
    const refOptions = assets.filter(a => a.kind !== "composite").map(a => ({ label: `${a.kind}: ${a.title || a.id}`, value: a.id, kind: a.kind }));
    return (
        <div className="space-y-3">
            {items.map((item, idx) => (
                <div key={idx} className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
                    <div className="mb-2 flex items-center gap-2">
                        <Select size="small" value={item.itemType}
                            options={[
                                { label: t("assets.composite.itemType.text"), value: "text" },
                                { label: t("assets.composite.itemType.image"), value: "image" },
                                { label: t("assets.composite.itemType.video"), value: "video" },
                                { label: t("assets.composite.itemType.audio"), value: "audio" },
                                { label: t("assets.composite.itemType.assetRef"), value: "assetRef" },
                            ]}
                            onChange={(val) => {
                                const next = [...items];
                                next[idx] = item.itemType === val ? item : (
                                    val === "text" ? { itemType: "text", content: "" }
                                    : val === "image" ? { itemType: "image", url: "", width: 0, height: 0, bytes: 0, mimeType: "" }
                                    : val === "video" ? { itemType: "video", url: "", width: 0, height: 0, bytes: 0, mimeType: "" }
                                    : val === "audio" ? { itemType: "audio", url: "", bytes: 0, mimeType: "" }
                                    : { itemType: "assetRef", refId: "", refKind: "text" }
                                ) as CompositeItem;
                                onChange(next);
                            }}
                        />
                        <Button size="small" danger onClick={() => removeItem(idx)}>{t("common.delete")}</Button>
                    </div>
                    {item.itemType === "text" && (
                        <Input.TextArea rows={3} value={item.content} onChange={e => updateItem(idx, { content: e.target.value })} placeholder={t("assets.composite.textPlaceholder")} />
                    )}
                    {item.itemType === "assetRef" && (
                        <div className="flex gap-2">
                            <Select className="flex-1" showSearch optionFilterProp="label" placeholder={t("assets.composite.selectAsset")} value={item.refId || undefined}
                                options={refOptions}
                                onChange={(val) => {
                                    const refAsset = assets.find(a => a.id === val);
                                    const refItem = item as { itemType: "assetRef"; refId: string; refKind: "text" | "image" | "video" | "audio" };
                                    updateItem(idx, { refId: val, refKind: (refAsset?.kind ?? refItem.refKind) as "text" | "image" | "video" | "audio" });
                                }}
                            />
                            <Tag>{(item as { itemType: "assetRef"; refId: string; refKind: string }).refKind}</Tag>
                        </div>
                    )}
                    {item.itemType === "image" && (
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <Input placeholder={t("assets.composite.mediaUrlPlaceholder")} value={item.url} onChange={e => updateItem(idx, { url: e.target.value, width: 0, height: 0, bytes: 0, mimeType: "" })} />
                                <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => openImgUpload(idx)} />
                            </div>
                            {previews[idx] && (
                                <div className="rounded border border-stone-200 dark:border-stone-700 overflow-hidden">
                                    <img src={previews[idx]} alt="" className="max-h-24 object-contain" />
                                </div>
                            )}
                            {item.width && item.height ? <Typography.Text type="secondary" className="text-xs">{item.width}x{item.height} · {formatBytes(item.bytes)} · {item.mimeType}</Typography.Text> : null}
                        </div>
                    )}
                    {item.itemType === "video" && (
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <Input placeholder={t("assets.composite.mediaUrlPlaceholder")} value={item.url} onChange={e => updateItem(idx, { url: e.target.value, bytes: 0, mimeType: "" })} />
                                <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => openMediaUpload(idx, "video")} />
                            </div>
                            {previews[idx] && (
                                <div className="rounded border border-stone-200 dark:border-stone-700 overflow-hidden">
                                    <video src={previews[idx]} className="max-h-24 w-full object-contain" controls preload="metadata" />
                                </div>
                            )}
                            {item.bytes ? <Typography.Text type="secondary" className="text-xs">{formatBytes(item.bytes)} · {item.mimeType}</Typography.Text> : null}
                        </div>
                    )}
                    {item.itemType === "audio" && (
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <Input placeholder={t("assets.composite.mediaUrlPlaceholder")} value={item.url} onChange={e => updateItem(idx, { url: e.target.value, bytes: 0, mimeType: "" })} />
                                <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => openMediaUpload(idx, "audio")} />
                            </div>
                            {previews[idx] && (
                                <div className="rounded border border-stone-200 dark:border-stone-700">
                                    <audio src={previews[idx]} controls preload="metadata" className="w-full" />
                                </div>
                            )}
                            <div className="flex gap-2 items-center">
                                {item.bytes ? <Typography.Text type="secondary" className="text-xs">{formatBytes(item.bytes)}</Typography.Text> : null}
                                {item.durationMs ? <Typography.Text type="secondary" className="text-xs">{Math.round(item.durationMs / 1000)}s</Typography.Text> : null}
                            </div>
                        </div>
                    )}
                </div>
            ))}
            <div className="flex flex-wrap gap-2">
                {(["text", "image", "video", "audio", "assetRef"] as const).map(type => (
                    <Button key={type} size="small" onClick={() => addItem(type)}>+ {type}</Button>
                ))}
            </div>
            <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
            <input ref={mediaInputRef} type="file" accept={mediaKind === "video" ? "video/*" : "audio/*"} className="hidden" onChange={handleMediaUpload} />
        </div>
    );
}
