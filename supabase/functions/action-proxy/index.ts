// 动作引擎「接口动作」代理：前端不直连第三方接口，统一经此函数转发
// 安全策略：仅允许 http/https 且禁止 localhost / 内网地址，防 SSRF
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  // 内网段：10.x / 127.x / 172.16-31.x / 192.168.x
  if (/^10\./.test(h) || /^127\./.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (/^192\.168\./.test(h)) return true;
  return false;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { url, method, headers, body } = await req.json();
    const target = new URL(String(url));
    if (!['http:', 'https:'].includes(target.protocol)) {
      return new Response(JSON.stringify({ ok: false, message: '仅支持 http/https 协议' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (isBlockedHost(target.hostname)) {
      return new Response(JSON.stringify({ ok: false, message: '目标地址不允许访问' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const allowed = ['GET', 'POST', 'PUT', 'DELETE'];
    if (!allowed.includes(String(method))) {
      return new Response(JSON.stringify({ ok: false, message: '不支持的请求方法' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const resp = await fetch(target.toString(), {
      method: String(method),
      headers: (headers ?? {}) as Record<string, string>,
      body: String(method) === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });

    const text = await resp.text().catch(() => '');
    return new Response(
      JSON.stringify({ ok: resp.ok, status: resp.status, body: text.slice(0, 4000) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
