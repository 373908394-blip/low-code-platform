import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { SysSettings } from '@/types';
import { fmtDate } from '@/lib/field-catalog';
import { calcTotalDays, isPrevYearExpired, fmtDays } from '@/lib/annual-leave';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CalendarDays, Info, Calculator, ChevronDown, ChevronRight, Clock } from 'lucide-react';

interface UsedRow {
  created_at: string;
  status: string;
  payload: Record<string, unknown>;
}

export default function MyLeave() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const userId = profile?.id ?? '';

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 10 }, (_, i) => currentYear - 9 + i), [currentYear]);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SysSettings['annual_leave_rules']>([]);
  const [expire, setExpire] = useState('03-31');
  const [usedByYear, setUsedByYear] = useState<Map<number, number>>(new Map());
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, formRes] = await Promise.all([
      supabase.from('sys_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('meta_forms').select('id').eq('code', 'leave_request').eq('tenant_id', tenantId).maybeSingle(),
    ]);
    const settings = sRes.data as SysSettings | null;
    setRules(settings?.annual_leave_rules ?? []);
    setExpire(settings?.annual_leave_expire ?? '03-31');

    const formId = (formRes.data as { id: string } | null)?.id;
    const usedMap = new Map<number, number>();
    if (formId && userId) {
      const { data } = await supabase
        .from('biz_data')
        .select('created_at, status, payload')
        .eq('form_id', formId)
        .eq('created_by', userId)
        .in('status', ['approved', 'xiaojia', 'xiaojiazhong']);
      (data ?? []).forEach((b) => {
        const row = b as UsedRow;
        const p = row.payload ?? {};
        if (p.leave_type === '年假') {
          const y = new Date(row.created_at).getFullYear();
          usedMap.set(y, (usedMap.get(y) ?? 0) + (Number(p.days) || 0));
        }
      });
    }
    setUsedByYear(usedMap);
    setLoading(false);
  }, [tenantId, userId]);

  useEffect(() => {
    if (tenantId) load();
  }, [tenantId, load]);

  const hireDate = profile?.hire_date ?? null;
  const total = calcTotalDays(rules, hireDate, selectedYear);
  const used = usedByYear.get(selectedYear) ?? 0;
  const remaining = Math.max(0, total - used);

  const prevTotal = calcTotalDays(rules, hireDate, selectedYear - 1);
  const prevUsed = usedByYear.get(selectedYear - 1) ?? 0;
  const prevExpired = selectedYear === currentYear && isPrevYearExpired(expire, currentYear);
  const prevRemaining = prevExpired ? 0 : Math.max(0, prevTotal - prevUsed);

  const history = years.map((y) => ({
    year: y,
    total: calcTotalDays(rules, hireDate, y),
    used: usedByYear.get(y) ?? 0,
  }));

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的年假</h1>
          <p className="text-sm text-muted-foreground mt-1">查看个人年假额度、使用明细与计算规则</p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">入职日期：</span>
          <Badge variant="secondary" className="font-normal">
            {hireDate ? fmtDate(hireDate) : '未设置'}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm text-muted-foreground">选择年份</span>
        <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
          <SelectTrigger className="w-32 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 额度卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="h-full bg-muted/60 border-white">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <CalendarDays className="h-4 w-4" />
              <span className="text-sm">本年度年假总数</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtDays(total)}<span className="text-base font-normal text-muted-foreground ml-1">天</span></p>
          </CardContent>
        </Card>
        <Card className="h-full bg-primary/5 border-white">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Clock className="h-4 w-4" />
              <span className="text-sm">本年度剩余年假</span>
            </div>
            <p className="text-3xl font-bold text-primary">{fmtDays(remaining)}<span className="text-base font-normal text-muted-foreground ml-1">天</span></p>
            <p className="text-xs text-muted-foreground mt-1">已使用 {fmtDays(used)} 天</p>
          </CardContent>
        </Card>
        <Card className="h-full bg-muted/60 border-white">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Clock className="h-4 w-4" />
              <span className="text-sm">上一年度剩余年假</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{fmtDays(prevRemaining)}<span className="text-base font-normal text-muted-foreground ml-1">天</span></p>
            <p className="text-xs text-muted-foreground mt-1">
              {prevExpired ? '已过截止日期，自动失效' : `须在 ${expire.replace('-', '月')}日 前用完`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 最近 10 年历史 */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <Button variant="ghost" className="w-full justify-between p-0 h-auto" onClick={() => setShowHistory((s) => !s)}>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              最近 10 年年假天数
            </CardTitle>
            {showHistory ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </Button>
        </CardHeader>
        {showHistory && (
          <CardContent>
            <div className="w-full max-w-full overflow-x-auto bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 text-left whitespace-nowrap font-medium">年份</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap font-medium">年假总数</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap font-medium">已使用</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap font-medium">剩余</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((h) => (
                    <tr key={h.year} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap text-foreground">{h.year} 年</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-foreground">{fmtDays(h.total)} 天</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-muted-foreground">{fmtDays(h.used)} 天</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-primary">{fmtDays(Math.max(0, h.total - h.used))} 天</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 年假说明 */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            年假说明
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2 leading-relaxed">
          <p>上一年度剩余的年假请 <span className="text-foreground font-medium">{expire.replace('-', '月')}日</span> 前用完，逾期自动失效。</p>
          <div className="rounded-md bg-muted/50 border border-border p-3 space-y-1.5">
            <p className="text-foreground font-medium text-xs">温馨提示</p>
            <p>1、当年有休长期病假天数累计超过 15 天或休事假累计超过 10 天的员工将不再享受年假。</p>
            <p>2、女职工休产假的当年不享受带薪年假。</p>
          </div>
        </CardContent>
      </Card>

      {/* 年假计算规则 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            年假计算规则
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3 leading-relaxed">
          <p>新入职员工符合享受年假条件（连续工作满 12 个月以上）的，当年度年假天数按在本单位剩余日历天数折算：</p>
          <div className="rounded-md bg-muted/50 border border-border p-3">
            <p className="font-mono text-foreground text-sm">折算公式：（当年度在本单位剩余日历天数 ÷ 365 天）× 员工本人全年应当享受的年假天数</p>
            <p className="mt-1.5">折算后不足 1 整天的部分不享受年休假（向下取整）。</p>
          </div>
          <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
            <p className="text-foreground font-medium text-xs mb-1">计算示例</p>
            <p>于 2026 年 7 月 1 日入职，当年度在本单位剩余日历天数为 184 天，则当年度年假天数为：</p>
            <p className="font-mono text-foreground mt-1">184 ÷ 365 × 5 ≈ 2.52 天，折算后取整为 2 天。</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}