// 带 429 重试的 Supabase 查询执行器：从根本上解决 API 请求超限导致列表空白/数据丢失
// 用法：await withRetry(() => supabase.from('xxx').select(...).then(r => r))
// 或：   await withRetry(() => supabase.rpc('xxx', {...}).then(r => r))

const MAX_RETRY = 3;
const BASE_DELAY_MS = 800;

function isRateLimit(result: unknown): boolean {
  const r = result as { error?: { status?: number; code?: string; message?: string } } | null;
  if (!r?.error) return false;
  return r.error.status === 429 || r.error.code === '429' || (r.error.message ?? '').includes('429');
}

export async function withRetry<T>(fn: () => PromiseLike<T>, retries = MAX_RETRY): Promise<T> {
  let lastResult: T | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await fn();
    lastResult = result;
    if (!isRateLimit(result)) return result;
    // 指数退避：800ms / 1600ms / 3200ms
    await new Promise((r) => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt)));
  }
  return lastResult as T;
}
