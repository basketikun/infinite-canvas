import tseslint from "typescript-eslint";

// 注册入口只拼装从约定目录导入的贡献。业务实现放在贡献文件或 setup.ts 内。
const pluginEntry = {
    meta: { schema: [] },
    create(context) {
        function checkEntry(program) {
            const imports = new Map();
            const contributionFactories = new Set();
            let hasDefinePlugin = false;
            const register = program.body.find((node) => node.type === "ExportDefaultDeclaration");
            for (const node of program.body) {
                if (node === register) continue;
                if (node.type === "ImportDeclaration" && !node.specifiers.length && node.source.value.startsWith("./styles/")) continue;
                if (node.type !== "ImportDeclaration" || !node.specifiers.length) {
                    context.report({ node, message: "plugin.ts 只放具名或默认导入和 export default definePlugin({...})。" });
                    continue;
                }
                for (const item of node.specifiers) {
                    imports.set(item.local.name, node.source.value);
                    if (node.source.value === "@infinite-canvas/plugin-sdk" && item.imported?.name === "definePlugin" && item.local.name === "definePlugin") hasDefinePlugin = true;
                    if (["@infinite-canvas/plugin-sdk", "@infinite-canvas/plugin-sdk/runtime"].includes(node.source.value) && item.imported?.name === "contribute") contributionFactories.add(item.local.name);
                }
            }

            const call = register?.declaration;
            if (call?.type !== "CallExpression" || call.callee.name !== "definePlugin" || !hasDefinePlugin || call.arguments.length !== 1 || call.arguments[0].type !== "ObjectExpression") {
                context.report({ node: register ?? program, message: "请从 SDK 导入 definePlugin，并直接默认导出 definePlugin({...})。" });
                return;
            }

            const imported = (node) => node?.type === "Identifier" && imports.has(node.name);
            function contribution(node) {
                if (node?.type !== "CallExpression" || !contributionFactories.has(node.callee.name) || node.arguments.length !== 2 || !imported(node.arguments[0])) return false;
                const value = node.arguments[1];
                if (value.type !== "ObjectExpression" || value.properties.length !== 2 || value.properties.some((item) => item.type !== "Property" || item.computed || item.method)) return false;
                const id = value.properties.find((item) => item.key.name === "id")?.value;
                const implementation = value.properties.find((item) => item.key.name === "value")?.value;
                return imported(implementation) && (id?.type === "Literal" && typeof id.value === "string" || id?.type === "MemberExpression" && !id.computed && imported(id.object));
            }
            for (const prop of call.arguments[0].properties) {
                if (prop.type !== "Property" || prop.computed) {
                    context.report({ node: prop, message: "请显式登记每一类贡献。" });
                    continue;
                }
                const key = prop.key.name;
                const value = prop.value;
                if (key === "name" || key === "description") {
                    if (value?.type !== "Literal" || typeof value.value !== "string") context.report({ node: prop, message: "插件名称和说明直接写字符串。" });
                } else if (key === "css" || key === "setup") {
                    const path = imports.get(value?.name);
                    if (key === "setup" ? path !== "./setup" : !path?.startsWith("./styles/")) {
                        context.report({ node: prop, message: key === "setup" ? "从 ./setup 导入启动函数。" : "从 ./styles/ 导入插件样式。" });
                    }
                } else {
                    const check = key === "extensionPoints" ? imported : key === "contributions" ? contribution : null;
                    if (!check || value?.type !== "ArrayExpression" || !value.elements.every(check)) {
                        context.report({ node: prop, message: "扩展点从公开契约导入；贡献用 contribute(扩展点, { id, value }) 拼装导入的实现。入口不写业务逻辑。" });
                    }
                }
            }
        }
        return { Program: checkEntry };
    },
};

export default [{
    files: ["packages/shared/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: {
        "no-restricted-imports": ["error", { patterns: [{ group: ["../..", "../../**"], message: "shared 相对导入不能跨出 src。" }, { regex: "^(?!\\.{1,2}/|zod$|semver$)", message: "shared 只能依赖内部纯数据模块、Zod 和 SemVer。" }] }],
        "no-restricted-globals": ["error", "window", "document", "navigator", "localStorage", "indexedDB", "fetch", "process", "Buffer", "crypto", "globalThis", "global", "self"],
        "no-restricted-syntax": ["error", { selector: "ImportExpression", message: "shared 不使用动态运行环境导入。" }, { selector: "CallExpression[callee.name='require']", message: "shared 不加载 CommonJS 运行环境模块。" }],
    },
}, {
    files: ["plugins/*/src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
        "no-restricted-imports": ["error", { paths: [{ name: "@infinite-canvas/plugin-sdk", importNames: ["definePlugin"], message: "只在 src/plugin.ts 调用 definePlugin。" }] }],
    },
}, {
    files: ["plugins/*/src/plugin.ts"],
    plugins: { canvas: { rules: { "plugin-entry": pluginEntry } } },
    rules: { "no-restricted-imports": "off", "canvas/plugin-entry": "error" },
}];
