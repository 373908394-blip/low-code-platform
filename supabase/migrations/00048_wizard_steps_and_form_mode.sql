-- 向导表单：meta_forms.steps 步骤配置 + form_mode 增加 wizard
ALTER TABLE public.meta_forms
  ADD COLUMN steps jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.meta_forms DROP CONSTRAINT meta_forms_form_mode_check;

ALTER TABLE public.meta_forms
  ADD CONSTRAINT meta_forms_form_mode_check CHECK (form_mode IN ('normal', 'state', 'approval', 'wizard'));