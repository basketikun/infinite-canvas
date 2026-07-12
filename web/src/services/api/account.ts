export type AccountBalance = {
    quota: number;
    quotaPerUnit: number;
    quotaDisplayType: string;
    usdExchangeRate: number;
    customCurrencySymbol: string;
    customCurrencyExchangeRate: number;
    rechargeUrl: string;
};

export async function getAccountBalance() {
    const response = await fetch("/api/account/balance", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = (await response.json()) as AccountBalance & { error?: string };
    if (!response.ok) throw new Error(payload.error || "余额读取失败");
    return payload;
}
