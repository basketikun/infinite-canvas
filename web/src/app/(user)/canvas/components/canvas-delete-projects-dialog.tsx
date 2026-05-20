"use client";

import { App, Button, Modal } from "antd";

import { deleteCanvas } from "@/services/api/canvases";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
  const { message } = App.useApp();
  const token = useUserStore((state) => state.token);
  const ids = useCanvasUiStore((state) => state.deleteProjectIds);
  const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
  const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);

  const confirm = async () => {
    const succeeded: string[] = [];
    for (const id of ids) {
      try {
        if (token) await deleteCanvas(token, id);
        succeeded.push(id);
      } catch (error) {
        message.error(error instanceof Error ? error.message : `删除画布 ${id} 失败`);
      }
    }
    if (succeeded.length) {
      useCanvasStore.getState().deleteProjects(succeeded);
      removeSelectedIds(succeeded);
    }
    setDeleteIds([]);
  };

  return (
    <Modal
      title="删除画布？"
      open={ids.length > 0}
      centered
      onCancel={() => setDeleteIds([])}
      footer={<><Button onClick={() => setDeleteIds([])}>取消</Button><Button danger type="primary" onClick={() => void confirm()}>删除</Button></>}
    >
      <p className="text-sm text-stone-500">将删除 {ids.length} 个画布，里面的节点和连线也会一起移除。</p>
    </Modal>
  );
}
