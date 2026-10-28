import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { aiGenerateRule } from '@/lib/ai-rule';
import { toast } from 'sonner';

interface AiRuleMatcherProps {
  /** 字段上下文（字段列表、类型等），帮助大模型生成更准确的规则 */
  context: string;
  /** 生成结果回调，参数为大模型返回的文本 */
  onResult: (text: string) => void;
  /** 输入框占位提示 */
  placeholder?: string;
  /** 按钮文本 */
  label?: string;
  /** 输出模式：json 要求返回合法 JSON 对象；raw 直接返回纯文本（如正则表达式） */
  mode?: 'json' | 'raw';
}

/**
 * AI 匹配组件：用户输入自然语言提示词，点击后调用大模型生成对应的规则/正则/条件，
 * 通过 onResult 回调写回目标输入框。复用于所有需要规则、正则、条件 JSON 的输入项。
 */
export function AiRuleMatcher({ context, onResult, placeholder, label, mode = 'json' }: AiRuleMatcherProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!prompt.trim()) {
      toast.error('请先输入需求描述');
      return;
    }
    setLoading(true);
    try {
      const { text } = await aiGenerateRule(prompt.trim(), context, mode);
      onResult(text);
      toast.success('AI 已生成规则');
    } catch (err) {
      toast.error('AI 生成失败：' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="h-8 flex-1 min-w-0 text-xs"
        placeholder={placeholder ?? '描述规则，如：金额大于1000且状态为已审批'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            run();
          }
        }}
        disabled={loading}
      />
      <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0" onClick={run} disabled={loading}>
        {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
        {label ?? 'AI匹配'}
      </Button>
    </div>
  );
}