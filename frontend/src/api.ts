// 统一 API 封装：生产环境由 nginx 反代 /api → NestJS
const BASE = '/api';
let tokenGetter: () => string | null = () => localStorage.getItem('token');

export function setTokenGetter(fn: () => string | null) { tokenGetter = fn; }

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = tokenGetter();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...(opts.headers as any) } });
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (!location.pathname.endsWith('/login') && !path.includes('auth/login')) location.reload();
    throw new Error('未登录或登录已过期');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: any) =>
  api<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
