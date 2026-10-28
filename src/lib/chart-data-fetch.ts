import { supabase } from '@/db/supabase';
import type { BizData, MetaForm, Department, Profile } from '@/types';

// 仅选取图表渲染与聚合所需列，避免 select('*') 拉取冗余字段放大单次响应体积
const BIZ_COLUMNS =
  'id,tenant_id,form_id,status,title,amount,created_by,created_at,updated_at,updated_by,assignee_id,assignee_name,payload,meta_version';

// 全局并发限流：仪表单含多个图表时会并发发起大量请求，需限制同时进行数以规避 Supabase 429 限流
const MAX_CONCURRENCY = 4;
let active = 0;
const queue: Array<() => void> = [];

function take(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

// 进行中的同 key 请求去重：同一数据源/同一表单的并发请求合并为一次，降低请求数与重复拉取
async function dedupe<T>(key: string, fn: () => Promise<T>, cache: Map<string, Promise<T>>): Promise<T> {
  const inflight = cache.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    await take();
    try {
      return await fn();
    } finally {
      release();
      cache.delete(key);
    }
  })();
  cache.set(key, p);
  return p;
}

const bizCache = new Map<string, Promise<BizData[]>>();
const metaCache = new Map<string, Promise<MetaForm | null>>();
const smCache = new Map<string, Promise<{ key: string; label: string }[]>>();
const deptCache = new Map<string, Promise<Department[]>>();
const profCache = new Map<string, Promise<Pick<Profile, 'id' | 'department_id'>[]>>();

/** 按 formId 拉取业务数据（按创建人范围过滤，限流+去重） */
export function fetchBizRows(formId: string, creatorIds: string[] | null): Promise<BizData[]> {
  const creatorKey = creatorIds && creatorIds.length > 0 ? creatorIds.join(',') : 'all';
  return dedupe(`${formId}#${creatorKey}`, async () => {
    let q = supabase
      .from('biz_data')
      .select(BIZ_COLUMNS)
      .eq('form_id', formId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(500);
    if (creatorIds && creatorIds.length > 0) {
      q = q.in('created_by', creatorIds);
    } else if (creatorIds) {
      // creatorIds 非空数组为空：无可见数据
      return [];
    }
    const { data } = await q;
    return (data as BizData[]) ?? [];
  }, bizCache);
}

/** 按 formId 拉取表单元数据（限流+去重） */
export function fetchMetaForm(formId: string): Promise<MetaForm | null> {
  return dedupe(`meta#${formId}`, async () => {
    const { data } = await supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle();
    return (data as MetaForm) ?? null;
  }, metaCache);
}

/** 按 formId 拉取状态机状态映射（限流+去重） */
export function fetchStateMachine(formId: string): Promise<{ key: string; label: string }[]> {
  return dedupe(`sm#${formId}`, async () => {
    const { data } = await supabase.from('meta_state_machine').select('states').eq('form_id', formId).maybeSingle();
    return ((data as { states?: { key: string; label: string }[] })?.states ?? []) as { key: string; label: string }[];
  }, smCache);
}

/** 按租户拉取部门（限流+去重，多图表共享） */
export function fetchDepartments(tenantId: string): Promise<Department[]> {
  return dedupe(`dept#${tenantId}`, async () => {
    const { data } = await supabase.from('departments').select('*').eq('tenant_id', tenantId);
    return (data as Department[]) ?? [];
  }, deptCache);
}

/** 按租户拉取人员（限流+去重，多图表共享） */
export function fetchProfiles(tenantId: string): Promise<Pick<Profile, 'id' | 'department_id'>[]> {
  return dedupe(`prof#${tenantId}`, async () => {
    const { data } = await supabase.from('profiles').select('id, department_id').eq('tenant_id', tenantId);
    return (data as Pick<Profile, 'id' | 'department_id'>[]) ?? [];
  }, profCache);
}