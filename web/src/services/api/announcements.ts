import { apiGet } from "@/services/api/request";
import type { Announcement } from "@/services/api/admin";

export async function fetchAnnouncements() {
    return apiGet<Announcement[]>("/api/announcements");
}
