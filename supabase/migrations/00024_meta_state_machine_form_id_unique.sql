-- 为 meta_state_machine.form_id 添加唯一约束，使 upsert(onConflict: 'form_id') 正确去重更新
CREATE UNIQUE INDEX idx_meta_state_machine_form_unique ON public.meta_state_machine(form_id);