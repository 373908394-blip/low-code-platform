ALTER TABLE profiles
  ADD COLUMN gender text NOT NULL DEFAULT '男',
  ADD COLUMN education text,
  ADD COLUMN id_card text,
  ADD COLUMN hire_date date,
  ADD COLUMN social_security_transfer_date date,
  ADD COLUMN housing_fund_transfer_date date,
  ADD COLUMN emergency_contact text,
  ADD COLUMN emergency_contact_phone text;