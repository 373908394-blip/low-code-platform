ALTER TABLE sys_settings
  ADD COLUMN annual_leave_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN annual_leave_expire text NOT NULL DEFAULT '03-31';