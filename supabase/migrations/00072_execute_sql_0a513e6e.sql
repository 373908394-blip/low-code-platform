ALTER TABLE sys_settings 
  ADD COLUMN IF NOT EXISTS ai_model_config jsonb
    DEFAULT '{}'::jsonb;