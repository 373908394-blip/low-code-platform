DO $$ DECLARE v_uid uuid; BEGIN
  SELECT id INTO v_uid FROM public.profiles WHERE department_id = '00000000-0000-0000-0000-000000000102' LIMIT 1;
  UPDATE public.departments SET leader_id = v_uid WHERE id = '00000000-0000-0000-0000-000000000102';
END $$;