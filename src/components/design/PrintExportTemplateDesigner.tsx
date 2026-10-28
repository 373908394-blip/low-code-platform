import { useState } from 'react';
import type { FormField, PrintExportTemplate, TemplateFieldMapping, TemplateKind, ActionDef, MetaForm } from '@/types';
import { PRESET_TEMPLATES, createTemplateFromPreset, triggerBrowserPrint, downloadExcelViaEdgeFunction } from '@/lib/print-export';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Printer, Download, Plus, Trash2, Edit2, Copy, FileSpreadsheet, Eye, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  templates: PrintExportTemplate[];
  onChange: (templates: PrintExportTemplate[]) => void;
  fields: FormField[];
  /** 全部表单（用于解析关联子表的字段清单） */
  forms?: MetaForm[];
  onAddAction?: (action: Partial<ActionDef>) => void;
}

const KIND_NAMES: Record<TemplateKind, string> = {
  excel_list: 'Excel列表模板',
  expense: '报销单模板',
  loan: '借款单模板',
  logistics: '物流单模板',
  custom: '自定义模板',
};

export function PrintExportTemplateDesigner({ templates = [], onChange, fields, forms = [], onAddAction }: Props) {
  const [editingTemplate, setEditingTemplate] = useState<PrintExportTemplate | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  // 打开新建模版弹窗
  const handleCreate = (kind: TemplateKind = 'excel_list') => {
    const tpl = createTemplateFromPreset(kind, fields, forms);
    setEditingTemplate(tpl);
    setIsDialogOpen(true);
  };

  // 保存当前编辑的模版
  const handleSaveTemplate = () => {
    if (!editingTemplate) return;
    if (!editingTemplate.name.trim()) {
      toast.error('请填写模板名称');
      return;
    }
    const idx = templates.findIndex((t) => t.id === editingTemplate.id);
    let next: PrintExportTemplate[];
    if (idx >= 0) {
      next = [...templates];
      next[idx] = editingTemplate;
    } else {
      next = [...templates, editingTemplate];
    }
    onChange(next);
    setIsDialogOpen(false);
    toast.success('模板配置已更新，请点击页面右上角保存生效');
  };

  // 删除模版
  const handleDelete = (id: string) => {
    onChange(templates.filter((t) => t.id !== id));
    toast.success('已删除模版');
  };

  // 复制模版
  const handleDuplicate = (tpl: PrintExportTemplate) => {
    const copy: PrintExportTemplate = {
      ...tpl,
      id: 'tpl_' + Math.random().toString(36).slice(2, 10),
      name: `${tpl.name} (副本)`,
      fields: tpl.fields.map((f) => ({ ...f, id: 'f_' + Math.random().toString(36).slice(2, 8) })),
    };
    onChange([...templates, copy]);
    toast.success('已复制模版');
  };

  // 快捷生成对应的动作按钮（打印 / 导出）
  const handleBindAction = (tpl: PrintExportTemplate, type: 'PRINT' | 'EXPORT') => {
    if (!onAddAction) return;
    if (type === 'PRINT') {
      onAddAction({
        name: `打印${tpl.name}`,
        icon: 'printer',
        action_type: 'PRINT',
        position: 'toolbar',
        variant: 'secondary',
        config: { templateId: tpl.id },
      });
      toast.success(`已在工具栏添加「打印${tpl.name}」动作按钮`);
    } else {
      onAddAction({
        name: `导出${tpl.name}`,
        icon: 'download',
        action_type: 'EXPORT',
        position: 'toolbar',
        variant: 'secondary',
        config: { templateId: tpl.id },
      });
      toast.success(`已在工具栏添加「导出${tpl.name}」动作按钮`);
    }
  };

  // 模拟单条/多条数据测试打印（含金额字段以验证大小写联动，含子表明细以验证逐行展开）
  const handleTestPrint = (tpl: PrintExportTemplate) => {
    const mockRows = [
      {
        id: 'BX20261009001', created_at: '2026-10-09', created_by: '李国然 (示例)', amount: 666.2, total_amount: 666.2, status: '已审批',
        fee_items: {
          __inline: true,
          rows: [
            { payload: { project: '兴隆山楂全产业链高质量发展项目（一期）(FK-P24003-01)', category: '汽车使用费-过路费', note: '往返高速费用', amount: 88.66 } },
            { payload: { project: '兴隆山楂全产业链高质量发展项目（一期）(FK-P24003-01)', category: '差旅费-住宿费', note: '宾馆3天住宿费用', amount: 276 } },
            { payload: { project: '兴隆山楂全产业链高质量发展项目（一期）(FK-P24003-01)', category: '汽车使用费-加油费', note: '出差车辆加油费用', amount: 301.54 } },
          ],
        },
      },
      { id: 'BX20261009002', created_at: '2026-10-09', created_by: '周杰 (示例)', amount: 1280, total_amount: 1280, status: '待审批' },
    ];
    triggerBrowserPrint(tpl, mockRows, fields);
  };

  // 模拟单条/多条数据测试 Excel 导出
  const handleTestExport = async (tpl: PrintExportTemplate) => {
    setExportingId(tpl.id);
    const mockRows = [
      { id: 'REC-20261009-001', created_at: '2026-10-09', created_by: '张三 (示例)', status: '已审批' },
      { id: 'REC-20261009-002', created_at: '2026-10-09', created_by: '李四 (示例)', status: '待审批' },
    ];
    const res = await downloadExcelViaEdgeFunction({
      template: tpl,
      rows: mockRows,
      fields,
    });
    setExportingId(null);
    if (!res.ok) {
      toast.error('导出测试失败：' + (res.error || '未知错误'));
    } else {
      toast.success('已调用 Edge Function 生成并触发 Excel 下载');
    }
  };

  return (
    <div className="mt-6 bg-card border border-border rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
            <Printer className="h-3.5 w-3.5" />
          </div>
          <h2 className="text-base font-semibold">打印与导出设计</h2>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            配置单据/列表打印模版，字段可绑定表单或置空；直接联动动作引擎进行 Excel 导出与打印
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Select onValueChange={(val) => handleCreate(val as TemplateKind)}>
            <SelectTrigger className="h-8 text-xs w-[130px]">
              <SelectValue placeholder="添加预设模版" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="excel_list">Excel列表模板</SelectItem>
              <SelectItem value="expense">报销单模板</SelectItem>
              <SelectItem value="loan">借款单模板</SelectItem>
              <SelectItem value="logistics">物流单模板</SelectItem>
              <SelectItem value="custom">自定义单据模板</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="p-5">
        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-lg border-border">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">尚未配置打印与导出模板</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              可预设 Excel 列表、报销单、借款单、物流单模板，内容可与表单字段映射，也可自由置空
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handleCreate('excel_list')}>
                + 常用 Excel 列表
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleCreate('expense')}>
                + 报销单模板
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleCreate('loan')}>
                + 借款单模板
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleCreate('logistics')}>
                + 物流单模板
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="group relative flex flex-col justify-between rounded-lg border border-border bg-background p-4 shadow-sm hover:border-primary/50 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {KIND_NAMES[tpl.kind] || '自定义'}
                      </Badge>
                      <h3 className="text-sm font-semibold truncate" title={tpl.name}>
                        {tpl.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="编辑模板"
                        onClick={() => {
                          setEditingTemplate(tpl);
                          setIsDialogOpen(true);
                        }}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="复制模版"
                        onClick={() => handleDuplicate(tpl)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        title="删除模版"
                        onClick={() => handleDelete(tpl.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mt-2 line-clamp-1">{tpl.title}</p>
                  <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
                    <span>映射字段：{tpl.fields.length} 个</span>
                    <span>·</span>
                    <span>置空字段：{tpl.fields.filter((f) => !f.formFieldKey || f.formFieldKey === '__empty__').length} 个</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1 max-h-16 overflow-hidden">
                    {tpl.fields.slice(0, 5).map((f) => (
                      <span key={f.id} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {f.label}{f.formFieldKey && f.formFieldKey !== '__empty__' ? '' : '(置空)'}
                      </span>
                    ))}
                    {tpl.fields.length > 5 && (
                      <span className="text-[10px] text-muted-foreground px-1 py-0.5">+{tpl.fields.length - 5}</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                      title="浏览器打印预览"
                      onClick={() => handleTestPrint(tpl)}
                    >
                      <Printer className="h-3 w-3" /> 打印预览
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                      title="直接调用 Edge Function 导出 Excel"
                      disabled={exportingId === tpl.id}
                      onClick={() => handleTestExport(tpl)}
                    >
                      <Download className="h-3 w-3" /> {exportingId === tpl.id ? '导出中…' : '导出Excel'}
                    </Button>
                  </div>

                  {onAddAction && (
                    <Select onValueChange={(val) => handleBindAction(tpl, val as 'PRINT' | 'EXPORT')}>
                      <SelectTrigger className="h-7 text-[11px] px-2 w-[88px] text-primary border-primary/30">
                        <SelectValue placeholder="+ 绑定动作" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRINT">+ 打印动作</SelectItem>
                        <SelectItem value="EXPORT">+ 导出动作</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 模版编辑弹窗 */}
      {editingTemplate && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                配置打印与导出模板：{editingTemplate.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">模板名称</Label>
                  <Input
                    className="h-8 text-xs"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">单据主标题</Label>
                  <Input
                    className="h-8 text-xs"
                    value={editingTemplate.title}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, title: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">副标题 / 落款机构</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="选填"
                    value={editingTemplate.subtitle || ''}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, subtitle: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs">模板类别</Label>
                  <Select
                    value={editingTemplate.kind}
                    onValueChange={(val) => setEditingTemplate({ ...editingTemplate, kind: val as TemplateKind })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="excel_list">Excel 列表模式</SelectItem>
                      <SelectItem value="expense">报销单模板</SelectItem>
                      <SelectItem value="loan">借款单模板</SelectItem>
                      <SelectItem value="logistics">物流单模板</SelectItem>
                      <SelectItem value="custom">自定义单据模板</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">打印排版方向</Label>
                  <Select
                    value={editingTemplate.orientation || 'portrait'}
                    onValueChange={(val) => setEditingTemplate({ ...editingTemplate, orientation: val as 'portrait' | 'landscape' })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">纵向（标准单据推荐）</SelectItem>
                      <SelectItem value="landscape">横向（宽表格推荐）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">模板说明</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="备注说明信息"
                    value={editingTemplate.description || ''}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">明细表行数</Label>
                  <p className="text-[11px] text-muted-foreground">按子表实际明细行数逐行展开打印，无数据不显示行。</p>
                </div>
              </div>

              {/* 字段映射配置列表 */}
              <div className="mt-4 border rounded-md p-3 bg-muted/20">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">模板字段映射明细</span>
                    <span className="text-[11px] text-muted-foreground">
                      区域：表头信息（标签|值栅格）/ 明细表列（绑定子表字段时按子表行逐行展开）/ 签字栏（留白手写）；格式支持金额千分位与人民币大写联动
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => {
                      const newField: TemplateFieldMapping = {
                        id: 'f_' + Math.random().toString(36).slice(2, 8),
                        label: '新增项',
                        formFieldKey: '__empty__',
                        defaultValue: '',
                        align: 'left',
                        section: 'meta',
                      };
                      setEditingTemplate({
                        ...editingTemplate,
                        fields: [...editingTemplate.fields, newField],
                      });
                    }}
                  >
                    <Plus className="h-3 w-3" /> 添加字段
                  </Button>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {editingTemplate.fields.map((f, idx) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-2 bg-background p-2 rounded border border-border text-xs"
                    >
                      <span className="w-6 text-center text-muted-foreground text-[11px]">{idx + 1}</span>
                      <div className="w-32">
                        <Input
                          className="h-7 text-xs"
                          placeholder="模板展示名"
                          value={f.label}
                          onChange={(e) => {
                            const next = [...editingTemplate.fields];
                            next[idx] = { ...f, label: e.target.value };
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        />
                      </div>

                      <div className="flex-1">
                        <Select
                          value={f.formFieldKey || '__empty__'}
                          onValueChange={(val) => {
                            const next = [...editingTemplate.fields];
                            next[idx] = { ...f, formFieldKey: val };
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="对应表单字段" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__empty__">
                              <span className="text-amber-600 font-medium">[置空] 不绑定表单字段</span>
                            </SelectItem>
                            {fields.filter((field) => field.type !== 'sub-table').map((field) => (
                              <SelectItem key={field.key} value={field.key}>
                                {field.label} ({field.key})
                              </SelectItem>
                            ))}
                            {/* 关联子表字段分组：绑定格式 子表key.子字段key，明细表列区域将按子表行逐行展开 */}
                            {fields.filter((sf) => sf.type === 'sub-table' && !!sf.subTable?.targetFormId).map((sf) => {
                              const targetForm = forms.find((g) => g.id === sf.subTable?.targetFormId);
                              const childFields = (targetForm?.schema_json?.fields ?? []).filter(
                                (cf) => !['section', 'row', 'sub-table', 'form-ref', 'query', 'wizard-step', 'action-button'].includes(cf.type)
                              );
                              if (childFields.length === 0) return null;
                              return (
                                <SelectGroup key={`sub_${sf.key}`}>
                                  <SelectLabel className="text-[11px] text-muted-foreground">子表 · {sf.label}</SelectLabel>
                                  {childFields.map((cf) => (
                                    <SelectItem key={`${sf.key}.${cf.key}`} value={`${sf.key}.${cf.key}`}>
                                      {sf.label} · {cf.label} ({sf.key}.{cf.key})
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="w-32">
                        <Input
                          className="h-7 text-xs"
                          placeholder="置空时默认值/固定文本"
                          value={f.defaultValue || ''}
                          onChange={(e) => {
                            const next = [...editingTemplate.fields];
                            next[idx] = { ...f, defaultValue: e.target.value };
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        />
                      </div>

                      <div className="w-24">
                        <Select
                          value={f.section || 'meta'}
                          onValueChange={(val) => {
                            const next = [...editingTemplate.fields];
                            next[idx] = { ...f, section: val as 'meta' | 'items' | 'sign' };
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="meta">表头信息</SelectItem>
                            <SelectItem value="items">明细表列</SelectItem>
                            <SelectItem value="sign">签字栏</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="w-24">
                        <Select
                          value={f.upperCase ? 'upper' : f.money ? 'money' : 'none'}
                          onValueChange={(val) => {
                            const next = [...editingTemplate.fields];
                            next[idx] = { ...f, money: val === 'money', upperCase: val === 'upper' };
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">常规文本</SelectItem>
                            <SelectItem value="money">金额 ¥千分位</SelectItem>
                            <SelectItem value="upper">人民币大写</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="w-24">
                        <Select
                          value={f.align || 'left'}
                          onValueChange={(val) => {
                            const next = [...editingTemplate.fields];
                            next[idx] = { ...f, align: val as 'left' | 'center' | 'right' };
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">居左</SelectItem>
                            <SelectItem value="center">居中</SelectItem>
                            <SelectItem value="right">居右</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground"
                          disabled={idx === 0}
                          onClick={() => {
                            const next = [...editingTemplate.fields];
                            const temp = next[idx - 1];
                            next[idx - 1] = next[idx];
                            next[idx] = temp;
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground"
                          disabled={idx === editingTemplate.fields.length - 1}
                          onClick={() => {
                            const next = [...editingTemplate.fields];
                            const temp = next[idx + 1];
                            next[idx + 1] = next[idx];
                            next[idx] = temp;
                            setEditingTemplate({ ...editingTemplate, fields: next });
                          }}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive"
                          onClick={() => {
                            setEditingTemplate({
                              ...editingTemplate,
                              fields: editingTemplate.fields.filter((_, i) => i !== idx),
                            });
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSaveTemplate}>确定并应用</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
