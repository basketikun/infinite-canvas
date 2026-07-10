import { ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCanvasSession, normalizeReturnTo } from "@/lib/server/canvas-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string; error?: string }> }) {
    const session = await getCanvasSession();
    const params = await searchParams;
    const returnTo = normalizeReturnTo(params.return_to);
    if (session) redirect(returnTo);

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
            <section className="w-full max-w-md rounded-2xl border border-stone-200 bg-background p-8 dark:border-stone-800">
                <div className="mb-7 flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950">
                        <LockKeyhole className="size-5" />
                    </span>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight">登录无限画布</h1>
                        <p className="mt-1 text-sm text-stone-500">使用 Token 账号安全授权，无需手动填写 API Key</p>
                    </div>
                </div>
                {params.error ? <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{params.error}</div> : null}
                <Link
                    href={`/api/auth/login?return_to=${encodeURIComponent(returnTo)}`}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                    使用 Token 账号一键登录
                    <ArrowRight className="size-4" />
                </Link>
                <p className="mt-5 text-center text-xs leading-5 text-stone-500">登录后系统会自动创建或复用 image 分组令牌。真实密钥仅保存在服务器加密会话中。</p>
            </section>
        </main>
    );
}
