import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { PageField, SysSettings } from '@/types';
import { calcTotalDays, isPrevYearExpired, fmtDays } from '@/lib/annual-leave';
import { fmtDate } from '@/lib/field-catalog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, CalendarDays, Clock, CalendarClock } from 'lucide-react';
import PageLeaveList from './PageLeaveList';

interface UsedRow {
  created_at: string;
  status: string;
  payload: Record<string, unknown>;
}

interface Props {
  field: PageField;
}

/** 单页「我的年假信息」组件：展示当前登录账号的年假额度 + 请假信息列表 */
export default function PageLeaveInfoCard({ field }: Props) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const userId = profile?.id ?? '';

  const currentYear = new Date().getFullYear();
  // 最近 10 年，倒序排列
  const years = useMemo(() => Array.from({ length: 10 }, (_, i) => currentYear - i), [currentYear]);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SysSettings['annual_leave_rules']>([]);
  const [expire, setExpire] = useState('03-31');
  const [usedByYear, setUsedByYear] = useState<Map<number, number>>(new Map());

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

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">入职日期</span>
          <Badge variant="secondary" className="font-normal">{hireDate ? fmtDate(hireDate) : '未设置'}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">选择年份</span>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-[5px] border border-white bg-muted/60 p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="text-xs">本年度年假总数</span>
          </div>
          <p className="text-xl font-bold text-foreground">
            {fmtDays(total)}<span className="text-xs font-normal text-muted-foreground ml-1">天</span>
          </p>
        </div>
        <div className="rounded-[5px] border border-white bg-primary/5 p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs">本年度剩余年假</span>
          </div>
          <p className="text-xl font-bold text-primary">
            {fmtDays(remaining)}<span className="text-xs font-normal text-muted-foreground ml-1">天</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">已使用 {fmtDays(used)} 天</p>
        </div>
        <div className="rounded-[5px] border border-white bg-muted/60 p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs">上一年度剩余年假</span>
          </div>
          <p className="text-xl font-bold text-foreground">
            {fmtDays(prevRemaining)}<span className="text-xs font-normal text-muted-foreground ml-1">天</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {prevExpired ? '已过截止日期，自动失效' : `须在 ${expire.replace('-', '月')}日 前用完`}
          </p>
        </div>
      </div>

      <PageLeaveList field={field} year={selectedYear} />
    </div>
  );
}