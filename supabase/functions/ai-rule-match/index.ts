import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AiModelConfig {
  enabled?: boolean;
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  temperature?: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  let body: {
    action?: "match" | "test";
    messages?: Array<{ role: string; content: string }>;
    config?: AiModelConfig;
    tenant_id?: string;
  };

  try {
    body = await req.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `请求体无效：${(err as Error).message}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let modelConfig = body.config;

  // 如果前端未直接传 config，则尝试从 sys_settings 查询租户配置
  if (!modelConfig || !modelConfig.api_key) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (supabaseUrl && supabaseServiceKey) {
      const client = createClient(supabaseUrl, supabaseServiceKey);
      let targetTenantId = body.tenant_id;

      // 若未指定 tenant_id，尝试从请求头中的 Authorization Token 反解用户及租户
      if (!targetTenantId) {
        const authHeader = req.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.replace("Bearer ", "").trim();
          try {
            const { data: uData } = await client.auth.getUser(token);
            if (uData?.user?.id) {
              const { data: pData } = await client
                .from("profiles")
                .select("tenant_id")
                .eq("id", uData.user.id)
                .maybeSingle();
              if (pData?.tenant_id) {
                targetTenantId = pData.tenant_id;
              }
            }
          } catch {
            // ignore
          }
        }
      }

      // 如果有明确的 tenantId，查询该租户的模型配置
      if (targetTenantId) {
        const { data, error } = await client
          .from("sys_settings")
          .select("ai_model_config")
          .eq("tenant_id", targetTenantId)
          .maybeSingle();
        if (!error && data?.ai_model_config && data.ai_model_config.api_key) {
          modelConfig = data.ai_model_config;
        }
      }

      // 如果依然没有找到，自动兜底寻找任何有效配置
      if (!modelConfig || !modelConfig.api_key) {
        const { data: list, error: listErr } = await client
          .from("sys_settings")
          .select("ai_model_config")
          .not("ai_model_config->api_key", "is", null)
          .limit(10);
        if (!listErr && list && list.length > 0) {
          const matched = list.find((item) => item.ai_model_config?.api_key?.trim());
          if (matched?.ai_model_config) {
            modelConfig = matched.ai_model_config;
          }
        }
      }
    }
  }

  // 连通性测试
  if (body.action === "test") {
    if (!modelConfig || !modelConfig.api_key || !modelConfig.base_url || !modelConfig.model) {
      return new Response(
        JSON.stringify({ error: "配置信息不完整，请提供 API Key、接口地址和模型名称" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    try {
      let targetUrl = modelConfig.base_url.trim().replace(/\/+$/, "");
      if (!targetUrl.endsWith("/chat/completions")) {
        targetUrl += "/chat/completions";
      }

      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${modelConfig.api_key.trim()}`,
        },
        body: JSON.stringify({
          model: modelConfig.model.trim(),
          messages: [{ role: "user", content: "请回复：pong" }],
          temperature: 0.1,
          max_tokens: 16,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = `服务商返回错误 (HTTP ${res.status})`;
        try {
          const errObj = JSON.parse(errText);
          if (errObj.error?.message) errMsg += `：${errObj.error.message}`;
          else if (errObj.message) errMsg += `：${errObj.message}`;
        } catch {
          if (errText) errMsg += `：${errText.slice(0, 200)}`;
        }
        return new Response(
          JSON.stringify({ error: errMsg }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const resJson = await res.json();
      const reply = resJson?.choices?.[0]?.message?.content || "pong";
      return new Response(
        JSON.stringify({ success: true, message: "连接成功", reply }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (testErr) {
      return new Response(
        JSON.stringify({ error: `连通性测试失败：${(testErr as Error).message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // 默认：AI 规则/内容匹配生成
  const messages = body.messages;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "缺少或非法的 messages 参数" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 若未配置有效大模型，给出明确错误提示
  if (!modelConfig || !modelConfig.api_key || !modelConfig.base_url || !modelConfig.model) {
    return new Response(
      JSON.stringify({
        error: "系统尚未配置 AI 模型或配置不完整。请进入「系统设置 -> 模型配置」配置国内大模型（通义千问、DeepSeek、智谱等）后使用。",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let targetUrl = modelConfig.base_url.trim().replace(/\/+$/, "");
  if (!targetUrl.endsWith("/chat/completions")) {
    targetUrl += "/chat/completions";
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${modelConfig.api_key.trim()}`,
      },
      body: JSON.stringify({
        model: modelConfig.model.trim(),
        messages,
        temperature: modelConfig.temperature ?? 0.2,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      let errMsg = `上游模型接口调用失败 (HTTP ${upstream.status})`;
      try {
        const errObj = JSON.parse(errText);
        if (errObj.error?.message) errMsg += `: ${errObj.error.message}`;
        else if (errObj.message) errMsg += `: ${errObj.message}`;
      } catch {
        if (errText) errMsg += `: ${errText.slice(0, 200)}`;
      }
      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (netErr) {
    return new Response(
      JSON.stringify({ error: `调用模型网络异常：${(netErr as Error).message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
