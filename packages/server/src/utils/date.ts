/** 将日期格式化为适合文件名使用的本地日期字符串。 */
export function formatDateForFilename(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
