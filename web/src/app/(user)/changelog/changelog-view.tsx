"use client";

import { Flex, Tag, Timeline, Typography } from "antd";

import type { ChangelogVersion } from "@/lib/changelog-types";
import { tagColor } from "@/lib/changelog-types";

export function ChangelogView({ versions }: { versions: ChangelogVersion[] }) {
  return (
    <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-8">
          <Typography.Title level={2} style={{ margin: 0 }}>更新日志</Typography.Title>
          <Typography.Paragraph type="secondary" className="!mt-2 !mb-0">
            随项目代码同步发布，列出从首次开源以来每个版本的功能新增、调整、修复与安全说明。
          </Typography.Paragraph>
        </div>

        {versions.length === 0 ? (
          <Typography.Text type="secondary">暂无更新记录。</Typography.Text>
        ) : (
          <Timeline
            items={versions.map((v) => ({
              color: v.version === "Unreleased" ? "gray" : "blue",
              children: (
                <section className="pb-2">
                  <header className="mb-3 flex flex-wrap items-baseline gap-3">
                    <Typography.Title level={4} style={{ margin: 0 }}>
                      {v.version}
                    </Typography.Title>
                    {v.date ? <Typography.Text type="secondary">{v.date}</Typography.Text> : null}
                    {v.version === "Unreleased" ? <Tag color="default">开发中</Tag> : null}
                  </header>
                  <ul className="list-none space-y-2.5 p-0">
                    {v.entries.map((entry, index) => (
                      <li key={index} className="flex items-start gap-2">
                        {entry.tag ? (
                          <Tag color={tagColor(entry.tag)} className="!mr-0 !mt-0.5 shrink-0">
                            {entry.tag}
                          </Tag>
                        ) : null}
                        <Flex vertical gap={4} className="min-w-0 flex-1 text-sm leading-6">
                          {entry.text.split("\n").map((line, lineIdx) => (
                            <span key={lineIdx} className={lineIdx === 0 ? "" : "pl-2 text-stone-500 dark:text-stone-400"}>
                              {lineIdx === 0 ? line : `· ${line}`}
                            </span>
                          ))}
                        </Flex>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            }))}
          />
        )}
      </div>
    </main>
  );
}
