import { Pagination } from '@arco-design/web-react';

/** 每页条数可选项 */
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50, 100];

/**
 * 通用分页组件：基于 Arco Pagination，保持原有回调接口。
 * page 为 1 起始。
 */
export function DataPagination({ total, page, pageSize, onPageChange, onPageSizeChange }: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground">
        共 <span className="font-medium text-foreground sig-num">{total}</span> 条
      </div>
      <Pagination
        total={total}
        current={page}
        pageSize={pageSize}
        sizeCanChange
        sizeOptions={PAGE_SIZE_OPTIONS}
        showTotal={false}
        showJumper
        onChange={(p: number, ps: number) => {
          if (ps !== pageSize) onPageSizeChange(ps);
          else onPageChange(p);
        }}
      />
    </div>
  );
}