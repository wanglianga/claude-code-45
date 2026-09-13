// 全平台时间统一按 Asia/Shanghai (UTC+8) 渲染，不依赖浏览器或容器时区，
// 保证服务链正文时间、页面字段时间与结构化时间戳一致。
export function fmtTime(input: string | Date | null | undefined, withSeconds = false): string {
  if (input === null || input === undefined || input === '') return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '—';
  const shifted = new Date(d.getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
  const time = `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}${withSeconds ? ':' + p(shifted.getUTCSeconds()) : ''}`;
  return `${date} ${time}`;
}

export const fmtDateTime = (v: string | Date | null | undefined) => fmtTime(v, true);
export const fmtMin = (v: string | Date | null | undefined) => fmtTime(v, false);
