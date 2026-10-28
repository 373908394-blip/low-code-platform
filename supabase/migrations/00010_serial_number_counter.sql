CREATE TABLE IF NOT EXISTS public.serial_number_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id uuid NOT NULL,
  field_key text NOT NULL,
  cycle_key text NOT NULL DEFAULT '',
  current_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, form_id, field_key, cycle_key)
);

COMMENT ON TABLE public.serial_number_counters IS '流水号计数器，按租户+表单+字段+周期维度隔离';

CREATE OR REPLACE FUNCTION public.generate_serial_number(
  p_tenant_id uuid,
  p_form_id uuid,
  p_field_key text,
  p_rules jsonb,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result text := '';
  r jsonb;
  v_type text;
  v_digits int;
  v_pad boolean;
  v_cycle text;
  v_start bigint;
  v_format text;
  v_value text;
  v_now timestamptz := now();
  v_cycle_key text := '';
  v_counter bigint;
  v_fmt_year text;
  v_fmt_month text;
  v_fmt_day text;
  v_fmt_hour text;
  v_fmt_minute text;
  v_fmt_second text;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    v_type := r->>'type';
    IF v_type = 'counter' THEN
      v_digits := COALESCE((r->>'digits')::int, 5);
      v_pad := COALESCE((r->>'pad')::boolean, true);
      v_cycle := COALESCE(r->>'resetCycle', 'never');
      v_start := COALESCE((r->>'start')::bigint, 1);

      v_fmt_year := to_char(v_now, 'YYYY');
      v_fmt_month := to_char(v_now, 'MM');
      v_fmt_day := to_char(v_now, 'DD');

      IF v_cycle = 'year' THEN
        v_cycle_key := v_fmt_year;
      ELSIF v_cycle = 'month' THEN
        v_cycle_key := v_fmt_year || v_fmt_month;
      ELSIF v_cycle = 'day' THEN
        v_cycle_key := v_fmt_year || v_fmt_month || v_fmt_day;
      ELSE
        v_cycle_key := '';
      END IF;

      INSERT INTO public.serial_number_counters (tenant_id, form_id, field_key, cycle_key, current_value, updated_at)
      VALUES (p_tenant_id, p_form_id, p_field_key, v_cycle_key, v_start, v_now)
      ON CONFLICT (tenant_id, form_id, field_key, cycle_key)
      DO UPDATE SET current_value = serial_number_counters.current_value + 1, updated_at = v_now
      RETURNING current_value INTO v_counter;

      v_value := v_counter::text;
      IF v_pad THEN
        v_value := lpad(v_value, v_digits, '0');
      END IF;
      v_result := v_result || v_value;
    ELSIF v_type = 'date' THEN
      v_format := COALESCE(r->>'format', 'yyyyMMdd');
      v_value := v_format;
      v_value := replace(v_value, 'yyyy', to_char(v_now, 'YYYY'));
      v_value := replace(v_value, 'MM', to_char(v_now, 'MM'));
      v_value := replace(v_value, 'dd', to_char(v_now, 'DD'));
      v_value := replace(v_value, 'yy', to_char(v_now, 'YY'));
      v_value := replace(v_value, 'HH', to_char(v_now, 'HH24'));
      v_value := replace(v_value, 'mm', to_char(v_now, 'MI'));
      v_value := replace(v_value, 'ss', to_char(v_now, 'SS'));
      v_result := v_result || v_value;
    ELSIF v_type = 'fixed' THEN
      v_result := v_result || COALESCE(r->>'value', '');
    ELSIF v_type = 'field' THEN
      v_value := COALESCE(p_payload->>(r->>'value'), '');
      v_result := v_result || v_value;
    END IF;
  END LOOP;
  RETURN v_result;
END $$;

ALTER TABLE public.serial_number_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_serial_counters" ON public.serial_number_counters
  FOR ALL TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);