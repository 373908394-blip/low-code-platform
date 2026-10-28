import type { AnnualLeaveRule } from '@/types';

/** 根据工龄查找适用的年假规则对应天数 */
export function findRuleDays(rules: AnnualLeaveRule[], serviceYears: number): number {
  const rule = rules.find((r) => serviceYears >= r.min_years && serviceYears < r.max_years);
  return rule?.days ?? 0;
}

/** 计算某年度的年假总额（含新员工当年折算，向下取整） */
export function calcTotalDays(rules: AnnualLeaveRule[], hireDate: string | null, year: number): number {
  if (!hireDate) return 0;
  const hire = new Date(`${hireDate}T00:00:00`);
  const hireYear = hire.getFullYear();
  if (year < hireYear) return 0;
  const serviceYears = year - hireYear;
  const fullDays = findRuleDays(rules, serviceYears);
  if (fullDays <= 0) return 0;
  if (year === hireYear) {
    // 新员工当年按在本单位剩余日历天数折算
    const end = new Date(year, 11, 31);
    const remainingDays = Math.floor((end.getTime() - hire.getTime()) / 86400000) + 1;
    if (remainingDays <= 0) return 0;
    return Math.floor((remainingDays / 365) * fullDays);
  }
  return fullDays;
}

/** 判断上一年度剩余年假是否已过期（当年超过设定截止日期则失效） */
export function isPrevYearExpired(expire: string, currentYear: number, now: Date = new Date()): boolean {
  const parts = (expire || '03-31').split('-').map((p) => Number(p));
  const month = Number.isFinite(parts[0]) ? parts[0] : 3;
  const day = Number.isFinite(parts[1]) ? parts[1] : 31;
  const expireDate = new Date(currentYear, month - 1, day, 23, 59, 59);
  return now.getTime() > expireDate.getTime();
}

/** 格式化天数：整数值显示整数，否则保留一位小数 */
export function fmtDays(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}