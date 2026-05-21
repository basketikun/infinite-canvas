"use client";

import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { useQuery } from "@tanstack/react-query";
import { App, Avatar, Card, Col, Flex, Row, Space, Statistic, Tag, Typography } from "antd";
import { Coins, Gift, ImageIcon, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { RequireAuth } from "@/components/require-auth";
import { fetchCreditLogs, fetchProfile, type CreditLog, type CreditLogType } from "@/services/api/user";
import { formatLocalDateTime } from "@/lib/format-datetime";
import { useUserStore } from "@/stores/use-user-store";

const typeLabels: Record<CreditLogType, { label: string; color: string }> = {
  consume: { label: "生图消耗", color: "red" },
  admin_adjust: { label: "管理员调整", color: "blue" },
  signup_bonus: { label: "注册赠送", color: "green" },
};

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}

function ProfileContent() {
  const { message } = App.useApp();
  const token = useUserStore((state) => state.token);
  const setCredits = useUserStore((state) => state.setCredits);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const profileQuery = useQuery({
    queryKey: ["profile", token],
    queryFn: () => fetchProfile(token),
    enabled: Boolean(token),
    retry: false,
  });

  const logsQuery = useQuery({
    queryKey: ["credit-logs", token, page, pageSize],
    queryFn: () => fetchCreditLogs(token, { page, pageSize }),
    enabled: Boolean(token),
    retry: false,
  });

  useEffect(() => {
    if (profileQuery.isError) {
      message.error(profileQuery.error instanceof Error ? profileQuery.error.message : "读取个人信息失败");
    }
  }, [message, profileQuery.error, profileQuery.isError]);

  useEffect(() => {
    if (logsQuery.isError) {
      message.error(logsQuery.error instanceof Error ? logsQuery.error.message : "读取积分流水失败");
    }
  }, [message, logsQuery.error, logsQuery.isError]);

  useEffect(() => {
    if (profileQuery.data?.user?.credits != null) {
      setCredits(profileQuery.data.user.credits);
    }
  }, [profileQuery.data, setCredits]);

  const profile = profileQuery.data;
  const user = profile?.user;
  const isAdmin = user?.role === "admin";

  const columns: ProColumns<CreditLog>[] = [
    { title: "时间", dataIndex: "createdAt", width: 200, render: (_, item) => <Typography.Text type="secondary">{formatLocalDateTime(item.createdAt)}</Typography.Text> },
    {
      title: "类型",
      dataIndex: "type",
      width: 132,
      render: (_, item) => {
        const cfg = typeLabels[item.type] || { label: item.type, color: "default" };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: "变动",
      dataIndex: "amount",
      width: 110,
      render: (_, item) => (
        <Typography.Text strong style={{ color: item.amount >= 0 ? "#16a34a" : "#dc2626" }}>
          {item.amount > 0 ? `+${item.amount}` : item.amount}
        </Typography.Text>
      ),
    },
    { title: "变动后余额", dataIndex: "balance", width: 110 },
    { title: "模型", dataIndex: "model", width: 160, render: (_, item) => (item.model ? <Tag>{item.model}</Tag> : <Typography.Text type="secondary">-</Typography.Text>) },
    { title: "备注", dataIndex: "remark", render: (_, item) => <Typography.Text type="secondary">{item.remark || "-"}</Typography.Text> },
  ];

  return (
    <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <Card variant="borderless" loading={profileQuery.isLoading}>
          <Flex align="center" gap={20} wrap>
            <Avatar size={64} style={{ background: isAdmin ? "#fde68a" : "#dbeafe", color: isAdmin ? "#92400e" : "#1d4ed8", fontSize: 24 }}>
              {(user?.username?.[0] || "U").toUpperCase()}
            </Avatar>
            <Flex vertical gap={6} style={{ minWidth: 0 }}>
              <Space size={10} align="center">
                <Typography.Title level={4} style={{ margin: 0 }}>{user?.username || "..."}</Typography.Title>
                {isAdmin ? <Tag color="gold">管理员</Tag> : <Tag>普通用户</Tag>}
              </Space>
              <Typography.Text type="secondary">注册时间：{formatLocalDateTime(user?.createdAt)}</Typography.Text>
            </Flex>
            <div style={{ flex: 1 }} />
            <Flex vertical align="end" gap={4}>
              <Typography.Text type="secondary">当前剩余</Typography.Text>
              <Typography.Title level={2} style={{ margin: 0, color: isAdmin ? "#b45309" : "#1d4ed8" }}>
                {isAdmin ? "∞" : `${user?.credits ?? 0}`}
                <Typography.Text type="secondary" style={{ fontSize: 14, marginLeft: 6 }}>积分</Typography.Text>
              </Typography.Title>
            </Flex>
          </Flex>
        </Card>

        <Row gutter={16}>
          <Col xs={24} sm={8}>
            <Card variant="borderless">
              <Statistic title={<Space size={6}><Sparkles className="size-3.5" />累计消耗</Space>} value={profile?.totalConsumed ?? 0} suffix="积分" />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card variant="borderless">
              <Statistic title={<Space size={6}><Gift className="size-3.5" />累计获赠</Space>} value={profile?.totalGranted ?? 0} suffix="积分" />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card variant="borderless">
              <Statistic title={<Space size={6}><ImageIcon className="size-3.5" />累计生图</Space>} value={profile?.generatedCount ?? 0} suffix="次" />
            </Card>
          </Col>
        </Row>

        <ProTable<CreditLog>
          rowKey="id"
          columns={columns}
          dataSource={logsQuery.data?.items || []}
          loading={logsQuery.isFetching}
          search={false}
          defaultSize="middle"
          tableLayout="fixed"
          cardProps={{ variant: "borderless" }}
          headerTitle={<Space><Coins className="size-4" /><Typography.Text strong>积分流水</Typography.Text><Tag>{logsQuery.data?.total ?? 0} 条</Tag></Space>}
          options={{ density: true, setting: true, reload: () => void logsQuery.refetch() }}
          pagination={{
            current: page,
            pageSize,
            total: logsQuery.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (value) => `共 ${value} 条`,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== pageSize) {
                setPageSize(nextPageSize);
                setPage(1);
              } else {
                setPage(nextPage);
              }
            },
          }}
          locale={{ emptyText: <Flex vertical align="center" gap={6} style={{ padding: 24 }}><UserRound className="size-5 text-stone-400" /><Typography.Text type="secondary">暂无积分流水</Typography.Text></Flex> }}
        />
      </div>
    </main>
  );
}
