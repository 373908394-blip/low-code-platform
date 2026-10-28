ALTER TABLE public.meta_forms ADD COLUMN settings jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.meta_workflow ADD COLUMN settings jsonb DEFAULT '{}'::jsonb;