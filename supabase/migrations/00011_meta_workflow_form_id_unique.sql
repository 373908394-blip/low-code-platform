-- 为 meta_workflow.form_id 添加唯一约束，使 upsert(onConflict: 'form_id') 正确去重更新
CREATE UNIQUE INDEX idx_meta_workflow_form_unique ON public.meta_workflow(form_id);