import { pinyin } from 'pinyin-pro';

/**
 * 名称 → API 标识（slug）：
 * - 中文转全拼小写（多音字智能匹配），每个字/词以下划线连接，如「已提交」→ yi_ti_jiao
 * - 英文与数字统一小写，空格及连接符替换为下划线，如「Purchase Order」→ purchase_order
 * - 中英混合分段连接，如「订单order」→ ding_dan_order
 * - 过滤特殊符号，无法生成有效标识时返回空串
 */
export function slugFromName(name: string): string {
  const src = (name ?? '').trim();
  if (!src) return '';
  // nonZh: 'consecutive' 使连续非中文段作为整体保留（如 order、2024）
  const arr = pinyin(src, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
  const parts = arr
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
  return parts.join('_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * 标识自动联动：名称变更时计算下一个标识。
 * - 当前标识为空、等于旧名称的自动生成值、或匹配系统默认标识模式（如 field_1 / page_2）→ 返回新名称的自动标识
 * - 标识已被人工修改 → 返回 null，调用方保持原标识不动
 */
export function nextAutoSlug(name: string, prevName: string, currentSlug: string, defaultPattern?: RegExp): string | null {
  if (currentSlug === '' || currentSlug === slugFromName(prevName) || (defaultPattern?.test(currentSlug) ?? false)) {
    return slugFromName(name);
  }
  return null;
}
