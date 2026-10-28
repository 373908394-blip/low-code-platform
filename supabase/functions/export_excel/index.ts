import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore esm.sh module
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ExportPayload {
  templateName?: string;
  title?: string;
  subtitle?: string;
  kind?: string;
  columns?: { key: string; label: string; align?: string }[];
  data?: Record<string, string>[];
  fileName?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: ExportPayload = await req.json();
    const {
      templateName = '导出数据',
      title = '数据报表',
      subtitle = '',
      columns = [],
      data = [],
      kind = 'excel_list',
    } = payload;

    const wb = XLSX.utils.book_new();

    if (kind === 'excel_list') {
      // 1. 表格列表模式：标题行 + 副标题 + 表头 + 数据行
      const sheetData: (string | number)[][] = [];
      sheetData.push([title]);
      if (subtitle) {
        sheetData.push([subtitle]);
      }
      sheetData.push([]); // 空行

      // 表头
      const headerRow = columns.map((c) => c.label);
      sheetData.push(headerRow);

      // 数据行
      for (const row of data) {
        const r = columns.map((c) => row[c.key] ?? '');
        sheetData.push(r);
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      // 设置列宽
      const colWidths = columns.map((c) => {
        const maxLen = Math.max(
          c.label.length * 2,
          ...data.map((d) => String(d[c.key] || '').length)
        );
        return { wch: Math.min(Math.max(maxLen + 2, 12), 40) };
      });
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, '数据列表');
    } else {
      // 2. 单据模式（报销单/借款单/物流单/自定义单据）：如果有多条记录，每条记录一个工作表或分块排版
      // 主表：单据明细卡片
      const wsData: (string | number)[][] = [];
      
      data.forEach((row, idx) => {
        if (idx > 0) {
          wsData.push([]);
          wsData.push(['------------------------------------------------------------']);
          wsData.push([]);
        }
        wsData.push([`${title} - 第 ${idx + 1} 联`]);
        if (subtitle) wsData.push([subtitle]);
        wsData.push([`导出时间：${new Date().toLocaleString('zh-CN')}`, '', `模板名称：${templateName}`]);
        wsData.push([]);

        // 两两一组渲染单据字段
        for (let i = 0; i < columns.length; i += 2) {
          const col1 = columns[i];
          const col2 = columns[i + 1];
          const val1 = row[col1.key] ?? '';
          if (col2) {
            const val2 = row[col2.key] ?? '';
            wsData.push([col1.label, val1, col2.label, val2]);
          } else {
            wsData.push([col1.label, val1, '', '']);
          }
        }

        wsData.push([]);
        wsData.push(['经手人：', '', '审批人：', '']);
      });

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 18 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 25));
    }

    // 生成 base64
    const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

    return new Response(
      JSON.stringify({
        ok: true,
        base64,
        fileName: payload.fileName || `${templateName}.xlsx`,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('export_excel error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
