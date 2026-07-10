import { create } from "zustand";

// Agent 面板通过该 store 向生图/视频工作台派发命令：设置提示词、并可选自动点击生成。
// 参数（模型/质量/尺寸/张数等）由 Agent 面板直接写入 use-config-store，工作台页面从 config 读取；
// prompt 与 run 通过这里下发，页面用 nonce 判断是否为新命令，消费后调用 clear 清空。

export type WorkbenchCommand = {
    nonce: number;
    prompt?: string;
    run: boolean;
};

type WorkbenchAgentStore = {
    imageCommand: WorkbenchCommand | null;
    videoCommand: WorkbenchCommand | null;
    dispatchImage: (command: Omit<WorkbenchCommand, "nonce">) => void;
    dispatchVideo: (command: Omit<WorkbenchCommand, "nonce">) => void;
    clearImageCommand: () => void;
    clearVideoCommand: () => void;
};

let nonce = 0;
const nextNonce = () => (nonce += 1);

export const useWorkbenchAgentStore = create<WorkbenchAgentStore>((set) => ({
    imageCommand: null,
    videoCommand: null,
    dispatchImage: (command) => set({ imageCommand: { ...command, nonce: nextNonce() } }),
    dispatchVideo: (command) => set({ videoCommand: { ...command, nonce: nextNonce() } }),
    clearImageCommand: () => set({ imageCommand: null }),
    clearVideoCommand: () => set({ videoCommand: null }),
}));
