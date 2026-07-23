import { expect, test } from "bun:test";

import { useThemeStore } from "./use-theme-store";

test("主题 store 对没有持久化偏好的用户默认使用浅色", () => {
    expect(useThemeStore.getState().theme).toBe("light");
});
