import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/db/supabase';
import type { FormField, MetaForm, BizData } from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, FileInput, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateRangeFilter } from '@/components/biz/DateRangeFilter';
import { SingleSearchSelect } from '@/components/biz/SearchSelects';
import { AddressPicker, formatAddress, type AddressValue } from '@/components/biz/AddressPicker';
import { SYSTEM_FIELD_KEYS, systemFieldValue, isAuditSystemField, fmtDate, type SysProfile, buildCreatorScope, type ScopeContext } from '@/lib/field-catalog';
import type { Department } from '@/types';

export interface FormAssignmentInputProps {
  field: FormField;
  value?: unknown;
  onChange: (val: string) => void;
  /** 当选中某条数据后，通知外部批量回填当前表单的其他字段 */
  onAssign?: (assignedValues: Record<string, unknown>) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  currentFormId?: string;
  /** 数据范围上下文：由父组件提供；未提供时组件内部兜底（跟随权限≈全部） */
  scopeCtx?: ScopeContext;
}

export function FormAssignmentInput({
  field,
  value,
  onChange,
  onAssign,
  disabled,
  placeholder,
  className,
  currentFormId,
  scopeCtx,
}: FormAssignmentInputProps) {
  const cfg = field.assignment;
  const targetFormId = cfg?.formId || currentFormId || '';
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [targetForm, setTargetForm] = useState<MetaForm | null>(null);
  const [records, setRecords] = useState<BizData[]>([]);
  const [searchParams, setSearchParams] = useState<Record<string, unknown>>({});
  const [deptMap, setDeptMap] = useState<Map<string, string>>(new Map());
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());
  const [profileMap, setProfileMap] = useState<Map<string, SysProfile>>(new Map());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  // 加载关联表单定义
  useEffect(() => {
    if (!targetFormId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('meta_forms').select('*').eq('id', targetFormId).maybeSingle();
      if (!cancelled && data) {
        setTargetForm(data as MetaForm);
      }
    })();
    return () => { cancelled = true; };
  }, [targetFormId]);

  const targetFields: FormField[] = useMemo(() => {
    const raw = (targetForm?.schema_json as { fields?: FormField[] } | null)?.fields;
    return Array.isArray(raw) ? raw : [];
  }, [targetForm]);

  // 当前表单字段定义（用于映射回填时按目标字段类型转换值；目标即当前表单时直接复用 targetFields）
  const [currentFormFields, setCurrentFormFields] = useState<FormField[]>([]);
  useEffect(() => {
    if (!currentFormId) { setCurrentFormFields([]); return; }
    if (currentFormId === targetFormId) { setCurrentFormFields(targetFields); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('meta_forms').select('*').eq('id', currentFormId).maybeSingle();
      if (!cancelled && data) {
        const raw = ((data as MetaForm).schema_json as { fields?: FormField[] } | null)?.fields;
        setCurrentFormFields(Array.isArray(raw) ? raw : []);
      }
    })();
    return () => { cancelled = true; };
  }, [currentFormId, targetFormId, targetFields]);

  // 弹窗打开时加载部门与人员（用于 dept-select / user-select 字段解析、系统审计字段取值、数据范围过滤）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? '';
      if (!cancelled) setCurrentUserId(uid);
      const [d, p] = await Promise.all([
        supabase.from('departments').select('id, name, parent_id'),
        supabase.from('profiles').select('id, name, department_id, position'),
      ]);
      if (cancelled) return;
      if (d.data) {
        const dList = d.data as Department[];
        setDepartments(dList);
        setDeptMap(new Map(dList.map((x) => [x.id, x.name])));
      }
      if (p.data) {
        const pList = p.data as { id: string; name: string; department_id?: string | null; position?: string | null }[];
        setUserMap(new Map(pList.map((x) => [x.id, x.name])));
        setProfileMap(new Map(pList.map((x) => [x.id, { name: x.name, department_id: x.department_id, position: x.position }])));
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // 数据范围上下文：优先使用父组件传入（合并本字段 dataRange）；未传入时使用内部加载的当前用户与部门列表兜底
  const effectiveScopeCtx: ScopeContext | undefined = useMemo(() => {
    if (scopeCtx) return { ...scopeCtx, dataRange: cfg?.dataRange ?? 'all' };
    if (!currentUserId || departments.length === 0) return undefined;
    const me = profileMap.get(currentUserId);
    return {
      dataRange: cfg?.dataRange ?? 'all',
      profile: { id: currentUserId, department_id: me?.department_id ?? null },
      departments,
      profiles: Array.from(profileMap.entries()).map(([id, p]) => ({ id, department_id: p.department_id ?? null })),
    };
  }, [scopeCtx, cfg?.dataRange, currentUserId, departments, profileMap]);

  // 根据数据范围计算允许的创建人集合；null 表示不限制
  const allowedCreators = useMemo<string[] | null>(() => {
    if (!effectiveScopeCtx) return null;
    return buildCreatorScope(effectiveScopeCtx);
  }, [effectiveScopeCtx]);

  // 按数据范围过滤后的候选记录
  const scopedRecords = useMemo(() => {
    if (!allowedCreators) return records;
    const set = new Set(allowedCreators);
    return records.filter((r) => set.has(r.created_by ?? ''));
  }, [records, allowedCreators]);

  /** 提取记录字段值：优先取 payload，若为空且属于系统审计字段（user_name/dept_name 等）则从单据行派生 */
  const getRecordVal = (f: FormField | undefined, key: string, r: BizData): unknown => {
    const payload = (r.payload as Record<string, unknown>) ?? {};
    let v = payload[key];
    if (v === undefined || v === null || v === '') {
      const isAudit = (f && isAuditSystemField(f)) || (SYSTEM_FIELD_KEYS as readonly string[]).includes(key as (typeof SYSTEM_FIELD_KEYS)[number]);
      if (isAudit) {
        v = systemFieldValue(key, r, { profileMap, deptMap });
      } else {
        v = r[key as keyof BizData];
      }
    }
    return v;
  };

  /** id → 名称解析（部门/人员字段），其余原样返回 */
  const resolveName = (f: FormField | undefined, raw: string): string => {
    if (f?.type === 'dept-select') return deptMap.get(raw) ?? raw;
    if (f?.type === 'user-select') return userMap.get(raw) ?? raw;
    return raw;
  };

  /** 值 → 展示文本：地址格式化、部门/人员解析名称、日期格式化、数组拼接（元素对象安全格式化） */
  const cellText = (f: FormField | undefined, v: unknown): string => {
    if (v === undefined || v === null || v === '') return '';
    if (f?.type === 'address') return formatAddress(v);
    if ((f?.key === 'created_at' || f?.key === 'updated_at') && typeof v === 'string') return fmtDate(v, true);
    if ((f?.type === 'datetime' || f?.type === 'date') && typeof v === 'string') return fmtDate(v, f.type === 'datetime');
    const toText = (x: unknown): string => (x && typeof x === 'object' ? formatAddress(x) : resolveName(f, String(x)));
    if (Array.isArray(v)) return v.map(toText).filter(Boolean).join('、');
    if (typeof v === 'object' && v !== null) return formatAddress(v);
    return resolveName(f, String(v));
  };

  // 打开弹窗时拉取数据
  useEffect(() => {
    if (!open || !targetFormId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('biz_data')
        .select('*')
        .eq('form_id', targetFormId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!cancelled) {
        setLoading(false);
        if (!error && data) {
          setRecords(data as BizData[]);
        } else {
          setRecords([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, targetFormId]);

  // 搜索过滤字段
  const searchFields = useMemo(() => {
    const keys = cfg?.searchFieldKeys ?? [];
    if (keys.length === 0) {
      // 默认提供前 3 个非布局字段供搜索
      return targetFields.filter((f) => !['group-title', 'wizard-step', 'grid', 'divider', 'description', 'action-button'].includes(f.type)).slice(0, 3);
    }
    return targetFields.filter((f) => keys.includes(f.key));
  }, [cfg?.searchFieldKeys, targetFields]);

  // 表格展示列：优先取配置的「选择框列表显示字段」（按勾选顺序），兜底显示字段+搜索字段并集，再兜底前 5 个字段
  const tableColumns = useMemo(() => {
    const listKeys = cfg?.listFieldKeys ?? [];
    if (listKeys.length > 0) {
      const matched = listKeys.map((k) => targetFields.find((f) => f.key === k)).filter(Boolean) as FormField[];
      if (matched.length > 0) return matched;
    }
    const displayKeys = cfg?.displayFieldKeys ?? [];
    const searchKeys = cfg?.searchFieldKeys ?? [];
    const unionKeys = Array.from(new Set([...displayKeys, ...searchKeys]));
    const matched = targetFields.filter((f) => unionKeys.includes(f.key));
    if (matched.length > 0) return matched;
    return targetFields.filter((f) => !['group-title', 'wizard-step', 'grid', 'divider', 'description', 'action-button'].includes(f.type)).slice(0, 5);
  }, [cfg?.listFieldKeys, cfg?.displayFieldKeys, cfg?.searchFieldKeys, targetFields]);

  // 搜索字段控件类型（旧配置未指定时默认输入框）
  const ctrlOf = (key: string): 'input' | 'date-range' | 'select' | 'cascader' => (cfg?.searchControls ?? {})[key] ?? 'input';

  // 下拉选择控件选项：目标字段已有数据去重（数组值展开）；部门/人员字段显示名称、以原值匹配过滤
  const selectOptionsOf = (key: string) => {
    const fdef = targetFields.find((f) => f.key === key);
    const set = new Set<string>();
    for (const r of scopedRecords) {
      const v = getRecordVal(fdef, key, r);
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) {
        v.forEach((x) => { if (x !== null && x !== undefined && x !== '') set.add(String(x)); });
      } else if (typeof v !== 'object') {
        set.add(String(v));
      }
    }
    return Array.from(set)
      .map((s) => ({ id: s, label: resolveName(fdef, s) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  // 过滤后的数据记录（按搜索字段控件类型分语义过滤）
  const filteredRecords = useMemo(() => {
    const controls = cfg?.searchControls ?? {};
    return scopedRecords.filter((r) => {
      for (const [k, searchVal] of Object.entries(searchParams)) {
        if (searchVal === undefined || searchVal === null || searchVal === '') continue;
        const ctrl = controls[k] ?? 'input';
        const fdef = targetFields.find((f) => f.key === k);
        const targetVal = getRecordVal(fdef, k, r);
        if (ctrl === 'date-range') {
          // 日期区间过滤（值协议：起始~结束）
          const [from, to] = String(searchVal).split('~').map((s) => s.trim());
          if (!from && !to) continue;
          const s = String(targetVal ?? '').slice(0, 10);
          if (!s) return false;
          if (from && s < from) return false;
          if (to && s > to) return false;
        } else if (ctrl === 'select') {
          // 下拉单选精确匹配（数组值按包含匹配）
          if (Array.isArray(targetVal)) {
            if (!targetVal.some((x) => String(x) === String(searchVal))) return false;
          } else if (String(targetVal ?? '') !== String(searchVal)) return false;
        } else if (ctrl === 'cascader') {
          // 级联（省/市/区县）：按已选的最具体层级精确匹配
          const av = searchVal as AddressValue;
          if (!av || typeof av !== 'object' || !av.province) continue;
          if (!targetVal || typeof targetVal !== 'object') return false;
          const tv = targetVal as { province?: string; city?: string; district?: string };
          if (String(tv.province ?? '') !== String(av.province)) return false;
          if (av.city && String(tv.city ?? '') !== String(av.city)) return false;
          if (av.district && String(tv.district ?? '') !== String(av.district)) return false;
        } else {
          // 输入框：文本模糊匹配（部门/人员按名称匹配、地址按格式化文本匹配，数组值按名称包含）
          const fdef = targetFields.find((f) => f.key === k);
          const norm = (x: unknown): string => {
            if (x === null || x === undefined) return '';
            if (typeof x === 'object') return fdef?.type === 'address' ? formatAddress(x).toLowerCase() : '';
            return resolveName(fdef, String(x)).toLowerCase();
          };
          const targetStr = Array.isArray(targetVal) ? targetVal.map(norm).filter(Boolean).join('、') : norm(targetVal);
          if (!targetStr.includes(String(searchVal).trim().toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [scopedRecords, searchParams, cfg?.searchControls, targetFields, deptMap, userMap]);

  // 选择某条记录
  const handleSelect = (record: BizData) => {
    // 1. 仅持久化存储选中记录的引用 id（显示信息不作为表字段存储，由回显逻辑实时拼接）
    onChange(record.id);

    // 2. 字段映射回填（对象值按目标字段类型安全转换：地址对象回填到非地址字段时格式化为省市区文本）
    if (onAssign && cfg?.mappings && cfg.mappings.length > 0) {
      const assigned: Record<string, unknown> = {};
      for (const m of cfg.mappings) {
        if (!m.sourceFieldKey || !m.targetFieldKey) continue;
        const srcVal = getRecordVal(targetFields.find((fld) => fld.key === m.sourceFieldKey), m.sourceFieldKey, record);
        if (srcVal !== null && srcVal !== undefined && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
          const tgtType = currentFormFields.find((f) => f.key === m.targetFieldKey)?.type;
          assigned[m.targetFieldKey] = tgtType === 'address' ? srcVal : (formatAddress(srcVal) || null);
        } else {
          assigned[m.targetFieldKey] = srcVal ?? null;
        }
      }
      onAssign(assigned);
    }

    setOpen(false);
  };

  const strValue = value !== undefined && value !== null ? String(value) : '';

  // 回显：根据存储的记录 id 实时查询目标表单，按「显示信息」配置拼接显示文本（记录被删时提示已不存在）
  const [displayText, setDisplayText] = useState('');
  const displayKeysKey = (cfg?.displayFieldKeys ?? []).join(',');
  useEffect(() => {
    if (!targetFormId) return;
    // 存量数据兼容：历史版本存储的是拼接文本（非 uuid）时直接原样展示
    const isIdLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strValue);
    if (!isIdLike) { setDisplayText(strValue); return; }
    let cancelled = false;
    setDisplayText('');
    void supabase.from('biz_data').select('*').eq('id', strValue).eq('form_id', targetFormId).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      const rec = data as BizData | null;
      if (!rec) { setDisplayText('关联记录已不存在'); return; }
      const sep = cfg?.displaySeparator ?? ' ';
      const displayKeys = displayKeysKey ? displayKeysKey.split(',') : [];
      let text = '';
      if (displayKeys.length > 0) {
        text = displayKeys
          .map((k) => {
            const f = targetFields.find((fld) => fld.key === k);
            return cellText(f, getRecordVal(f, k, rec));
          })
          .filter(Boolean)
          .join(sep);
      } else {
        const firstCol = tableColumns[0];
        text = firstCol ? cellText(firstCol, getRecordVal(firstCol, firstCol.key, rec)) : '';
      }
      setDisplayText(text);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strValue, targetFormId, displayKeysKey, cfg?.displaySeparator]);

  return (
    <>
      <div className={cn('relative flex items-center w-full', className)}>
        <Input
          readOnly
          value={displayText || strValue}
          placeholder={placeholder || '点击右侧图标选择关联数据'}
          className="pr-9 bg-background cursor-pointer text-sm"
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="absolute right-0 h-9 w-9 text-muted-foreground hover:text-foreground"
          title="选择关联表单数据"
        >
          <FileInput className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl max-h-[90dvh] flex flex-col p-4 md:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <FileInput className="h-4 w-4 text-primary" />
              选择{targetForm?.name || '关联表单'}数据
            </DialogTitle>
          </DialogHeader>

          {/* 搜索条件区（按设计态配置的控件类型渲染） */}
          {searchFields.length > 0 && (
            <div className="flex flex-wrap gap-2 py-2 border-b border-border items-center">
              {searchFields.map((sf) => {
                const ctrl = ctrlOf(sf.key);
                return (
                  <div key={sf.key} className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground shrink-0">{sf.label}:</span>
                    {ctrl === 'date-range' ? (
                      <DateRangeFilter
                        size="default"
                        className="w-56"
                        value={String(searchParams[sf.key] ?? '')}
                        onChange={(v) => setSearchParams((prev) => ({ ...prev, [sf.key]: v }))}
                      />
                    ) : ctrl === 'select' ? (
                      <SingleSearchSelect
                        className="h-8 w-36 text-xs"
                        placeholder={`选择${sf.label}`}
                        options={selectOptionsOf(sf.key)}
                        value={String(searchParams[sf.key] ?? '')}
                        onChange={(v) => setSearchParams((prev) => ({ ...prev, [sf.key]: v || '' }))}
                      />
                    ) : ctrl === 'cascader' ? (
                      <AddressPicker
                        className="h-8 w-44 text-xs"
                        placeholder="选择省 / 市 / 区县"
                        value={searchParams[sf.key]}
                        onChange={(v) => setSearchParams((prev) => ({ ...prev, [sf.key]: v ?? '' }))}
                      />
                    ) : (
                      <div className="relative">
                        <Input
                          className="h-8 w-36 text-xs pr-6"
                          placeholder={`搜索${sf.label}`}
                          value={String(searchParams[sf.key] ?? '')}
                          onChange={(e) => setSearchParams((prev) => ({ ...prev, [sf.key]: e.target.value }))}
                        />
                        {searchParams[sf.key] ? (
                          <button
                            type="button"
                            onClick={() => setSearchParams((prev) => ({ ...prev, [sf.key]: '' }))}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs ml-auto"
                onClick={() => setSearchParams({})}
              >
                重置
              </Button>
            </div>
          )}

          {/* 数据列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto border rounded-md mt-2">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                正在加载数据…
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                暂无匹配的数据记录
              </div>
            ) : (
              <Table className="[&>div]:max-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center whitespace-nowrap">#</TableHead>
                    {tableColumns.map((col) => (
                      <TableHead key={col.key} className="whitespace-nowrap">{col.label}</TableHead>
                    ))}
                    <TableHead className="w-20 text-right whitespace-nowrap">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map((r, idx) => {
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSelect(r)}
                      >
                        <TableCell className="text-center text-xs text-muted-foreground whitespace-nowrap">
                          {idx + 1}
                        </TableCell>
                        {tableColumns.map((col) => {
                          const val = getRecordVal(col, col.key, r);
                          return (
                            <TableCell key={col.key} className="text-xs whitespace-nowrap">
                              {cellText(col, val) || '—'}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-primary hover:bg-primary/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelect(r);
                            }}
                          >
                            选择
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <span>共 {filteredRecords.length} 条记录</span>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
