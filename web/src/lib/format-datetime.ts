// 后端的 created_at / updated_at 统一是 RFC3339 字符串，服务器进程跑在 UTC 时区，
// 字段末尾会带 "Z"。直接拼到 UI 上会让用户看到比本地少 8 小时的"假时间"。
// 这里统一按浏览器时区（用户当前所在时区）格式化。

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

const SHORT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// 完整时间，例如 "2026-05-21 15:59:16"
export function formatLocalDateTime(value?: string | null, fallback = "-") {
  const date = safeDate(value);
  if (!date) return fallback;
  return date.toLocaleString("zh-CN", DEFAULT_OPTIONS).replace(/\//g, "-");
}

// 简短形态，例如 "05-21 15:59"
export function formatLocalDateTimeShort(value?: string | null, fallback = "-") {
  const date = safeDate(value);
  if (!date) return fallback;
  return date.toLocaleString("zh-CN", SHORT_OPTIONS).replace(/\//g, "-");
}
