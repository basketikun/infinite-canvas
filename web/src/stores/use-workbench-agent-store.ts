import { create } from "zustand";

// Agent 面板通过该 store 向生图/视频工作台派发命令：设置提示词、并可选自动点击生成。
// 参数（模型/质量/尺寸/张数等）由 Agent 面板直接写入 use-config-store，工作台页面从 config 读取；
// prompt 与 run 通过这里下发，页面用 nonce 判断是否为新命令，消费后调用 clear 清空。

export type WorkbenchCommand = {
    nonce: number;
    taskId?: string;
    prompt?: string;
    run: boolean;
};

export type WorkbenchGenerationTask = {
    id: string;
    kind: "image" | "video";
    status: "queued" | "running" | "succeeded" | "failed";
    prompt?: string;
    createdAt: string;
    updatedAt: string;
    successCount?: number;
    failCount?: number;
    error?: string;
};

type WorkbenchAgentStore = {
    imageCommand: WorkbenchCommand | null;
    videoCommand: WorkbenchCommand | null;
    tasks: WorkbenchGenerationTask[];
    dispatchImage: (command: Omit<WorkbenchCommand, "nonce" | "taskId">) => string | undefined;
    dispatchVideo: (command: Omit<WorkbenchCommand, "nonce" | "taskId">) => string | undefined;
    updateTask: (id: string, patch: Partial<Pick<WorkbenchGenerationTask, "status" | "successCount" | "failCount" | "error">>) => void;
    clearImageCommand: () => void;
    clearVideoCommand: () => void;
};

let nonce = 0;
const nextNonce = () => (nonce += 1);

export const useWorkbenchAgentStore = create<WorkbenchAgentStore>((set) => ({
    imageCommand: null,
    videoCommand: null,
    tasks: [],
    dispatchImage: (command) => {
        const commandNonce = nextNonce();
        const task = command.run ? createTask("image", commandNonce, command.prompt) : undefined;
        set((state) => ({ imageCommand: { ...command, nonce: commandNonce, taskId: task?.id }, tasks: task ? [task, ...state.tasks].slice(0, 30) : state.tasks }));
        return task?.id;
    },
    dispatchVideo: (command) => {
        const commandNonce = nextNonce();
        const task = command.run ? createTask("video", commandNonce, command.prompt) : undefined;
        set((state) => ({ videoCommand: { ...command, nonce: commandNonce, taskId: task?.id }, tasks: task ? [task, ...state.tasks].slice(0, 30) : state.tasks }));
        return task?.id;
    },
    updateTask: (id, patch) => set((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task)) })),
    clearImageCommand: () => set({ imageCommand: null }),
    clearVideoCommand: () => set({ videoCommand: null }),
}));

function createTask(kind: "image" | "video", commandNonce: number, prompt?: string): WorkbenchGenerationTask {
    const now = new Date().toISOString();
    return { id: `${kind}-${commandNonce}`, kind, status: "queued", prompt, createdAt: now, updatedAt: now };
}
