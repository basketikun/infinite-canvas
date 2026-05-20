"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Form, Input } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { useUserStore } from "@/stores/use-user-store";

type LoginFormValues = {
  username: string;
  password: string;
  confirmPassword?: string;
};

type Mode = "login" | "register";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useUserStore((state) => state.login);
  const register = useUserStore((state) => state.register);
  const isLoading = useUserStore((state) => state.isLoading);
  const [mode, setMode] = useState<Mode>("login");
  const [form] = Form.useForm<LoginFormValues>();
  const redirect = searchParams.get("redirect") || "/";

  const goAfterAuth = (role: string) => {
    if (mode === "login" && role === "admin" && (redirect === "/" || redirect === "")) {
      router.replace("/admin");
    } else {
      router.replace(redirect.startsWith("/") ? redirect : "/");
    }
    router.refresh();
  };

  const submit = async (values: LoginFormValues) => {
    try {
      if (mode === "register") {
        if (!values.password || values.password !== values.confirmPassword) {
          message.error("两次输入的密码不一致");
          return;
        }
        const user = await register({ username: values.username, password: values.password });
        message.success(`注册成功，已赠送 ${user.credits} 次生图额度`);
        goAfterAuth(user.role);
        return;
      }
      const user = await login({ username: values.username, password: values.password });
      message.success("登录成功");
      goAfterAuth(user.role);
    } catch (error) {
      message.error(error instanceof Error ? error.message : mode === "register" ? "注册失败" : "登录失败");
    }
  };

  const toggleMode = () => {
    setMode((current) => (current === "login" ? "register" : "login"));
    form.resetFields(["password", "confirmPassword"]);
  };

  const isRegister = mode === "register";

  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
      <section className="w-full max-w-[420px]">
        <div className="mb-7 text-center">
          <span
            className="mx-auto mb-4 block size-12 bg-stone-950 dark:bg-stone-100"
            style={{
              mask: "url(/logo.svg) center / contain no-repeat",
              WebkitMask: "url(/logo.svg) center / contain no-repeat",
            }}
            aria-label="无限画布"
          />
          <h1 className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-100">{isRegister ? "注册账号" : "登录"}</h1>
          <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">
            {isRegister ? "新注册账号默认赠送 4 次生图额度，用完后请联系管理员充值。" : "登录后可使用画布、AI 生图、画布助手等功能。"}
          </p>
        </div>

        <Form<LoginFormValues> form={form} layout="vertical" size="large" requiredMark={false} onFinish={submit}>
          <Form.Item name="username" label={<span className="font-medium text-stone-800 dark:text-stone-200">用户名</span>} rules={[{ required: true, message: "请输入用户名" }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={<span className="font-medium text-stone-800 dark:text-stone-200">密码</span>} rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete={isRegister ? "new-password" : "current-password"} />
          </Form.Item>
          {isRegister ? (
            <Form.Item name="confirmPassword" label={<span className="font-medium text-stone-800 dark:text-stone-200">确认密码</span>} rules={[{ required: true, message: "请再次输入密码" }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
            </Form.Item>
          ) : null}
          <Button block type="primary" htmlType="submit" loading={isLoading}>
            {isRegister ? "注册并登录" : "登录"}
          </Button>
        </Form>

        <div className="mt-4 text-center text-sm text-stone-500 dark:text-stone-400">
          {isRegister ? "已有账号？" : "还没有账号？"}
          <button type="button" onClick={toggleMode} className="ml-1 font-medium text-stone-900 underline-offset-2 hover:underline dark:text-stone-100">
            {isRegister ? "去登录" : "去注册"}
          </button>
        </div>
      </section>
    </main>
  );
}
