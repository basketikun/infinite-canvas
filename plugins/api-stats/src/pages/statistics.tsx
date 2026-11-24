import { ChartColumn } from "lucide-react";
import type { PluginPage } from "@infinite-canvas/plugin-sdk";
import { Overview } from "../components/overview";

export const statisticsPage: PluginPage = { id: "api-stats:statistics", title: "调用统计", icon: <ChartColumn className="size-4" />, navigation: true, Content: ({ ctx }) => <Overview ctx={ctx} /> };
