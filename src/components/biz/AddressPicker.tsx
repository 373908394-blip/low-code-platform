import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapPin, ChevronRight, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 行政区划行 */
interface RegionRow {
  code: string;
  name: string;
  level: number;
  parent_code: string | null;
}

/** 地址组件取值：三级行政区划名称（省/市/区县） */
export interface AddressValue {
  province: string;
  city: string;
  district: string;
}

/** 全局缓存：行政区划数据（省级全量 + 当前已加载省市县），避免每个地址组件重复拉取 */
let regionCache: RegionRow[] | null = null;
let regionLoading: PromiseLike<RegionRow[]> | null = null;

/** 拉取全部行政区划数据（3862 条，全局缓存一次） */
export function loadRegions(): Promise<RegionRow[]> {
  if (regionCache) return Promise.resolve(regionCache);
  if (regionLoading) return Promise.resolve(regionLoading);
  regionLoading = supabase
    .from('china_regions')
    .select('code, name, level, parent_code')
    .order('code')
    .then(({ data }) => {
      const rows = (data as RegionRow[]) ?? [];
      if (rows.length > 0) regionCache = rows;
      return rows;
    });
  return Promise.resolve(regionLoading);
}

/** 解析地址值为 { province, city, district }，兼容旧值（可能为字符串） */
export function parseAddressValue(value: unknown): AddressValue {
  if (value && typeof value === 'object') {
    const v = value as Partial<AddressValue>;
    return { province: v.province ?? '', city: v.city ?? '', district: v.district ?? '' };
  }
  return { province: '', city: '', district: '' };
}

/** 地址显示文本：省 / 市 / 区县 以空格连接 */
export function formatAddress(value: unknown): string {
  const v = parseAddressValue(value);
  return [v.province, v.city, v.district].filter(Boolean).join(' ');
}

/**
 * 带搜索的三级行政区划级联选择组件（省 → 市 → 区/县）。
 * - 点击触发器弹出级联面板，依次选择三级
 * - 搜索框支持按名称/拼音首字母无关的关键字过滤全部区划（输入后列出 省/市/区 匹配项，选中后自动回填三级）
 * - value 为 { province, city, district } 对象
 */
export function AddressPicker({
  value,
  onChange,
  disabled,
  placeholder,
  className,
}: {
  value: unknown;
  onChange: (v: AddressValue | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [search, setSearch] = useState('');
  const [activeLevel, setActiveLevel] = useState(1);
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const cur = parseAddressValue(value);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadRegions().then((rows) => {
      if (!cancelled) setRegions(rows);
    });
    return () => { cancelled = true; };
  }, [open]);

  // 打开时以当前值初始化待选状态
  useEffect(() => {
    if (open) {
      setProvince(cur.province);
      setCity(cur.city);
      setActiveLevel(1);
      setSearch('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const provinces = useMemo(() => regions.filter((r) => r.level === 1), [regions]);
  const cities = useMemo(() => (province ? regions.filter((r) => r.level === 2 && r.parent_code === provinceCodeOf(regions, province)) : []), [regions, province]);
  const districts = useMemo(() => (city ? regions.filter((r) => r.level === 3 && r.parent_code === cityCodeOf(regions, province, city)) : []), [regions, province, city]);

  // 搜索：跨级匹配（省/市/区名称包含关键字）
  const searchResults = useMemo(() => {
    const kw = search.trim();
    if (!kw) return [];
    return regions.filter((r) => r.name.includes(kw)).slice(0, 30);
  }, [regions, search]);

  const pickProvince = (name: string) => {
    setProvince(name);
    setCity('');
    setActiveLevel(2);
  };
  const pickCity = (name: string) => {
    setCity(name);
    setActiveLevel(3);
  };
  const pickDistrict = (name: string) => {
    onChange({ province, city, district: name });
    setOpen(false);
  };

  // 搜索结果选中：回填三级（若匹配项本身是省或市，则填充到该级并清空下级）
  const pickSearch = (row: RegionRow) => {
    if (row.level === 1) {
      onChange({ province: row.name, city: '', district: '' });
    } else if (row.level === 2) {
      const p = regions.find((r) => r.code === row.parent_code);
      onChange({ province: p?.name ?? '', city: row.name, district: '' });
    } else {
      const c = regions.find((r) => r.code === row.parent_code);
      const p = c ? regions.find((r) => r.code === c.parent_code) : undefined;
      onChange({ province: p?.name ?? '', city: c?.name ?? '', district: row.name });
    }
    setOpen(false);
  };

  const display = formatAddress(value);
  const hasValue = !!display;

  return (
    <Popover open={open} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full h-9 justify-between font-normal px-3 py-2', hasValue ? 'text-foreground' : 'text-muted-foreground', className)}
        >
          <span className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{display || placeholder || '请选择省 / 市 / 区县'}</span>
          </span>
          {hasValue && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="清空地址"
              className="shrink-0 rounded-sm opacity-60 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(null); } }}
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <ChevronRight className={cn('h-4 w-4 shrink-0 opacity-50 transition-transform', open && 'rotate-90')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 bg-popover text-popover-foreground" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索省 / 市 / 区县名称"
            className="h-7 border-0 shadow-none focus-visible:ring-0 px-0"
          />
        </div>
        {search.trim() ? (
          <ScrollArea className="h-64">
            <div className="p-1">
              {searchResults.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">未找到匹配的行政区划</p>}
              {searchResults.map((r) => {
                const path = namePathOf(regions, r);
                return (
                  <button
                    key={r.code}
                    type="button"
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    onClick={() => pickSearch(r)}
                  >
                    <span className="min-w-0 truncate">{r.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{path}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs">
              {(['省', '市', '区/县'] as const).map((lbl, i) => {
                const lvl = i + 1;
                const name = lvl === 1 ? province : lvl === 2 ? city : cur.district;
                return (
                  <button
                    key={lbl}
                    type="button"
                    disabled={lvl > activeLevel}
                    className={cn(
                      'flex-1 rounded px-2 py-1 text-center truncate transition-colors',
                      lvl === activeLevel ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      lvl > activeLevel && 'cursor-not-allowed opacity-40',
                    )}
                    onClick={() => setActiveLevel(lvl)}
                  >
                    {name || `选择${lbl}`}
                  </button>
                );
              })}
            </div>
            <ScrollArea className="h-64">
              <div className="p-1">
                {activeLevel === 1 && provinces.map((r) => (
                  <button key={r.code} type="button" className={cn('flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground', province === r.name && 'bg-primary/15 text-primary font-medium')} onClick={() => pickProvince(r.name)}>
                    <span className="flex-1 truncate">{r.name}</span>
                    {province === r.name && <ChevronRight className="h-4 w-4 text-primary" />}
                  </button>
                ))}
                {activeLevel === 2 && cities.map((r) => (
                  <button key={r.code} type="button" className={cn('flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground', city === r.name && 'bg-primary/15 text-primary font-medium')} onClick={() => pickCity(r.name)}>
                    <span className="flex-1 truncate">{r.name}</span>
                    {city === r.name && <ChevronRight className="h-4 w-4 text-primary" />}
                  </button>
                ))}
                {activeLevel === 3 && districts.map((r) => (
                  <button key={r.code} type="button" className={cn('flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground', cur.district === r.name && 'bg-primary/15 text-primary font-medium')} onClick={() => pickDistrict(r.name)}>
                    <span className="flex-1 truncate">{r.name}</span>
                    {cur.district === r.name && <ChevronRight className="h-4 w-4 text-primary" />}
                  </button>
                ))}
                {activeLevel === 2 && cities.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">该省暂无市级数据</p>}
                {activeLevel === 3 && districts.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">该市暂无区县数据</p>}
              </div>
            </ScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 按名称查省级 code */
function provinceCodeOf(regions: RegionRow[], name: string): string | null {
  return regions.find((r) => r.level === 1 && r.name === name)?.code ?? null;
}

/** 按省市名称查市级 code */
function cityCodeOf(regions: RegionRow[], province: string, city: string): string | null {
  const pc = provinceCodeOf(regions, province);
  if (!pc) return null;
  return regions.find((r) => r.level === 2 && r.parent_code === pc && r.name === city)?.code ?? null;
}

/** 区划完整路径：如「广东省 / 深圳市 / 南山区」 */
function namePathOf(regions: RegionRow[], row: RegionRow): string {
  const parts: string[] = [];
  let cur: RegionRow | undefined = row;
  while (cur) {
    parts.unshift(cur.name);
    cur = regions.find((r) => r.code === cur?.parent_code);
  }
  return parts.join(' / ');
}
