import { apiGet, compactApiParams } from "@/services/api/request";

export type LeaderboardItem = {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    count: number;
};

export type LeaderboardResponse = {
    items: LeaderboardItem[];
};

export async function fetchImageLeaderboard(limit = 50) {
    return apiGet<LeaderboardResponse>("/api/leaderboard/images", compactApiParams({ limit }));
}
