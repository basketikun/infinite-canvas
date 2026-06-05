import { apiGet, apiPost, compactApiParams } from "@/services/api/request";
import type { AuthUser, MembershipLevel } from "@/services/api/auth";

export type PaymentProvider = "wechat" | "alipay" | "mock";

export type MembershipPlan = {
    id: string;
    name: string;
    level: MembershipLevel;
    description: string;
    price: number;
    durationDays: number;
    creditsGranted: number;
    unlimited: boolean;
    priorityQueue: boolean;
    features: string;
    enabled: boolean;
    sort: number;
    createdAt: string;
    updatedAt: string;
};

export type MembershipPlanListResponse = {
    items: MembershipPlan[];
    total: number;
};

export type MembershipOrderStatus = "pending" | "paid" | "cancelled";

export type MembershipOrder = {
    id: string;
    userId: string;
    planId: string;
    planName: string;
    planLevel: MembershipLevel;
    amount: number;
    status: MembershipOrderStatus;
    paymentProvider: PaymentProvider;
    paymentId: string;
    payUrl: string;
    paidAt: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
};

export type MembershipOrderListResponse = {
    items: MembershipOrder[];
    total: number;
};

export type MembershipQuery = {
    keyword?: string;
    page?: number;
    pageSize?: number;
};

export async function fetchMembershipPlans(token: string, query: MembershipQuery = {}) {
    return apiGet<MembershipPlanListResponse>("/api/v1/membership/plans", compactApiParams(query), token);
}

export async function fetchMyMembership(token: string) {
    return apiGet<AuthUser>("/api/v1/membership/me", undefined, token);
}

export async function fetchMyMembershipOrders(token: string, query: MembershipQuery = {}) {
    return apiGet<MembershipOrderListResponse>("/api/v1/membership/orders", compactApiParams(query), token);
}

export async function createMembershipOrder(token: string, planId: string, provider: PaymentProvider) {
    return apiPost<MembershipOrder>("/api/v1/membership/orders", { planId, provider }, token);
}

export async function cancelMembershipOrder(token: string, id: string) {
    return apiPost<boolean>(`/api/v1/membership/orders/${encodeURIComponent(id)}/cancel`, {}, token);
}

export async function mockPayMembershipOrder(token: string, id: string) {
    return apiPost<MembershipOrder>(`/api/v1/membership/orders/${encodeURIComponent(id)}/mock-pay`, {}, token);
}

export async function refreshMembershipOrderPay(token: string, id: string) {
    return apiPost<MembershipOrder>(`/api/v1/membership/orders/${encodeURIComponent(id)}/refresh-pay`, {}, token);
}
