"use client";

import { ApiOutlined, FileTextOutlined, HomeOutlined, LogoutOutlined, PictureOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Typography } from "antd";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { UserStatusActions } from "@/components/user-status-actions";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useUserStore((state) => state.token);
  const user = useUserStore((state) => state.user);
  const isReady = useUserStore((state) => state.isReady);
  const logout = useUserStore((state) => state.clearSession);
  const colorTheme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const adminMenuItems = [
    { key: "/admin/users", icon: <TeamOutlined />, label: <Link href="/admin/users" style={{ color: "inherit" }}>用户管理</Link>, title: "用户管理" },
    { key: "/admin/ai-configs", icon: <ApiOutlined />, label: <Link href="/admin/ai-configs" style={{ color: "inherit" }}>模型配置</Link>, title: "模型配置" },
    { key: "/admin/prompts", icon: <FileTextOutlined />, label: <Link href="/admin/prompts" style={{ color: "inherit" }}>提示词管理</Link>, title: "提示词管理" },
    { key: "/admin/assets", icon: <PictureOutlined />, label: <Link href="/admin/assets" style={{ color: "inherit" }}>素材库</Link>, title: "素材库管理" },
  ];
  const activeMenu = adminMenuItems.find((item) => pathname.startsWith(item.key));
  const activeKey = activeMenu?.key || "";
  const pageTitle = activeMenu?.title || "管理后台";
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

  useEffect(() => {
    if (!isReady) return;
    if (!token) {
      router.replace("/login?redirect=/admin");
      return;
    }
    if (user?.role !== "admin") {
      router.replace("/");
    }
  }, [isReady, router, token, user?.role]);

  if (!isReady || !token || user?.role !== "admin") {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--background)" }}>
        <span />
      </div>
    );
  }

  return (
    <Layout className="admin-layout" hasSider style={{ height: "100vh", overflow: "hidden" }}>
        <Layout.Sider width={232} style={{ height: "100vh", overflow: "hidden" }}>
          <Flex className="admin-brand" align="center" gap={12} style={{ height: 56, padding: "0 20px" }}>
            <span className="admin-logo" aria-hidden />
            <Typography.Text strong style={{ fontSize: 16 }}>无限画布</Typography.Text>
          </Flex>
          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            style={{ borderInlineEnd: 0, padding: "12px 8px" }}
            items={adminMenuItems.map(({ key, icon, label }) => ({ key, icon, label }))}
          />
          <Flex vertical gap={8} style={{ position: "absolute", bottom: 0, insetInline: 0, padding: 12 }}>
            <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer">前往画布</Button>
            <Button block icon={<LogoutOutlined />} onClick={logout}>退出登录</Button>
          </Flex>
        </Layout.Sider>
        <Layout>
          <Layout.Header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, padding: "0 24px" }}>
            <Typography.Title level={5} style={{ margin: 0 }}>{pageTitle}</Typography.Title>
            <Flex align="center" gap={4}>
              <UserStatusActions
                version={appVersion}
                theme={colorTheme}
                onThemeChange={setTheme}
                userName={user.username}
                menuItems={[{ key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: logout }]}
              />
            </Flex>
          </Layout.Header>
          <Layout.Content style={{ minHeight: 0, overflow: "auto" }}>{children}</Layout.Content>
        </Layout>
      </Layout>
  );
}
