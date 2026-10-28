// 管理员用户操作：创建员工登录账号 / 重置密码
// 仅超管可用（通过调用方 JWT 校验 profiles.is_superadmin）
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  // CORS 预检：必须最先返回，浏览器才会放行真正的 POST
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await anon.auth.getUser();
  if (userErr || !user) return json({ error: '未登录' }, 401);

  const { data: prof } = await anon.from('profiles').select('is_superadmin').eq('id', user.id).maybeSingle();
  if (!prof?.is_superadmin) return json({ error: '仅超级管理员可执行该操作' }, 403);

  const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: { action: string; email?: string; password?: string; name?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: '请求体格式错误' }, 400);
  }

  if (body.action === 'create-user') {
    if (!body.email || !body.password || body.password.length < 6) {
      return json({ error: '邮箱和至少 6 位密码为必填' }, 400);
    }
    const { data: existed } = await service.from('profiles').select('id').eq('email', body.email).maybeSingle();
    if (existed) return json({ error: '该邮箱已被使用' }, 400);
    const { data: created, error } = await service.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { name: body.name ?? '' },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ user_id: created.user?.id });
  }

  if (body.action === 'reset-password') {
    if (!body.user_id || !body.password || body.password.length < 6) {
      return json({ error: '密码至少 6 位' }, 400);
    }
    const { error } = await service.auth.admin.updateUserById(body.user_id, { password: body.password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: '未知操作' }, 400);
});
