"use client";

import { App, Avatar, Card, Empty, Flex, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Crown, Image as ImageIcon, Medal, Trophy } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchImageLeaderboard, type LeaderboardItem } from "@/services/api/leaderboard";

const rankColor = ["#facc15", "#cbd5e1", "#fb923c"];
const rankIcons = [Trophy, Medal, Crown];

export default function LeaderboardPage() {
    const { message } = App.useApp();
    const [items, setItems] = useState<LeaderboardItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchImageLeaderboard(50)
            .then((res) => {
                if (!cancelled) setItems(res.items || []);
            })
            .catch((err: Error) => message.error(err.message || "加载排行榜失败"))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message]);

    const columns: ColumnsType<LeaderboardItem> = [
        {
            title: "排名",
            key: "rank",
            width: 80,
            render: (_, __, index) => {
                const Icon = rankIcons[index];
                if (Icon) {
                    return (
                        <Flex align="center" gap={6}>
                            <Icon className="size-4" style={{ color: rankColor[index] }} />
                            <Typography.Text strong style={{ color: rankColor[index] }}>
                                #{index + 1}
                            </Typography.Text>
                        </Flex>
                    );
                }
                return <Typography.Text type="secondary">#{index + 1}</Typography.Text>;
            },
        },
        {
            title: "用户",
            key: "user",
            render: (_, item) => (
                <Flex align="center" gap={10} style={{ minWidth: 0 }}>
                    <Avatar src={item.avatarUrl || undefined}>{(item.displayName || item.username || "U").slice(0, 1).toUpperCase()}</Avatar>
                    <Flex vertical style={{ minWidth: 0 }}>
                        <Typography.Text strong ellipsis>
                            {item.displayName || item.username || "匿名用户"}
                        </Typography.Text>
                        <Typography.Text type="secondary" ellipsis>
                            {item.username}
                        </Typography.Text>
                    </Flex>
                </Flex>
            ),
        },
        {
            title: "生图次数",
            dataIndex: "count",
            width: 160,
            align: "right",
            render: (value: number) => (
                <Typography.Text strong className="tabular-nums">
                    {value.toLocaleString()}
                </Typography.Text>
            ),
        },
    ];

    return (
        <main className="mx-auto h-full max-w-3xl overflow-auto px-6 py-10">
            <Flex vertical gap={24}>
                <Card variant="borderless">
                    <Flex align="center" justify="space-between">
                        <Flex align="center" gap={12}>
                            <ImageIcon className="text-blue-500" />
                            <Flex vertical>
                                <Typography.Title level={4} className="!mb-0">
                                    生图排行榜
                                </Typography.Title>
                                <Typography.Text type="secondary">按用户累计调用生图接口次数统计 Top 50</Typography.Text>
                            </Flex>
                        </Flex>
                        <Tag color="blue">{items.length} 人上榜</Tag>
                    </Flex>
                </Card>
                <Card variant="borderless">
                    <Spin spinning={loading}>
                        {!loading && items.length === 0 ? (
                            <Empty description="暂无数据，等待用户生成图片" />
                        ) : (
                            <Table<LeaderboardItem>
                                rowKey="userId"
                                columns={columns}
                                dataSource={items}
                                pagination={false}
                                size="middle"
                            />
                        )}
                    </Spin>
                </Card>
            </Flex>
        </main>
    );
}
