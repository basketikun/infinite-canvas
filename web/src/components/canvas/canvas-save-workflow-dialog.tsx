import { Form, Input, Modal } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export function CanvasSaveWorkflowDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: (title: string) => void }) {
    const { t } = useTranslation();
    const [form] = Form.useForm<{ title: string }>();
    useEffect(() => { if (open) form.resetFields(); }, [form, open]);

    const submit = async () => {
        try {
            const { title } = await form.validateFields();
            onConfirm(title.trim());
            form.resetFields();
        } catch {}
    };

    return (
        <Modal title={t("canvas.workflow.saveTitle")} open={open} okText={t("canvas.workflow.save")} cancelText={t("common.cancel")} onCancel={onCancel} onOk={() => void submit()} destroyOnHidden>
            <Form form={form} layout="vertical" className="pt-3">
                <Form.Item name="title" label={t("canvas.workflow.name")} rules={[{ required: true, whitespace: true, message: t("canvas.workflow.nameRequired") }, { max: 80, message: t("canvas.workflow.nameMax") }]}>
                    <Input autoFocus maxLength={80} placeholder={t("canvas.workflow.namePlaceholder")} onPressEnter={() => void submit()} />
                </Form.Item>
            </Form>
        </Modal>
    );
}
