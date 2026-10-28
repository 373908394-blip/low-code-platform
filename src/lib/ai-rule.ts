import { supabase } from '@/db/supabase';
import type { AiModelConfig } from '@/types';

export interface AiRuleResult {
  /** 生成的条件 JSON 字符串（可直接填入规则/正则输入框） */
  text: string;
}

/** 缓存当前租户的 AI 模型配置，避免每次调用重复查库 */
let cachedModelConfig: { config: AiModelConfig | null; tenantId: string | null; time: number } | null = null;

async function getEffectiveAiConfig(): Promise<{ config: AiModelConfig | null; tenantId: string | null }> {
  const now = Date.now();
  if (cachedModelConfig && now - cachedModelConfig.time < 30000) {
    return { config: cachedModelConfig.config, tenantId: cachedModelConfig.tenantId };
  }

  try {
    const { data: authData } = await supabase.auth.getSession();
    const userId = authData?.session?.user?.id;
    let tenantId: string | null = null;

    if (userId) {
      const { data: pData } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', userId)
        .maybeSingle();
      if (pData?.tenant_id) {
        tenantId = pData.tenant_id;
      }
    }

    // 查询对应租户的模型配置
    if (tenantId) {
      const { data: sData } = await supabase
        .from('sys_settings')
        .select('ai_model_config')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (sData?.ai_model_config?.api_key) {
        cachedModelConfig = { config: sData.ai_model_config, tenantId, time: now };
        return { config: sData.ai_model_config, tenantId };
      }
    }

    // 兜底：如果当前租户未查到或未关联，查系统内任意已配置有效 api_key 的模型配置
    const { data: fallbackSettings } = await supabase
      .from('sys_settings')
      .select('tenant_id, ai_model_config')
      .not('ai_model_config->api_key', 'is', null)
      .limit(5);

    const valid = fallbackSettings?.find((s) => s.ai_model_config?.api_key?.trim());
    if (valid?.ai_model_config) {
      cachedModelConfig = { config: valid.ai_model_config, tenantId: valid.tenant_id, time: now };
      return { config: valid.ai_model_config, tenantId: valid.tenant_id };
    }
  } catch (err) {
    console.warn('获取 AI 模型配置异常:', err);
  }

  return { config: null, tenantId: null };
}

/**
 * 调用 AI 规则匹配：根据用户提示词与字段上下文，让大模型生成结构化规则/正则/条件。
 * 统一通过 Edge Function 代理并调用系统设置中配置的国内主流大模型。
 */
export async function aiGenerateRule(prompt: string, context: string, mode: 'json' | 'raw' = 'json'): Promise<AiRuleResult> {
  const system = [
    '你是低代码平台的规则配置助手。',
    '用户会给出自然语言需求，你需要根据字段上下文，生成可直接使用的规则配置。',
    mode === 'json'
      ? '严格只输出一个合法 JSON 对象，不要输出任何解释、注释、markdown 代码块标记或多余文字。JSON 必须能被 JSON.parse 成功解析。'
      : '严格只输出规则内容本身（如一个正则表达式字符串），不要输出任何解释、注释、markdown 代码块标记、引号包裹或多余文字。',
  ].join('');

  const user = `字段上下文：\n${context}\n\n用户需求：${prompt}`;

  // 优先获取有效配置与租户 ID
  const { config: effectiveConfig, tenantId } = await getEffectiveAiConfig();

  const { data, error } = await supabase.functions.invoke('ai-rule-match', {
    body: {
      action: 'match',
      config: effectiveConfig ?? undefined,
      tenant_id: tenantId ?? undefined,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    },
  });

  if (error) {
    let detail = error.message;
    try {
      const fErr = await error.context?.text?.();
      if (fErr) {
        try {
          const parsed = JSON.parse(fErr);
          if (parsed.error) detail = parsed.error;
        } catch {
          detail = fErr;
        }
      }
    } catch {
      // ignore
    }
    throw new Error(detail || 'AI 生成失败');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  const content = (data?.content as string) ?? '';
  if (!content.trim()) throw new Error('AI 未返回有效内容');
  return { text: stripCodeFence(content.trim()) };
}

/** 剥离大模型返回中可能携带的 markdown 代码块围栏（```json ... ``` 或 ``` ... ```） */
function stripCodeFence(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json|JSON)?\s*/;
  if (fence.test(s)) {
    s = s.replace(fence, '');
    s = s.replace(/```\s*$/, '');
  }
  return s.trim();
}
