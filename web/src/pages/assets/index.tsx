import { Copy, Download, PencilLine, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Card, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetFolderTree, type AssetFolderSelection } from "@/components/asset-folder-tree";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetCatalog } from "@/hooks/use-asset-catalog";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { createEagleAsset, createEagleTextAsset, deleteEagleAsset, isEagleAsset, updateEagleAsset } from "@/services/eagle-assets";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    eagleFolderId?: string;
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = (ImageAsset["data"] & { sourceDataUrl?: string }) | null;

const kindOptions = ["all", "text", "image", "video"] as const;

function eagleFolderIds(asset: Asset) {
    const folderIds = asset.metadata?.eagleFolderIds;
    return Array.isArray(folderIds) ? folderIds.filter((id): id is string => typeof id === "string") : [];
}

function assetBelongsToFolder(asset: Asset, selection: AssetFolderSelection) {
    if (selection === "all") return true;
    if (selection === "local") return !isEagleAsset(asset);
    if (selection === "eagle") return isEagleAsset(asset);
    if (!isEagleAsset(asset)) return false;
    if (selection === "eagle:uncategorized") return eagleFolderIds(asset).length === 0;
    return eagleFolderIds(asset).includes(selection.slice("eagle:".length));
}

function firstEagleFolderId(asset: Asset) {
    return eagleFolderIds(asset)[0];
}

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const { localAssets, assets, eagleAssets, eagleFolders, eagleLoading, eagleError, refreshEagle } = useAssetCatalog();
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [folderSelection, setFolderSelection] = useState<AssetFolderSelection>("all");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [assetTarget, setAssetTarget] = useState<"local" | "eagle">("local");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);
    const localValidAssets = useMemo(() => localAssets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [localAssets]);
    const currentFolderLabel = useMemo(() => {
        if (folderSelection === "all") return t("assets.folders.all");
        if (folderSelection === "local") return t("assets.folders.local");
        if (folderSelection === "eagle") return t("assets.folders.eagle");
        if (folderSelection === "eagle:uncategorized") return t("assets.folders.uncategorized");
        return eagleFolders.find((folder) => folder.id === folderSelection.slice("eagle:".length))?.name || t("assets.folders.eagle");
    }, [eagleFolders, folderSelection, t]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (!assetBelongsToFolder(asset, folderSelection)) return false;
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter, folderSelection]);

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
        setFormKind("text");
        const inEagle = folderSelection === "eagle" || folderSelection.startsWith("eagle:");
        setAssetTarget(inEagle ? "eagle" : "local");
        form.setFieldsValue({
            kind: "text",
            title: "",
            coverUrl: "",
            tags: [],
            eagleFolderId: folderSelection.startsWith("eagle:") && folderSelection !== "eagle:uncategorized" ? folderSelection.slice("eagle:".length) : undefined,
            source: t("assets.manual"),
            note: "",
            content: "",
        });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setAssetTarget(isEagleAsset(asset) ? "eagle" : "local");
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            eagleFolderId: isEagleAsset(asset) ? firstEagleFolderId(asset) : undefined,
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();

        if (editingAsset && isEagleAsset(editingAsset)) {
            try {
                await updateEagleAsset(editingAsset, {
                    name: values.title.trim(),
                    tags: values.tags || [],
                    annotation: values.note?.trim() || "",
                    content: values.kind === "text" ? (values.content || "").trim() : undefined,
                });
                refreshEagle();
                message.success(t("assets.eagleUpdated"));
                setIsAssetOpen(false);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("assets.eagleWriteFailed"));
            }
            return;
        }

        if (assetTarget === "eagle") {
            if (values.kind === "text") {
                try {
                    await createEagleTextAsset({ content: (values.content || "").trim(), name: values.title.trim(), tags: values.tags || [], folders: values.eagleFolderId ? [values.eagleFolderId] : undefined, annotation: values.note?.trim() || "" });
                    refreshEagle();
                    message.success(t("assets.eagleTextSaved"));
                    setIsAssetOpen(false);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("assets.eagleWriteFailed"));
                }
                return;
            }
            if (!imageDraft?.sourceDataUrl) {
                message.error(t("assets.selectImage"));
                return;
            }
            try {
                await createEagleAsset({ base64: imageDraft.sourceDataUrl, name: values.title.trim(), tags: values.tags || [], folders: values.eagleFolderId ? [values.eagleFolderId] : undefined, annotation: values.note?.trim() || "" });
                refreshEagle();
                message.success(t("assets.eagleSaved"));
                setIsAssetOpen(false);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("assets.eagleWriteFailed"));
            }
            return;
        }

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
        } else {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = {
                ...base,
                kind: "image" as const,
                data: {
                    dataUrl: imageDraft.dataUrl,
                    storageKey: imageDraft.storageKey,
                    width: imageDraft.width,
                    height: imageDraft.height,
                    bytes: imageDraft.bytes,
                    mimeType: imageDraft.mimeType,
                },
            };
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
        const [sourceDataUrl, image] = await Promise.all([readFileAsDataUrl(file), uploadImage(file)]);
        const draft = { sourceDataUrl, dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        saveAs(asset.kind === "video" ? asset.data.url : asset.data.dataUrl, `${asset.title || "asset"}.${asset.data.mimeType.split("/")[1] || "png"}`);
    };

    const exportAllAssets = async () => {
        if (!localValidAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        await exportAssets(localValidAssets, t("assets.packageName"));
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
        if (isEagleAsset(deletingAsset)) {
            void deleteEagleAsset(deletingAsset)
                .then(() => {
                    refreshEagle();
                    message.success(t("assets.eagleDeleted"));
                })
                .catch((error) => message.error(error instanceof Error ? error.message : t("assets.eagleWriteFailed")))
                .finally(() => setDeletingAsset(null));
            return;
        }
        removeAsset(deletingAsset.id);
        message.success(t("assets.deleted"));
        setDeletingAsset(null);
    };

    return (
        <div className="flex h-full min-h-0 overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <AssetFolderTree
                folders={eagleFolders}
                assets={eagleAssets}
                localAssetCount={localValidAssets.length}
                totalAssetCount={validAssets.length}
                selection={folderSelection}
                onSelect={(selection) => {
                    setPage(1);
                    setFolderSelection(selection);
                }}
            />

            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
                <div className="mx-auto flex max-w-[1600px] flex-col px-6 py-6 lg:px-10">
                    <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 dark:border-stone-800 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0">
                            <div className="text-xs font-medium uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">{t("assets.folders.current")}</div>
                            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{currentFolderLabel}</h1>
                            <div className="mt-1 flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                <span>
                                    {filteredAssets.length} {t("assets.title")}
                                </span>
                                {eagleLoading && folderSelection !== "local" ? <span>{t("assets.eagleLoading")}</span> : null}
                                {eagleError ? (
                                    <button type="button" className="text-amber-700 underline dark:text-amber-400" onClick={refreshEagle}>
                                        {t("assets.retryEagle")}
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center xl:max-w-[720px] xl:justify-end">
                            <Input.Search
                                className="min-w-0 w-full flex-1 sm:min-w-[18rem]"
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
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    aria-label={t("assets.export")}
                                    title={t("assets.export")}
                                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-stone-200 bg-background px-3 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-500"
                                    onClick={() => void exportAllAssets()}
                                >
                                    <Download className="size-4 shrink-0" />
                                    <span className="hidden sm:inline">{t("assets.export")}</span>
                                </button>
                                <button
                                    type="button"
                                    aria-label={t("assets.import")}
                                    title={t("assets.import")}
                                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-stone-200 bg-background px-3 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-500"
                                    onClick={() => assetInputRef.current?.click()}
                                >
                                    <Upload className="size-4 shrink-0" />
                                    <span className="hidden sm:inline">{t("assets.import")}</span>
                                </button>
                                <button
                                    type="button"
                                    aria-label={t("assets.add")}
                                    title={t("assets.add")}
                                    className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-stone-900 px-3 text-sm font-medium !text-white transition hover:bg-stone-700 dark:bg-sky-400 dark:!text-stone-950 dark:hover:bg-sky-300"
                                    onClick={openCreate}
                                >
                                    <Plus className="size-4 shrink-0" />
                                    <span>{t("assets.add")}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 border-b border-stone-200 py-4 dark:border-stone-800 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="mr-1 text-xs font-medium text-stone-500 dark:text-stone-400">{t("assets.type")}</span>
                            <div className="flex flex-wrap gap-1 rounded-lg border border-stone-200 bg-white/80 p-1 dark:border-stone-800 dark:bg-stone-900/70">
                                {kindOptions.map((option) => (
                                    <Tag.CheckableTag
                                        key={option}
                                        checked={kindFilter === option}
                                        className={cn("m-0 rounded-md px-2.5 py-1", kindFilter === option && "is-active")}
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
                        {eagleError ? <Alert className="py-1" type="warning" showIcon message={t("assets.eagleUnavailable")} description={eagleError} /> : null}
                    </div>

                    <div className="mt-6 flex flex-col gap-5">
                        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                            {visibleAssets.map((asset) => (
                                <AssetCard
                                    key={asset.id}
                                    asset={asset}
                                    readOnly={!isEagleAsset(asset) && asset.kind === "video"}
                                    onOpen={() => setPreviewAsset(asset)}
                                    onEdit={() => openEdit(asset)}
                                    onCopy={copyAssetText}
                                    onDownload={downloadImage}
                                    onDelete={() => setDeletingAsset(asset)}
                                />
                            ))}
                        </div>

                        {!visibleAssets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}

                        <div className="flex justify-center pb-6">
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
                </div>
            </main>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item label={t("assets.target")}>
                            <Select
                                value={assetTarget}
                                disabled={Boolean(editingAsset)}
                                options={[
                                    { label: t("assets.targets.local"), value: "local" },
                                    { label: t("assets.targets.eagle"), value: "eagle" },
                                ]}
                                onChange={(value) => setAssetTarget(value)}
                            />
                        </Form.Item>
                        {assetTarget === "eagle" ? (
                            <Form.Item name="eagleFolderId" label={t("assets.fields.folder")}>
                                <Select allowClear disabled={Boolean(editingAsset)} placeholder={t("assets.fields.folderPlaceholder")} options={eagleFolders.map((folder) => ({ label: folder.name, value: folder.id }))} />
                            </Form.Item>
                        ) : null}
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                    { label: t("assets.kinds.video"), value: "video", disabled: !editingAsset },
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
                        ) : formKind === "video" ? (
                            <Typography.Text type="secondary" className="block rounded-lg border border-dashed border-stone-300 p-4 text-xs dark:border-stone-700">
                                {t("assets.eagleMetadataOnly")}
                            </Typography.Text>
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
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>
        </div>
    );
}

function AssetCard({ asset, readOnly, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; readOnly?: boolean; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
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
                        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                            {asset.kind === "text" ? asset.data.content : t("assets.noCover")}
                        </div>
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
                {!readOnly && asset.kind !== "video" ? (
                    <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                        {t("common.edit")}
                    </Button>
                ) : null}
                {asset.kind === "text" ? (
                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("common.copy")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" ? (
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>
                        {t("common.download")}
                    </Button>
                ) : null}
                {!readOnly ? (
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                        {t("common.delete")}
                    </Button>
                ) : null}
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
                        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
                            {asset.kind === "text" ? asset.data.content : t("assets.noCover")}
                        </div>
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
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.downloadVideo") : t("assets.downloadImage")}
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
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
