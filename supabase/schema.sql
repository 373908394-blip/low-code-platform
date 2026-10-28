-- ============================================================
-- SECTION: SCHEMA
-- ============================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS "public";


--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";


--
-- Name: EXTENSION "pg_graphql"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pg_graphql" IS 'pg_graphql: GraphQL support';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pgcrypto"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pgcrypto" IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


--
-- Name: EXTENSION "supabase_vault"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "supabase_vault" IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: approve_biz("uuid", "text", "text", "jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."approve_biz"("p_biz_id" "uuid", "p_action" "text", "p_comment" "text" DEFAULT ''::"text", "p_data" "jsonb" DEFAULT '{}'::"jsonb", "p_changes" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_node record;
  v_acts jsonb;
  v_next record;
  v_all_approved boolean;
  v_already boolean;
  v_wf record;
  v_tasks jsonb;
  v_next_node jsonb;
  v_next_id uuid;
  v_has_next boolean := false;
  v_payload jsonb;
  v_creator uuid;
  v_data jsonb := '{}'::jsonb;
  v_key text;
  v_old_status text;
  v_sm_status text;
  v_current_turn text;
  v_next_turn text;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION '无效的审批动作'; END IF;
  IF p_action = 'reject' AND btrim(COALESCE(p_comment, '')) = '' THEN RAISE EXCEPTION '驳回必须填写理由'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.biz_data WHERE id = p_biz_id;
  IF v_tenant IS NULL OR v_tenant <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  SELECT * INTO v_node FROM public.biz_approval
   WHERE biz_id = p_biz_id AND state = 'pending' AND current = true
   ORDER BY created_at LIMIT 1;
  IF v_node.id IS NULL THEN RAISE EXCEPTION '该单据没有待审批节点'; END IF;
  IF COALESCE(v_node.node_type, 'approval') = 'fill' THEN RAISE EXCEPTION '当前节点为填写节点，请完成填写确认'; END IF;

  IF NOT (v_node.approvers ? v_user::text) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user AND v_node.approvers ? ur.role_id::text
  ) THEN RAISE EXCEPTION '你不是该节点的审批人'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_node.acts, '[]'::jsonb)) act WHERE act->>'user_id' = v_user::text) INTO v_already;
  IF v_already THEN RAISE EXCEPTION '你已在该节点操作过'; END IF;

  -- 依次审批：仅当前轮到的人（审批人顺序中首位未通过者）可操作，保证逐人排队
  IF v_node.mode = 'sequential' THEN
    SELECT t.a INTO v_current_turn
      FROM jsonb_array_elements_text(v_node.approvers) WITH ORDINALITY AS t(a, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(v_node.acts, '[]'::jsonb)) act
        WHERE act->>'action' = 'approve' AND act->>'user_id' = t.a
     )
     ORDER BY t.ord LIMIT 1;
    IF v_current_turn IS NULL OR v_current_turn <> v_user::text THEN
      RAISE EXCEPTION '当前未轮到你审批';
    END IF;
  END IF;

  -- 审批通过：合并可编辑字段值（剔除系统字段，防客户端伪造）
  IF p_action = 'approve' AND jsonb_typeof(COALESCE(p_data, '{}'::jsonb)) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) LOOP
      IF v_key NOT IN ('created_by','created_at','updated_by','updated_at','user_name','dept_name','position','status') THEN
        v_data := v_data || jsonb_build_object(v_key, COALESCE(p_data, '{}'::jsonb) -> v_key);
      END IF;
    END LOOP;
    IF v_data <> '{}'::jsonb THEN
      UPDATE public.biz_data
         SET payload = COALESCE(payload, '{}'::jsonb) || v_data, updated_at = now(), updated_by = v_user
       WHERE id = p_biz_id;
    END IF;
  END IF;

  v_acts := COALESCE(v_node.acts, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'user_id', v_user,
    'user_name', (SELECT name FROM public.profiles WHERE id = v_user),
    'action', p_action, 'comment', p_comment, 'at', now(),
    'changes', COALESCE(p_changes, '[]'::jsonb)
  ));

  IF v_node.mode = 'countersign' AND p_action = 'approve' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_node.approvers) a
      WHERE a::text NOT IN (SELECT act->>'user_id' FROM jsonb_array_elements(v_acts) act WHERE act->>'action' = 'approve')
    ) INTO v_all_approved;
    IF NOT v_all_approved THEN
      UPDATE public.biz_approval SET acts = v_acts WHERE id = v_node.id;
      RETURN jsonb_build_object('done', false, 'message', '已同意，等待其他会签人');
    END IF;
  END IF;

  IF v_node.mode = 'sequential' AND p_action = 'approve' THEN
    -- 通过后仍有下一位未处理：节点不推进，待办轮转给下一人并发送通知
    SELECT t.a INTO v_next_turn
      FROM jsonb_array_elements_text(v_node.approvers) WITH ORDINALITY AS t(a, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_acts) act
        WHERE act->>'action' = 'approve' AND act->>'user_id' = t.a
     )
     ORDER BY t.ord LIMIT 1;
    IF v_next_turn IS NOT NULL THEN
      UPDATE public.biz_approval SET acts = v_acts WHERE id = v_node.id;
      INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
      VALUES (v_tenant, v_next_turn::uuid, '你有新的审批任务',
              COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), '单据') || ' 待你审批（依次审批）', 'todo', p_biz_id);
      RETURN jsonb_build_object('done', false, 'message', '已同意，已流转给下一位审批人');
    END IF;
  END IF;

  UPDATE public.biz_approval
     SET state = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
         acts = v_acts, current = false
   WHERE id = v_node.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_tenant, v_user, (SELECT name FROM public.profiles WHERE id = v_user),
          CASE WHEN p_action = 'approve' THEN '审批通过' ELSE '审批驳回' END,
          COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), p_biz_id::text),
          jsonb_build_object('node', v_node.node_name, 'comment', p_comment));

  IF p_action = 'reject' THEN
    -- 驳回：驱动状态机「驳回」事件，未定义时兜底 rejected
    v_old_status := (SELECT status FROM public.biz_data WHERE id = p_biz_id);
    v_sm_status := public.wf_apply_state_machine(p_biz_id, '驳回');
    IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
      UPDATE public.biz_data SET status = 'rejected', updated_at = now() WHERE id = p_biz_id;
    END IF;

    UPDATE public.biz_approval SET state = 'skipped', current = false WHERE biz_id = p_biz_id AND state = 'pending';
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    SELECT v_tenant, b.created_by, '你的申请已被驳回', '节点「' || v_node.node_name || '」驳回了申请：' || p_comment, 'info', p_biz_id
    FROM public.biz_data b WHERE b.id = p_biz_id;
    RETURN jsonb_build_object('done', true, 'message', '已驳回');
  END IF;

  -- 审批通过：推进流程计算下一任务
  SELECT payload, created_by, status INTO v_payload, v_creator, v_old_status FROM public.biz_data WHERE id = p_biz_id;
  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = (SELECT form_id FROM public.biz_data WHERE id = p_biz_id) ORDER BY updated_at DESC LIMIT 1;

  IF v_node.node_id IS NOT NULL AND v_wf.id IS NOT NULL THEN
    v_tasks := public.wf_after_position(v_wf.nodes, v_node.node_id, v_payload);
    DELETE FROM public.biz_approval WHERE biz_id = p_biz_id AND state = 'pending' AND current = false;
    IF v_tasks IS NOT NULL AND jsonb_array_length(v_tasks) > 0 THEN
      v_next_node := v_tasks->0;
      v_next_id := public.wf_create_task_row(v_tenant, p_biz_id, v_node.form_id, v_next_node, v_creator, true);
      SELECT * INTO v_next FROM public.biz_approval WHERE id = v_next_id;
      v_has_next := v_next.id IS NOT NULL;
    END IF;
  ELSE
    SELECT * INTO v_next FROM public.biz_approval
     WHERE biz_id = p_biz_id AND state = 'pending' ORDER BY created_at LIMIT 1;
    v_has_next := v_next.id IS NOT NULL;
    IF v_has_next THEN
      UPDATE public.biz_approval SET current = true WHERE id = v_next.id;
    END IF;
  END IF;

  -- 审批通过：驱动状态机「审批通过」事件
  v_sm_status := public.wf_apply_state_machine(p_biz_id, '审批通过');

  -- 如果没有下一节点（流程结束）且状态机未改变状态，兜底为 approved
  IF NOT v_has_next THEN
    IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    END IF;
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    SELECT v_tenant, b.created_by, '你的申请已全部通过', '所有审批节点均已通过', 'info', p_biz_id
    FROM public.biz_data b WHERE b.id = p_biz_id;
    -- 流程结束：执行审批联动规则（元数据驱动冲抵引擎；无规则配置时静默跳过）
    PERFORM public.run_offset_linkage(p_biz_id);
    RETURN jsonb_build_object('done', true, 'message', '已通过，流程结束');
  END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_tenant, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), '单据')
           || CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', p_biz_id
  FROM jsonb_array_elements(v_next.approvers) a;

  RETURN jsonb_build_object('done', true, 'message', '已通过，流转至「' || v_next.node_name || '」');
END $$;


--
-- Name: biz_data_touch_updated(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."biz_data_touch_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;


--
-- Name: change_biz_status("uuid", "text", "jsonb", "uuid"[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."change_biz_status"("p_biz_id" "uuid", "p_event" "text", "p_mappings" "jsonb" DEFAULT '{}'::"jsonb", "p_assignees" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.biz_data%ROWTYPE;
  v_sm RECORD;
  v_trans jsonb;
  v_new_status text;
  v_event text;
  v_assignee uuid;
  v_assignee_name text;
  v_multi boolean := COALESCE(array_length(p_assignees, 1), 0) > 0;
  v_payload jsonb;
  v_names text;
  v_uid uuid;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '未登录'); END IF;
  SELECT * INTO v_row FROM public.biz_data WHERE id = p_biz_id AND is_deleted = false;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', '单据不存在'); END IF;

  SELECT * INTO v_sm FROM public.meta_state_machine WHERE form_id = v_row.form_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', '未配置状态机'); END IF;

  -- 按当前状态 + 事件匹配转换（支持事件别名）
  FOR v_trans IN SELECT value FROM jsonb_array_elements(v_sm.transitions)
  LOOP
    IF v_trans->>'from' = v_row.status THEN
      v_event := v_trans->>'event';
      IF v_event = p_event
         OR (p_event = '审批通过' AND v_event IN ('通过','同意','审批通过'))
         OR (p_event = '驳回' AND v_event IN ('驳回','拒绝'))
         OR (p_event = '提交' AND v_event IN ('提交','发起','申请')) THEN
        v_new_status := v_trans->>'to';
        -- 自动分配（存量 assignAction）：manual 指定人 / rule 规则（initiator=发起人、dept_leader=部门负责人）
        IF v_trans->'assignAction' IS NOT NULL THEN
          IF v_trans->'assignAction'->>'type' = 'manual' AND COALESCE(v_trans->'assignAction'->>'userId', '') <> '' THEN
            v_assignee := (v_trans->'assignAction'->>'userId')::uuid;
          ELSIF v_trans->'assignAction'->>'type' = 'rule' THEN
            IF COALESCE(v_trans->'assignAction'->>'value', 'initiator') = 'initiator' THEN
              v_assignee := v_row.created_by;
            ELSIF v_trans->'assignAction'->>'value' = 'dept_leader' THEN
              SELECT d.leader_id INTO v_assignee FROM public.departments d
                WHERE d.id = (SELECT department_id FROM public.profiles WHERE id = v_row.created_by);
            END IF;
          END IF;
        END IF;
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF v_new_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '未找到匹配的状态转换'); END IF;

  v_payload := COALESCE(v_row.payload, '{}'::jsonb) || COALESCE(p_mappings, '{}'::jsonb);

  IF NOT v_multi THEN
    -- 单人或无分配：assignAction 解析出的负责人，或 p_assignees 首位
    SELECT name INTO v_assignee_name FROM public.profiles WHERE id = v_assignee;
  ELSE
    -- 多人分配：首位写入当前处理人，名单聚合展示，全量写入 payload 并逐人通知
    v_assignee := p_assignees[1];
    SELECT string_agg(p.name, '、' ORDER BY p.name) INTO v_names
      FROM public.profiles p WHERE p.id = ANY(p_assignees);
    v_assignee_name := v_names;
    v_payload := v_payload || jsonb_build_object('assigned_user_ids', to_jsonb(p_assignees));
  END IF;

  -- 无新分配时（v_assignee IS NULL）保留当前处理人，避免接收人改变状态后单据从「仅本人」可见列表消失
  UPDATE public.biz_data
     SET status = v_new_status, payload = v_payload, updated_at = now(), updated_by = v_user,
         assignee_id = COALESCE(v_assignee, assignee_id),
         assignee_name = COALESCE(v_assignee_name, assignee_name)
   WHERE id = p_biz_id;

  IF v_multi THEN
    FOREACH v_uid IN ARRAY p_assignees LOOP
      INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
      VALUES (v_row.tenant_id, v_uid, '待办分配：' || COALESCE(v_row.title, '新单据'),
              '有一条单据已分配给您处理，请及时查看。', 'todo', p_biz_id);
    END LOOP;
  ELSIF v_assignee IS NOT NULL THEN
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    VALUES (v_row.tenant_id, v_assignee, '待办分配：' || COALESCE(v_row.title, '新单据'),
            '有一条单据已分配给您处理，请及时查看。', 'todo', p_biz_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'message', '状态已流转', 'status', v_new_status, 'assignee', v_assignee);
END $$;


--
-- Name: ensure_todo_menu("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."ensure_todo_menu"("p_form_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_form record;
  v_root uuid;
  v_group uuid;
  v_sort integer;
BEGIN
  SELECT id, name, tenant_id, form_mode INTO v_form FROM public.meta_forms WHERE id = p_form_id;
  IF v_form.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '表单不存在'); END IF;
  IF v_form.tenant_id <> public.get_my_tenant_id() THEN RETURN jsonb_build_object('ok', false, 'message', '无权限'); END IF;

  -- 仅审批表单（form_mode='approval'）自动生成待办菜单；其他模式（normal/state-machine/wizard）移除已有菜单并跳过
  IF v_form.form_mode IS DISTINCT FROM 'approval' THEN
    DELETE FROM public.meta_menu WHERE path LIKE '/todo/' || p_form_id::text || '%';
    RETURN jsonb_build_object('ok', true, 'message', '非审批表单，跳过');
  END IF;

  SELECT id INTO v_root FROM public.meta_menu WHERE parent_id IS NULL AND name = '工作台' AND tenant_id = v_form.tenant_id LIMIT 1;
  IF v_root IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '工作台菜单不存在'); END IF;

  SELECT id INTO v_group FROM public.meta_menu WHERE parent_id = v_root AND name = '待办事项' AND tenant_id = v_form.tenant_id LIMIT 1;
  IF v_group IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '待办事项菜单不存在'); END IF;

  -- 清理该应用旧的待办菜单（含旧的「·待我审批」「·我申请的」两条）
  DELETE FROM public.meta_menu WHERE parent_id = v_group AND path LIKE '/todo/' || p_form_id::text || '%';

  SELECT count(*) + 1 INTO v_sort FROM public.meta_menu WHERE parent_id = v_group;

  -- 生成单条菜单：名称为应用名，页面内含「待我审批」+「我申请的」两部分
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status)
  VALUES (v_form.tenant_id, v_group, v_form.name, 'clipboard', v_sort, 'custom', p_form_id, '/todo/' || p_form_id::text, '["all"]'::jsonb, 'published');

  RETURN jsonb_build_object('ok', true, 'message', '已生成待办菜单');
END $$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: biz_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."biz_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "title" "text",
    "amount" numeric(14,2),
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "meta_version" integer DEFAULT 1 NOT NULL,
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    "is_deleted" boolean DEFAULT false NOT NULL,
    "assignee_id" "uuid",
    "assignee_name" "text"
);


--
-- Name: COLUMN "biz_data"."assignee_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."biz_data"."assignee_id" IS '当前处理人（状态机人员分配动作写入）';


--
-- Name: COLUMN "biz_data"."assignee_name"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."biz_data"."assignee_name" IS '当前处理人姓名（冗余展示）';


--
-- Name: eval_row_rules("jsonb", "public"."biz_data"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."eval_row_rules"("p_rules" "jsonb", "p_row" "public"."biz_data") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_item jsonb;
  v_k text;
  v_v text;
  v_ok boolean;
  v_group jsonb;
BEGIN
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' OR jsonb_array_length(p_rules) = 0 THEN
    RETURN true;
  END IF;
  -- 高级模式：单个带 logic 的组
  IF jsonb_array_length(p_rules) = 1 AND (p_rules->0) ? 'logic' THEN
    RETURN public.eval_rule_group(p_rules->0, p_row);
  END IF;
  -- 普通模式：RuleItem 数组 AND 组合
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    IF (v_item ? 'logic') THEN
      IF NOT public.eval_rule_group(v_item, p_row) THEN RETURN false; END IF;
      CONTINUE;
    END IF;
    v_k := v_item->>'field';
    v_v := v_item->>'value';
    v_ok := false;
    CASE v_item->>'op'
      WHEN 'eq' THEN v_ok := ((p_row.payload->>v_k) = v_v);
      WHEN 'ne' THEN v_ok := ((p_row.payload->>v_k) <> v_v);
      WHEN 'gt' THEN v_ok := ((p_row.payload->>v_k)::numeric > v_v::numeric);
      WHEN 'lt' THEN v_ok := ((p_row.payload->>v_k)::numeric < v_v::numeric);
      WHEN 'contains' THEN v_ok := (p_row.payload->>v_k LIKE '%' || v_v || '%');
      WHEN 'in' THEN v_ok := (string_to_array(v_v, ',') @> ARRAY[p_row.payload->>v_k]);
      WHEN 'between' THEN v_ok := ((p_row.payload->>v_k)::numeric BETWEEN split_part(v_v, ',', 1)::numeric AND split_part(v_v, ',', 2)::numeric);
      ELSE v_ok := true;
    END CASE;
    IF NOT v_ok THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;


--
-- Name: eval_rule_group("jsonb", "public"."biz_data"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."eval_rule_group"("p_group" "jsonb", "p_row" "public"."biz_data") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_logic text := p_group->>'logic';
  v_child jsonb;
  v_res boolean;
BEGIN
  IF v_logic = 'or' THEN
    FOR v_child IN SELECT * FROM jsonb_array_elements(p_group->'children') LOOP
      IF public.eval_rule_group_item(v_child, p_row) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;
  -- 默认 and
  FOR v_child IN SELECT * FROM jsonb_array_elements(p_group->'children') LOOP
    IF NOT public.eval_rule_group_item(v_child, p_row) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;


--
-- Name: eval_rule_group_item("jsonb", "public"."biz_data"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."eval_rule_group_item"("p_item" "jsonb", "p_row" "public"."biz_data") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF (p_item ? 'logic') THEN
    RETURN public.eval_rule_group(p_item, p_row);
  END IF;
  RETURN public.eval_row_rules(jsonb_build_array(p_item), p_row);
END $$;


--
-- Name: fill_node_biz("uuid", "jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."fill_node_biz"("p_biz_id" "uuid", "p_data" "jsonb" DEFAULT '{}'::"jsonb", "p_changes" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_biz record;
  v_node record;
  v_wf record;
  v_data jsonb := '{}'::jsonb;
  v_key text;
  v_tasks jsonb;
  v_next record;
  v_next_id uuid;
  v_next_node jsonb;
  v_has_next boolean := false;
  v_old_status text;
  v_sm_status text;
  v_node_cfg jsonb;
  v_guard jsonb;
  v_gk text;
  v_gv text;
  v_vt text;
  v_actual text;
  v_expected text;
  v_op_label text;
  v_f_label text;
  v_r_label text;
  v_gok boolean;
  v_merged jsonb;
  v_num_re text := '^-?([0-9]+(\.[0-9]+)?|\.[0-9]+)$';
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id;
  IF v_biz.id IS NULL OR v_biz.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  SELECT * INTO v_node FROM public.biz_approval
   WHERE biz_id = p_biz_id AND state = 'pending' AND current = true
   ORDER BY created_at LIMIT 1;
  IF v_node.id IS NULL THEN RAISE EXCEPTION '该单据没有待处理节点'; END IF;
  IF COALESCE(v_node.node_type, 'approval') <> 'fill' THEN RAISE EXCEPTION '当前节点不是填写节点'; END IF;

  IF NOT (v_node.approvers ? v_user::text) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user AND v_node.approvers ? ur.role_id::text
  ) THEN RAISE EXCEPTION '你不是该节点的填写人'; END IF;

  -- 合并填写数据（剔除系统字段，防客户端伪造）
  IF jsonb_typeof(COALESCE(p_data, '{}'::jsonb)) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) LOOP
      IF v_key NOT IN ('created_by','created_at','updated_by','updated_at','user_name','dept_name','position','status') THEN
        v_data := v_data || jsonb_build_object(v_key, COALESCE(p_data, '{}'::jsonb) -> v_key);
      END IF;
    END LOOP;
  END IF;

  -- 填写节点守卫条件兜底校验：定位流程节点配置中的 guards，合并现有数据与本次填写数据逐条评估
  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_node.node_id IS NOT NULL AND v_wf.id IS NOT NULL THEN
    SELECT n INTO v_node_cfg FROM jsonb_array_elements(v_wf.nodes) n WHERE n->>'id' = v_node.node_id LIMIT 1;
    IF v_node_cfg IS NOT NULL AND v_node_cfg ? 'guards' AND jsonb_typeof(v_node_cfg->'guards') = 'array' AND jsonb_array_length(v_node_cfg->'guards') > 0 THEN
      v_merged := COALESCE(v_biz.payload, '{}'::jsonb) || v_data;
      FOR v_guard IN SELECT * FROM jsonb_array_elements(v_node_cfg->'guards') LOOP
        v_gk := v_guard->>'field';
        v_gv := v_guard->>'value';
        IF COALESCE(v_gk, '') = '' OR COALESCE(v_gv, '') = '' THEN CONTINUE; END IF;
        v_vt := COALESCE(v_guard->>'value_type', 'value');
        IF v_vt = 'field' THEN
          v_expected := v_merged->>v_gv;
        ELSE
          v_expected := v_gv;
        END IF;
        v_actual := v_merged->>v_gk;
        v_gok := CASE v_guard->>'op'
          WHEN 'eq' THEN v_actual = v_expected
          WHEN 'ne' THEN v_actual <> v_expected
          WHEN 'gt' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric > v_expected::numeric)
          WHEN 'lt' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric < v_expected::numeric)
          WHEN 'gte' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric >= v_expected::numeric)
          WHEN 'lte' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric <= v_expected::numeric)
          WHEN 'contains' THEN v_actual LIKE '%' || v_expected || '%'
          WHEN 'ncontains' THEN v_actual NOT LIKE '%' || v_expected || '%'
          WHEN 'in' THEN string_to_array(v_expected, ',') @> ARRAY[v_actual]
          WHEN 'between' THEN (v_actual ~ v_num_re
                               AND split_part(v_expected, ',', 1) ~ v_num_re
                               AND split_part(v_expected, ',', 2) ~ v_num_re
                               AND v_actual::numeric BETWEEN split_part(v_expected, ',', 1)::numeric AND split_part(v_expected, ',', 2)::numeric)
          ELSE true
        END;
        IF NOT v_gok THEN
          SELECT x->>'label' INTO v_f_label FROM public.meta_forms m, jsonb_array_elements(COALESCE(m.schema_json, '{}'::jsonb)->'fields') x
           WHERE m.id = v_biz.form_id AND x->>'key' = v_gk LIMIT 1;
          SELECT l INTO v_op_label FROM (VALUES ('eq','等于'),('ne','不等于'),('gt','大于'),('lt','小于'),('gte','大于等于'),('lte','小于等于'),('contains','包含'),('ncontains','不包含'),('in','属于'),('between','介于')) AS t(o, l) WHERE t.o = v_guard->>'op';
          IF v_vt = 'field' THEN
            SELECT x->>'label' INTO v_r_label FROM public.meta_forms m, jsonb_array_elements(COALESCE(m.schema_json, '{}'::jsonb)->'fields') x
             WHERE m.id = v_biz.form_id AND x->>'key' = v_gv LIMIT 1;
            v_expected := COALESCE(v_r_label, v_gv);
          END IF;
          RAISE EXCEPTION '守卫条件未满足：「%」%「%」，请修改后再次提交', COALESCE(v_f_label, v_gk), COALESCE(v_op_label, v_guard->>'op'), v_expected;
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.biz_data
     SET payload = COALESCE(payload, '{}'::jsonb) || v_data, updated_at = now(), updated_by = v_user
   WHERE id = p_biz_id;

  UPDATE public.biz_approval
     SET state = 'approved', current = false,
         acts = COALESCE(acts, '[]'::jsonb) || jsonb_build_object(
           'user_id', v_user, 'user_name', (SELECT name FROM public.profiles WHERE id = v_user),
           'action', 'fill', 'comment', '填写完成', 'at', now(),
           'changes', COALESCE(p_changes, '[]'::jsonb))
   WHERE id = v_node.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, v_user, (SELECT name FROM public.profiles WHERE id = v_user), '填写确认',
          COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('node', v_node.node_name, 'biz_id', p_biz_id));

  -- 填写节点完成：先以该节点名称作为事件驱动状态机（例如节点名"销假"）
  v_old_status := v_biz.status;
  v_sm_status := public.wf_apply_state_machine(p_biz_id, v_node.node_name);
  IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
    v_sm_status := public.wf_apply_state_machine(p_biz_id, '填写完成');
  END IF;

  IF v_node.node_id IS NOT NULL AND v_wf.id IS NOT NULL THEN
    v_tasks := public.wf_after_position(v_wf.nodes, v_node.node_id, COALESCE(v_biz.payload, '{}'::jsonb) || v_data);
    DELETE FROM public.biz_approval WHERE biz_id = p_biz_id AND state = 'pending' AND current = false;
    IF v_tasks IS NOT NULL AND jsonb_array_length(v_tasks) > 0 THEN
      v_next_node := v_tasks->0;
      v_next_id := public.wf_create_task_row(v_biz.tenant_id, p_biz_id, v_biz.form_id, v_next_node, v_biz.created_by, true);
      SELECT * INTO v_next FROM public.biz_approval WHERE id = v_next_id;
      v_has_next := v_next.id IS NOT NULL;
    END IF;
  ELSE
    SELECT * INTO v_next FROM public.biz_approval
     WHERE biz_id = p_biz_id AND state = 'pending' ORDER BY created_at LIMIT 1;
    v_has_next := v_next.id IS NOT NULL;
    IF v_has_next THEN
      UPDATE public.biz_approval SET current = true WHERE id = v_next.id;
    END IF;
  END IF;

  IF NOT v_has_next THEN
    IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    END IF;
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    VALUES (v_biz.tenant_id, v_biz.created_by, '你的申请已全部通过', '所有流程节点均已完成', 'info', p_biz_id);
    -- 流程结束：执行审批联动规则（元数据驱动冲抵引擎；无规则配置时静默跳过）
    PERFORM public.run_offset_linkage(p_biz_id);
    RETURN jsonb_build_object('done', true, 'message', '填写完成，流程结束');
  END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_biz.tenant_id, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE(v_biz.title, '单据')
           || CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', p_biz_id
  FROM jsonb_array_elements(v_next.approvers) a;

  RETURN jsonb_build_object('done', true, 'message', '填写完成，流转至「' || v_next.node_name || '」');
END $_$;


--
-- Name: generate_serial_number("uuid", "uuid", "text", "jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."generate_serial_number"("p_tenant_id" "uuid", "p_form_id" "uuid", "p_field_key" "text", "p_rules" "jsonb", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: get_my_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."get_my_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ SELECT tenant_id FROM public.profiles WHERE id = auth.uid() $$;


--
-- Name: is_superadmin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."is_superadmin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ SELECT COALESCE((SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()), false) $$;


--
-- Name: merge_biz_payload_field("uuid", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."merge_biz_payload_field"("p_biz_id" "uuid", "p_field_key" "text", "p_value" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row biz_data%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_row from biz_data where id = p_biz_id and not is_deleted;
  if not found then return false; end if;
  if v_row.tenant_id is distinct from get_my_tenant_id() then return false; end if;
  if v_row.created_by is distinct from auth.uid() and not is_superadmin() then return false; end if;
  update biz_data
    set payload = jsonb_set(coalesce(payload, '{}'::jsonb), array[p_field_key], p_value),
        updated_at = now(),
        updated_by = auth.uid()
    where id = p_biz_id;
  return true;
end;
$$;


--
-- Name: my_visible_biz_ids("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."my_visible_biz_ids"("p_form_id" "uuid") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
  v_dept text;
  v_dept_tree text[];
  v_scope text;
  v_rules jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;

  -- 当前用户部门及子部门树（用于 dept_and_below）
  SELECT profiles.department_id::text INTO v_dept FROM public.profiles WHERE profiles.id = v_user;
  IF v_dept IS NOT NULL THEN
    WITH RECURSIVE tree AS (
      SELECT departments.id::text AS did FROM public.departments WHERE departments.id::text = v_dept
      UNION ALL
      SELECT d.id::text FROM public.departments d JOIN tree t ON d.parent_id::text = t.did
    )
    SELECT array_agg(did) INTO v_dept_tree FROM tree;
  END IF;

  -- 遍历当前用户的每个角色，取其 data_scope 与 row_rules，行可见性 = 任一角色允许
  FOR v_scope, v_rules IN
    SELECT r.data_scope, r.row_rules
    FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user AND r.status = 'enabled'
  LOOP
    IF v_scope = 'all' THEN
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant;
      RETURN;
    ELSIF v_scope = 'self' THEN
      -- 「仅本人」范围：本人创建的单据（已被移交给他人的不再显示） OR 本人是当前单据负责人（转移/分配的接收人立即可见并操作）
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
        AND ((b.created_by = v_user AND (b.assignee_id IS NULL OR b.assignee_id = v_user OR b.assignee_id = b.created_by))
          OR b.assignee_id = v_user);
    ELSIF v_scope = 'dept' THEN
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
        AND b.created_by IN (SELECT profiles.id FROM public.profiles WHERE profiles.department_id::text = v_dept);
    ELSIF v_scope = 'dept_and_below' THEN
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
        AND b.created_by IN (SELECT profiles.id FROM public.profiles WHERE profiles.department_id::text = ANY(COALESCE(v_dept_tree, ARRAY[]::text[])));
    ELSIF v_scope = 'custom' THEN
      IF jsonb_typeof(v_rules) = 'array' AND jsonb_array_length(v_rules) > 0 THEN
        RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
          AND public.eval_row_rules(v_rules, b);
      END IF;
    END IF;
  END LOOP;
END $$;


--
-- Name: resolve_approvers("jsonb", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."resolve_approvers"("p_node" "jsonb", "p_initiator" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_type text := p_node->>'approver_type';
  v_dept uuid;
  v_leader uuid;
  v_parent uuid;
  v_parent_leader uuid;
  v_cur uuid;
BEGIN
  IF v_type = 'user' THEN
    RETURN COALESCE(p_node->'approver_value', '[]'::jsonb);
  ELSIF v_type = 'role' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(ur.user_id), '[]'::jsonb)
      FROM public.user_roles ur
      WHERE ur.role_id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_node->'approver_value', '[]'::jsonb)))
    );
  ELSIF v_type = 'initiator' THEN
    RETURN jsonb_build_array(p_initiator);
  ELSIF v_type IN ('dept_leader','multi_level_leader') THEN
    SELECT department_id INTO v_dept FROM public.profiles WHERE id = p_initiator;
    v_cur := v_dept;
    WHILE v_cur IS NOT NULL LOOP
      SELECT leader_id, parent_id INTO v_leader, v_parent FROM public.departments WHERE id = v_cur;
      IF v_leader IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_leader AND status = 'active') THEN
        IF v_type = 'multi_level_leader' AND v_parent IS NOT NULL THEN
          SELECT leader_id INTO v_parent_leader FROM public.departments WHERE id = v_parent;
          IF v_parent_leader IS NOT NULL AND v_parent_leader <> v_leader
             AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_parent_leader AND status = 'active') THEN
            RETURN jsonb_build_array(v_leader, v_parent_leader);
          END IF;
        END IF;
        RETURN jsonb_build_array(v_leader);
      END IF;
      v_cur := v_parent;
    END LOOP;
    RETURN (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.profiles WHERE is_superadmin AND status = 'active');
  ELSE
    RETURN COALESCE(p_node->'approver_value', '[]'::jsonb);
  END IF;
END $$;


--
-- Name: run_offset_linkage("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."run_offset_linkage"("p_biz_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_biz record;
  v_src_form record;
  v_rules jsonb;
  v_rule jsonb;
  r record;
  r2 record;
  v_ids jsonb;
  v_target record;
  v_tform record;
  v_subf jsonb;
  v_child_form record;
  v_child_status text;
  v_amount_txt text;
  v_amount numeric;
  v_balance_txt text;
  v_cur jsonb;
  v_is_inline boolean;
  v_ids_arr jsonb;
  v_rows_arr jsonb;
  v_row_payloads jsonb;
  v_new_row jsonb;
  v_new_id uuid;
  v_title text;
  v_user uuid;
  v_user_name text;
  v_mk text;
  v_mv text;
  v_cond jsonb;
  v_ok boolean;
  v_actual text;
  v_expected text;
  v_num_re text := '^-?([0-9]+(\.[0-9]+)?|\.[0-9]+)$';
  v_tpayload jsonb;
  v_calc_updates jsonb := '{}'::jsonb;
  v_expr text;
  v_expr_js text;
  v_tok_val text;
  v_sum numeric;
  v_val numeric;
  v_sm text;
  v_results jsonb := '[]'::jsonb;
  v_dedup boolean;
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id;
  IF v_biz.id IS NULL THEN RETURN jsonb_build_object('done', false, 'message', '单据不存在'); END IF;

  SELECT * INTO v_src_form FROM public.meta_forms WHERE id = v_biz.form_id;
  v_rules := COALESCE(v_src_form.settings, '{}'::jsonb) -> 'linkageRules';
  IF v_rules IS NULL OR jsonb_typeof(v_rules) <> 'array' OR jsonb_array_length(v_rules) = 0 THEN
    RETURN jsonb_build_object('done', false, 'skipped', true);
  END IF;

  v_user := COALESCE(auth.uid(), v_biz.created_by);
  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;

  FOR v_rule IN SELECT * FROM jsonb_array_elements(v_rules) LOOP
    IF COALESCE(v_rule->>'trigger', 'on_approved') <> 'on_approved' THEN CONTINUE; END IF;

    v_ids := v_biz.payload -> (v_rule->>'sourceRefKey');
    IF v_ids IS NULL OR jsonb_typeof(v_ids) <> 'array' OR jsonb_array_length(v_ids) = 0 THEN CONTINUE; END IF;
    IF jsonb_array_length(v_ids) > 1 THEN
      RAISE EXCEPTION '联动规则「%」：仅支持冲抵一张关联单据，当前已选 % 张', v_rule->>'name', jsonb_array_length(v_ids);
    END IF;

    v_amount_txt := NULLIF(v_biz.payload->>(v_rule->>'amountKey'), '');
    IF v_amount_txt IS NULL OR v_amount_txt !~ v_num_re OR v_amount_txt::numeric <= 0 THEN CONTINUE; END IF;
    v_amount := v_amount_txt::numeric;

    SELECT * INTO v_target FROM public.biz_data WHERE id = (v_ids->>0)::uuid;
    IF v_target.id IS NULL THEN RAISE EXCEPTION '联动规则「%」：关联单据不存在或已删除', v_rule->>'name'; END IF;

    v_ok := true;
    FOR v_cond IN SELECT * FROM jsonb_array_elements(COALESCE(v_rule->'conditions', '[]'::jsonb)) LOOP
      v_actual := v_biz.payload->>(v_cond->>'field');
      v_expected := CASE WHEN COALESCE(v_cond->>'value_type', 'value') = 'field'
                         THEN v_biz.payload->>(v_cond->>'value') ELSE v_cond->>'value' END;
      v_ok := CASE v_cond->>'op'
        WHEN 'eq' THEN v_actual = v_expected
        WHEN 'ne' THEN v_actual <> v_expected
        WHEN 'gt' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric > v_expected::numeric)
        WHEN 'lt' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric < v_expected::numeric)
        WHEN 'gte' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric >= v_expected::numeric)
        WHEN 'lte' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric <= v_expected::numeric)
        WHEN 'contains' THEN v_actual LIKE '%' || v_expected || '%'
        WHEN 'ncontains' THEN v_actual NOT LIKE '%' || v_expected || '%'
        WHEN 'in' THEN string_to_array(v_expected, ',') @> ARRAY[v_actual]
        ELSE true
      END;
      IF NOT v_ok THEN EXIT; END IF;
    END LOOP;
    IF NOT v_ok THEN CONTINUE; END IF;

    SELECT * INTO v_tform FROM public.meta_forms WHERE id = v_target.form_id;
    SELECT f INTO v_subf FROM jsonb_array_elements(COALESCE(v_tform.schema_json, '{}'::jsonb) -> 'fields') f
     WHERE f->>'key' = v_rule->>'targetSubTableKey' AND f->>'type' = 'sub-table' LIMIT 1;
    IF v_subf IS NULL THEN RAISE EXCEPTION '联动规则「%」：目标子表字段「%」不存在', v_rule->>'name', v_rule->>'targetSubTableKey'; END IF;
    SELECT * INTO v_child_form FROM public.meta_forms WHERE id = ((v_subf->'subTable'->>'targetFormId'))::uuid;
    IF v_child_form.id IS NULL THEN RAISE EXCEPTION '联动规则「%」：目标子表单不存在', v_rule->>'name'; END IF;
    v_child_status := CASE WHEN v_child_form.form_mode = 'normal' THEN 'approved' ELSE 'draft' END;

    v_cur := v_target.payload -> (v_rule->>'targetSubTableKey');
    v_is_inline := (v_cur IS NOT NULL AND jsonb_typeof(v_cur) = 'object'
                    AND COALESCE((v_cur->>'__inline'), 'false')::boolean = true);
    IF v_is_inline THEN
      v_ids_arr := COALESCE(v_cur->'ids', '[]'::jsonb);
      v_rows_arr := COALESCE(v_cur->'rows', '[]'::jsonb);
      v_row_payloads := COALESCE((SELECT jsonb_agg(x->'payload') FROM jsonb_array_elements(v_rows_arr) x), '[]'::jsonb);
    ELSIF v_cur IS NOT NULL AND jsonb_typeof(v_cur) = 'array' THEN
      v_ids_arr := v_cur;
      v_row_payloads := COALESCE((
        SELECT jsonb_agg(b.payload) FROM public.biz_data b
         WHERE b.form_id = v_child_form.id
           AND b.id IN (SELECT (jsonb_array_elements_text(v_ids_arr))::uuid)
           AND COALESCE(b.is_deleted, false) = false), '[]'::jsonb);
    ELSE
      v_ids_arr := '[]'::jsonb;
      v_rows_arr := '[]'::jsonb;
      v_row_payloads := '[]'::jsonb;
    END IF;

    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row_payloads) p
                    WHERE p->>'_src_biz' = p_biz_id::text) INTO v_dedup;
    IF v_dedup THEN CONTINUE; END IF;

    IF COALESCE(v_rule->>'targetBalanceKey', '') <> '' THEN
      v_balance_txt := NULLIF(v_target.payload->>(v_rule->>'targetBalanceKey'), '');
      IF v_balance_txt IS NOT NULL AND v_balance_txt ~ v_num_re AND v_amount > v_balance_txt::numeric THEN
        RAISE EXCEPTION '联动规则「%」：冲抵金额 % 超过关联单据剩余额度 %，请调整冲抵金额后重新提交', v_rule->>'name', v_amount, v_balance_txt::numeric;
      END IF;
    END IF;

    v_new_row := jsonb_build_object('_src_biz', p_biz_id::text, '_src_form', v_biz.form_id::text);
    FOR v_mk IN SELECT jsonb_object_keys(COALESCE(v_rule->'rowMapping', '{}'::jsonb)) LOOP
      v_mv := v_rule->'rowMapping'->>v_mk;
      v_new_row := v_new_row || jsonb_build_object(v_mk,
        CASE
          WHEN v_mv LIKE '@field:%' THEN v_biz.payload->>substring(v_mv from 8)
          WHEN v_mv LIKE '@const:%' THEN substring(v_mv from 8)
          WHEN v_mv = '@now' THEN to_char(now(), 'YYYY-MM-DD')
          WHEN v_mv = '@now_ts' THEN to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
          WHEN v_mv = '@user' THEN COALESCE(v_user_name, '')
          ELSE v_mv
        END);
    END LOOP;
    v_title := COALESCE(NULLIF(v_new_row->>COALESCE(v_rule->>'rowTitleKey', ''), ''), COALESCE(v_biz.title, '冲销行'));

    INSERT INTO public.biz_data (tenant_id, form_id, status, title, amount, payload, created_by)
    VALUES (v_target.tenant_id, v_child_form.id, v_child_status, v_title, v_amount, v_new_row, v_user)
    RETURNING id INTO v_new_id;

    IF v_is_inline THEN
      v_cur := jsonb_build_object(
        '__inline', true,
        'ids', v_ids_arr || to_jsonb(v_new_id::text),
        'rows', v_rows_arr || jsonb_build_object('id', v_new_id, 'payload', v_new_row, 'sys', '{}'::jsonb));
    ELSIF COALESCE(v_subf->'subTable'->>'saveMode', 'standalone') = 'with-main' THEN
      v_cur := jsonb_build_object(
        '__inline', true,
        'ids', to_jsonb(ARRAY[v_new_id::text]),
        'rows', jsonb_build_array(jsonb_build_object('id', v_new_id, 'payload', v_new_row, 'sys', '{}'::jsonb)));
    ELSE
      v_cur := v_ids_arr || to_jsonb(v_new_id::text);
    END IF;
    UPDATE public.biz_data
       SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), ARRAY[v_rule->>'targetSubTableKey'], v_cur),
           updated_at = now(), updated_by = v_user
     WHERE id = v_target.id;

    SELECT payload INTO v_tpayload FROM public.biz_data WHERE id = v_target.id;
    v_calc_updates := '{}'::jsonb;
    FOR r IN SELECT f FROM jsonb_array_elements(COALESCE(v_tform.schema_json, '{}'::jsonb) -> 'fields') f LOOP
      IF r.f->>'type' = 'summary' AND COALESCE(r.f->'summary'->>'source', '') = 'subtable' THEN
        IF r.f->'summary'->>'subFieldKey' = v_rule->>'targetSubTableKey' THEN
          v_row_payloads := v_row_payloads || jsonb_build_array(v_new_row);
        ELSE
          SELECT COALESCE(jsonb_agg(b.payload), '[]'::jsonb) INTO v_row_payloads
            FROM public.biz_data b
           WHERE b.form_id = (SELECT (x->'subTable'->>'targetFormId')::uuid
                                FROM jsonb_array_elements(COALESCE(v_tform.schema_json, '{}'::jsonb) -> 'fields') x
                               WHERE x->>'key' = r.f->'summary'->>'subFieldKey' AND x->>'type' = 'sub-table' LIMIT 1)
             AND b.id IN (SELECT (jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(COALESCE(v_tpayload->(r.f->'summary'->>'subFieldKey'), '[]'::jsonb)) = 'array'
                       THEN v_tpayload->(r.f->'summary'->>'subFieldKey')
                       ELSE COALESCE(v_tpayload->(r.f->'summary'->>'subFieldKey')->'ids', '[]'::jsonb) END))::uuid)
             AND COALESCE(b.is_deleted, false) = false;
        END IF;
        SELECT COALESCE(SUM((p->>(r.f->'summary'->>'fieldKey'))::numeric), 0) INTO v_sum
          FROM jsonb_array_elements(v_row_payloads) p
         WHERE p->>(r.f->'summary'->>'fieldKey') ~ v_num_re;
        v_calc_updates := v_calc_updates || jsonb_build_object(r.f->>'key', v_sum);
      ELSIF r.f->>'type' = 'formula' AND COALESCE(r.f->'formula'->>'expression', '') <> '' THEN
        v_expr := r.f->'formula'->>'expression';
        v_expr_js := v_expr;
        v_val := NULL;
        <<tok_loop>>
        FOR r2 IN SELECT (m)[1] AS tok FROM regexp_matches(v_expr, '\{([^{}]+)\}', 'g') AS m LOOP
          v_tok_val := (v_tpayload || v_calc_updates) ->> r2.tok;
          IF v_tok_val IS NULL OR v_tok_val = '' OR v_tok_val !~ v_num_re THEN v_expr_js := NULL; EXIT tok_loop; END IF;
          v_expr_js := replace(v_expr_js, '{' || r2.tok || '}', '(' || v_tok_val || ')');
        END LOOP tok_loop;
        IF v_expr_js IS NOT NULL AND v_expr_js ~ '^[\d+\-*/().\s]+$' THEN
          BEGIN
            EXECUTE format('SELECT (%s)', v_expr_js) INTO v_val;
          EXCEPTION WHEN division_by_zero OR numeric_value_out_of_range THEN
            v_val := NULL;
          END;
        ELSE
          v_val := NULL;
        END IF;
        IF v_val IS NOT NULL THEN
          v_calc_updates := v_calc_updates || jsonb_build_object(r.f->>'key', v_val);
        END IF;
      END IF;
    END LOOP;
    IF v_calc_updates <> '{}'::jsonb THEN
      UPDATE public.biz_data SET payload = COALESCE(payload, '{}'::jsonb) || v_calc_updates, updated_at = now()
       WHERE id = v_target.id;
    END IF;

    v_sm := NULL;
    IF COALESCE(v_rule->>'targetTransitionEvent', '') <> '' THEN
      v_sm := public.wf_apply_state_machine(v_target.id, v_rule->>'targetTransitionEvent');
    END IF;

    INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
    VALUES (v_target.tenant_id, v_user, v_user_name, '联动冲抵',
            COALESCE(v_target.title, v_target.id::text),
            jsonb_build_object('rule', v_rule->>'name', 'source_biz', p_biz_id, 'source_title', v_biz.title,
                               'row_id', v_new_id, 'amount', v_amount, 'target_status', v_sm));

    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    VALUES (v_target.tenant_id, v_target.created_by, '借款冲抵通知',
            '单据「' || COALESCE(v_biz.title, p_biz_id::text) || '」审批通过，已自动追加冲销行 ' || v_amount || ' 元', 'info', v_target.id);

    v_results := v_results || jsonb_build_object(
      'rule', v_rule->>'name', 'target_id', v_target.id, 'row_id', v_new_id,
      'amount', v_amount, 'target_status', v_sm, 'recalced', v_calc_updates);
  END LOOP;

  RETURN jsonb_build_object('done', true, 'results', v_results);
END $_$;


--
-- Name: signup_tenant("text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."signup_tenant"("p_company" "text", "p_name" "text", "p_phone" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_role uuid;
  v_dept uuid;
  v_user uuid := auth.uid();
  v_root_wb uuid;
  v_grp_todo uuid;
  v_root_sys uuid;
  v_grp_org uuid;
  v_grp_set uuid;
  v_grp_dsg uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION '未登录，无法初始化租户'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user) THEN RAISE EXCEPTION '该账号已完成初始化'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE name = p_company) THEN RAISE EXCEPTION '企业名称已存在，请更换'; END IF;

  INSERT INTO public.tenants (name) VALUES (p_company) RETURNING id INTO v_tenant;
  INSERT INTO public.departments (tenant_id, name, parent_id, sort_order) VALUES (v_tenant, '总部', NULL, 0) RETURNING id INTO v_dept;
  INSERT INTO public.profiles (id, tenant_id, name, phone, email, department_id, position, status, is_superadmin)
    VALUES (v_user, v_tenant, p_name, p_phone, (SELECT email FROM auth.users WHERE id = v_user), v_dept, '超级管理员', 'active', true);
  INSERT INTO public.roles (tenant_id, name, description, data_scope, menu_perms, button_perms)
    VALUES (v_tenant, '超级管理员', '拥有全部权限', 'all', '["all"]', '["all"]') RETURNING id INTO v_role;
  INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES (v_tenant, v_user, v_role);
  INSERT INTO public.sys_settings (tenant_id) VALUES (v_tenant);

  -- ===== 工作台（系统菜单）=====
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, NULL, '工作台', 'layout', 0, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_root_wb;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_wb, '总览', 'chart', 1, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_todo;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_todo, '工作台', 'home', 1, 'custom', NULL, '/', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_wb, '待办事项', 'boxes', 2, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true);

  -- ===== 系统设置（系统菜单）=====
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, NULL, '系统设置', 'settings', 9, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_root_sys;

  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_sys, '组织与权限', 'users', 1, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_org;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_org, '用户管理', 'user-cog', 1, 'custom', NULL, '/users', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_org, '角色管理', 'shield', 2, 'custom', NULL, '/roles', '["all"]'::jsonb, 'published', true);

  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_sys, '系统设置', 'wrench', 2, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_set;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_set, '系统设置', 'sliders', 1, 'custom', NULL, '/settings', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_set, '我的年假', 'boxes', 2, 'custom', NULL, '/my-leave', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_set, '我的信息', 'boxes', 3, 'custom', NULL, '/my-profile', '["all"]'::jsonb, 'published', true);

  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_sys, '设计中心', 'grid', 3, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_dsg;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_dsg, '菜单管理', 'menu', 1, 'custom', NULL, '/design/menus', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_dsg, '应用列表', 'boxes', 2, 'custom', NULL, '/design/apps', '["all"]'::jsonb, 'published', true);

  RETURN v_tenant;
END $$;


--
-- Name: start_biz_workflow("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."start_biz_workflow"("p_biz_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_biz record;
  v_wf record;
  v_tasks jsonb;
  v_first jsonb;
  v_row_id uuid;
  v_init_type text;
  v_init_vals jsonb;
  v_init_ok boolean;
  v_sm_status text;
  v_mode text;
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id;
  IF v_biz.id IS NULL THEN RAISE EXCEPTION '单据不存在'; END IF;
  IF v_biz.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;
  IF v_biz.status NOT IN ('draft', 'rejected') THEN RAISE EXCEPTION '仅草稿或已驳回状态可发起审批'; END IF;

  -- 状态机表单：不走审批流程（不产生审批待办），仅驱动状态机「提交」事件流转
  SELECT form_mode INTO v_mode FROM public.meta_forms WHERE id = v_biz.form_id;
  IF v_mode = 'state' THEN
    v_sm_status := public.wf_apply_state_machine(p_biz_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'message', '已提交');
  END IF;

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_wf.id IS NULL OR v_wf.nodes = '[]'::jsonb THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    RETURN jsonb_build_object('ok', true, 'message', '该表单未配置审批流程，已直接完成');
  END IF;

  v_init_type := v_wf.settings->'initiatorConfig'->>'type';
  v_init_vals := COALESCE(v_wf.settings->'initiatorConfig'->'value', '[]'::jsonb);
  IF v_init_type IN ('user','dept','role') AND jsonb_typeof(v_init_vals) = 'array' AND jsonb_array_length(v_init_vals) > 0 THEN
    v_init_ok := false;
    IF v_init_type = 'user' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x WHERE x = v_biz.created_by::text) INTO v_init_ok;
    ELSIF v_init_type = 'dept' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x
                      WHERE x = (SELECT department_id::text FROM public.profiles WHERE id = v_biz.created_by)) INTO v_init_ok;
    ELSIF v_init_type = 'role' THEN
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = v_biz.created_by
                        AND ur.role_id::text IN (SELECT jsonb_array_elements_text(v_init_vals))) INTO v_init_ok;
    END IF;
    IF NOT v_init_ok THEN RAISE EXCEPTION '你不在该流程的允许发起人范围内'; END IF;
  END IF;

  -- 清空旧审批节点（驳回重提场景），重新创建首个任务
  DELETE FROM public.biz_approval WHERE biz_id = p_biz_id;

  v_tasks := public.wf_after_position(v_wf.nodes, NULL, COALESCE(v_biz.payload, '{}'::jsonb));
  IF v_tasks IS NULL OR jsonb_array_length(v_tasks) = 0 THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    RETURN jsonb_build_object('ok', true, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  v_first := v_tasks->0;
  v_row_id := public.wf_create_task_row(v_biz.tenant_id, p_biz_id, v_biz.form_id, v_first, v_biz.created_by, true);
  UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = p_biz_id;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_biz.tenant_id, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE(v_biz.title, '单据') || CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', p_biz_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_row_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '发起审批',
          COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('biz_id', p_biz_id));

  RETURN jsonb_build_object('ok', true, 'message', '已发起审批');
END $$;


--
-- Name: submit_biz("uuid", "jsonb", "text", numeric, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."submit_biz"("p_form_id" "uuid", "p_payload" "jsonb", "p_title" "text", "p_amount" numeric, "p_submit" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_tenant uuid;
  v_wf record;
  v_tasks jsonb;
  v_first jsonb;
  v_row_id uuid;
  v_init_type text;
  v_init_vals jsonb;
  v_init_ok boolean;
  v_sm_status text;
  v_mode text;
BEGIN
  v_tenant := public.get_my_tenant_id();
  INSERT INTO public.biz_data (tenant_id, form_id, status, title, amount, payload, created_by)
  VALUES (v_tenant, p_form_id, 'draft', p_title, p_amount, COALESCE(p_payload, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  IF NOT p_submit THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已保存草稿');
  END IF;

  -- 状态机表单：不走审批流程（不产生审批待办），仅驱动状态机「提交」事件流转
  SELECT form_mode INTO v_mode FROM public.meta_forms WHERE id = p_form_id;
  IF v_mode = 'state' THEN
    v_sm_status := public.wf_apply_state_machine(v_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    END IF;
    INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
    VALUES (v_tenant, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '提交申请',
            COALESCE(p_title, v_id::text), jsonb_build_object('biz_id', v_id));
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已提交');
  END IF;

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = p_form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_wf.id IS NULL OR v_wf.nodes = '[]'::jsonb THEN
    v_sm_status := public.wf_apply_state_machine(v_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '该表单未配置审批流程，已直接完成');
  END IF;

  -- 发起人范围校验（按人员/按部门/按角色）
  v_init_type := v_wf.settings->'initiatorConfig'->>'type';
  v_init_vals := COALESCE(v_wf.settings->'initiatorConfig'->'value', '[]'::jsonb);
  IF v_init_type IN ('user','dept','role') AND jsonb_typeof(v_init_vals) = 'array' AND jsonb_array_length(v_init_vals) > 0 THEN
    v_init_ok := false;
    IF v_init_type = 'user' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x WHERE x = auth.uid()::text) INTO v_init_ok;
    ELSIF v_init_type = 'dept' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x
                      WHERE x = (SELECT department_id::text FROM public.profiles WHERE id = auth.uid())) INTO v_init_ok;
    ELSIF v_init_type = 'role' THEN
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                        AND ur.role_id::text IN (SELECT jsonb_array_elements_text(v_init_vals))) INTO v_init_ok;
    END IF;
    IF NOT v_init_ok THEN RAISE EXCEPTION '你不在该流程的允许发起人范围内'; END IF;
  END IF;

  -- 按条件分支确定首个任务节点
  v_tasks := public.wf_after_position(v_wf.nodes, NULL, COALESCE(p_payload, '{}'::jsonb));
  IF v_tasks IS NULL OR jsonb_array_length(v_tasks) = 0 THEN
    v_sm_status := public.wf_apply_state_machine(v_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  v_first := v_tasks->0;
  v_row_id := public.wf_create_task_row(v_tenant, v_id, p_form_id, v_first, auth.uid(), true);

  -- 驱动状态机「提交」事件，未配置时回退 pending
  v_sm_status := public.wf_apply_state_machine(v_id, '提交');
  IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
    UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = v_id;
  END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_tenant, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE(p_title, '新单据') || CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', v_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_row_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_tenant, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '提交申请',
          COALESCE(p_title, v_id::text), jsonb_build_object('biz_id', v_id));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已提交审批');
END $$;


--
-- Name: wf_after_position("jsonb", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."wf_after_position"("p_nodes" "jsonb", "p_current_id" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_i int;
  v_j int;
  v_k int;
  v_node jsonb;
  v_branch jsonb;
  v_bnodes jsonb;
  v_tasks jsonb;
  v_found_top int := -1;
  v_found_branch jsonb := NULL;
  v_found_cond int := -1;
  v_found_sub int := -1;
BEGIN
  IF jsonb_typeof(COALESCE(p_nodes, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_nodes) = 0 THEN
    RETURN NULL;
  END IF;
  -- 空 id：从头收集（首次提交）
  IF p_current_id IS NULL OR btrim(p_current_id) = '' THEN
    RETURN public.wf_collect_tasks(p_nodes, 0, p_payload);
  END IF;
  FOR v_i IN 0 .. jsonb_array_length(p_nodes) - 1 LOOP
    v_node := p_nodes -> v_i;
    IF (v_node->>'id') = p_current_id THEN
      v_found_top := v_i;
      EXIT;
    ELSIF v_node->>'type' = 'condition' AND jsonb_typeof(COALESCE(v_node->'branches', '[]'::jsonb)) = 'array' THEN
      FOR v_branch IN SELECT jsonb_array_elements(v_node->'branches') LOOP
        v_bnodes := COALESCE(v_branch->'nodes', '[]'::jsonb);
        IF jsonb_typeof(v_bnodes) = 'array' AND jsonb_array_length(v_bnodes) > 0 THEN
          FOR v_j IN 0 .. jsonb_array_length(v_bnodes) - 1 LOOP
            IF (v_bnodes->v_j)->>'id' = p_current_id THEN
              v_found_sub := v_j;
              EXIT;
            END IF;
          END LOOP;
          IF v_found_sub >= 0 THEN
            v_found_branch := v_branch;
            v_found_cond := v_i;
            EXIT;
          END IF;
        END IF;
      END LOOP;
      IF v_found_branch IS NOT NULL THEN EXIT; END IF;
    END IF;
  END LOOP;

  IF v_found_top >= 0 THEN
    RETURN public.wf_collect_tasks(p_nodes, v_found_top + 1, p_payload);
  END IF;
  IF v_found_branch IS NOT NULL THEN
    v_tasks := public.wf_collect_tasks(v_found_branch->'nodes', v_found_sub + 1, p_payload);
    v_tasks := v_tasks || public.wf_collect_tasks(p_nodes, v_found_cond + 1, p_payload);
    RETURN v_tasks;
  END IF;
  RETURN NULL;
END $$;


--
-- Name: wf_apply_state_machine("uuid", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."wf_apply_state_machine"("p_biz_id" "uuid", "p_event" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row public.biz_data;
  v_sm record;
  v_trans jsonb;
  v_to text;
  v_ok boolean;
  v_k text;
  v_v text;
  v_value_type text;
  v_cur_val text;
  v_cur_status_label text;
  v_state_item jsonb;
  v_guard jsonb;
BEGIN
  SELECT * INTO v_row FROM public.biz_data WHERE id = p_biz_id;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_sm FROM public.meta_state_machine WHERE form_id = v_row.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_sm.id IS NULL OR v_sm.transitions IS NULL OR jsonb_array_length(v_sm.transitions) = 0 THEN
    RETURN v_row.status;
  END IF;

  -- 获取当前状态的中文 label（用于状态守卫条件的匹配）
  v_cur_status_label := v_row.status;
  IF v_sm.states IS NOT NULL THEN
    FOR v_state_item IN SELECT * FROM jsonb_array_elements(v_sm.states) LOOP
      IF v_state_item->>'key' = v_row.status THEN
        v_cur_status_label := v_state_item->>'label';
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- 查找匹配转换：from = v_row.status 且 event 匹配，且满足所有 guards
  FOR v_trans IN SELECT * FROM jsonb_array_elements(v_sm.transitions) LOOP
    IF (v_trans->>'from' = v_row.status OR (v_trans->>'from' IS NULL AND v_row.status IS NULL))
       AND (
         v_trans->>'event' = p_event
         OR (p_event = '审批通过' AND v_trans->>'event' IN ('通过', '同意', '审批通过'))
         OR (p_event = '驳回' AND v_trans->>'event' IN ('驳回', '拒绝'))
         OR (p_event = '提交' AND v_trans->>'event' IN ('提交', '发起', '申请'))
       ) THEN

      v_ok := true;
      -- 守卫条件检查
      IF v_trans ? 'guards' AND jsonb_typeof(v_trans->'guards') = 'array' AND jsonb_array_length(v_trans->'guards') > 0 THEN
        FOR v_guard IN SELECT * FROM jsonb_array_elements(v_trans->'guards') LOOP
          v_k := v_guard->>'field';
          v_v := v_guard->>'value';
          v_value_type := COALESCE(v_guard->>'value_type', 'value');

          -- 字段与字段比较：右值解析为当前单据中右字段的值（status 字段按状态 label 解析）
          IF v_value_type = 'field' THEN
            IF v_v = 'status' THEN
              v_v := v_cur_status_label;
            ELSE
              v_v := v_row.payload->>v_v;
            END IF;
          END IF;

          IF v_k = 'status' THEN
            -- status 字段：既可能是 key 也可能是 label
            CASE v_guard->>'op'
              WHEN 'eq' THEN
                v_ok := (v_v = v_row.status OR v_v = v_cur_status_label);
              WHEN 'ne' THEN
                v_ok := (v_v <> v_row.status AND v_v <> v_cur_status_label);
              ELSE
                v_ok := true;
            END CASE;
          ELSE
            v_cur_val := v_row.payload->>v_k;
            CASE v_guard->>'op'
              WHEN 'eq' THEN v_ok := (v_cur_val = v_v);
              WHEN 'ne' THEN v_ok := (v_cur_val <> v_v);
              WHEN 'gt' THEN v_ok := (v_cur_val::numeric > v_v::numeric);
              WHEN 'lt' THEN v_ok := (v_cur_val::numeric < v_v::numeric);
              WHEN 'gte' THEN v_ok := (v_cur_val::numeric >= v_v::numeric);
              WHEN 'lte' THEN v_ok := (v_cur_val::numeric <= v_v::numeric);
              WHEN 'contains' THEN v_ok := (v_cur_val LIKE '%' || v_v || '%');
              WHEN 'ncontains' THEN v_ok := (v_cur_val NOT LIKE '%' || v_v || '%');
              WHEN 'in' THEN v_ok := (string_to_array(v_v, ',') @> ARRAY[v_cur_val]);
              WHEN 'between' THEN v_ok := (v_cur_val::numeric BETWEEN split_part(v_v, ',', 1)::numeric AND split_part(v_v, ',', 2)::numeric);
              ELSE v_ok := true;
            END CASE;
          END IF;

          IF NOT v_ok THEN EXIT; END IF;
        END LOOP;
      END IF;

      -- 匹配成功且守卫满足
      IF v_ok THEN
        v_to := v_trans->>'to';
        UPDATE public.biz_data SET status = v_to, updated_at = now() WHERE id = p_biz_id;
        RETURN v_to;
      END IF;

    END IF;
  END LOOP;

  RETURN v_row.status;
END $$;


--
-- Name: wf_collect_tasks("jsonb", integer, "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."wf_collect_tasks"("p_nodes" "jsonb", "p_from" integer, "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_node jsonb;
  v_branch jsonb;
  v_i int;
BEGIN
  IF jsonb_typeof(COALESCE(p_nodes, '[]'::jsonb)) <> 'array' THEN RETURN '[]'::jsonb; END IF;
  IF p_from < 0 OR p_from >= jsonb_array_length(p_nodes) THEN RETURN '[]'::jsonb; END IF;
  FOR v_i IN p_from .. jsonb_array_length(p_nodes) - 1 LOOP
    v_node := p_nodes -> v_i;
    IF v_node->>'type' IN ('approval', 'fill') THEN
      v_out := v_out || jsonb_build_array(v_node);
    ELSIF v_node->>'type' = 'condition' THEN
      v_branch := public.wf_pick_branch(v_node, p_payload);
      IF v_branch IS NOT NULL AND jsonb_typeof(COALESCE(v_branch->'nodes', '[]'::jsonb)) = 'array' THEN
        v_out := v_out || public.wf_collect_tasks(v_branch->'nodes', 0, p_payload);
      END IF;
    END IF;
  END LOOP;
  RETURN v_out;
END $$;


--
-- Name: wf_create_task_row("uuid", "uuid", "uuid", "jsonb", "uuid", boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."wf_create_task_row"("p_tenant" "uuid", "p_biz_id" "uuid", "p_form_id" "uuid", "p_node" "jsonb", "p_initiator" "uuid", "p_current" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_approvers jsonb;
  v_id uuid;
BEGIN
  v_approvers := public.resolve_approvers(p_node, p_initiator);
  IF v_approvers IS NULL OR v_approvers = '[]'::jsonb THEN
    v_approvers := (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.profiles
                     WHERE tenant_id = p_tenant AND is_superadmin AND status = 'active');
  END IF;
  INSERT INTO public.biz_approval
    (tenant_id, biz_id, form_id, node_name, approver_type, approvers, mode, state, current, node_id, node_type, confirm_fields, field_perms)
  VALUES
    (p_tenant, p_biz_id, p_form_id, COALESCE(p_node->>'name', '审批'), COALESCE(p_node->>'approver_type', 'user'),
     v_approvers, COALESCE(p_node->>'mode', 'or'), 'pending', p_current,
     p_node->>'id', COALESCE(p_node->>'type', 'approval'), COALESCE(p_node->'confirmFields', '[]'::jsonb),
     COALESCE(p_node->'fieldPermissions', '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


--
-- Name: wf_eval_group("jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."wf_eval_group"("p_group" "jsonb", "p_payload" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_logic text := COALESCE(p_group->>'logic', 'and');
  v_rule jsonb;
  v_result boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_group->'rules', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_group->'rules', '[]'::jsonb)) = 0 THEN
    RETURN true;
  END IF;
  v_result := (v_logic = 'and');
  FOR v_rule IN SELECT jsonb_array_elements(COALESCE(p_group->'rules', '[]'::jsonb)) LOOP
    IF v_logic = 'and' THEN
      v_result := v_result AND public.wf_eval_rule(v_rule, p_payload);
    ELSE
      v_result := v_result OR public.wf_eval_rule(v_rule, p_payload);
    END IF;
  END LOOP;
  RETURN v_result;
END $$;


--
-- Name: wf_eval_rule("jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."wf_eval_rule"("p_rule" "jsonb", "p_payload" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $_$
DECLARE
  v_field text := p_rule->>'field';
  v_op text := COALESCE(p_rule->>'op', 'eq');
  v_val text := COALESCE(p_rule->>'value', '');
  v_raw jsonb;
  v_txt text;
  v_is_num boolean;
BEGIN
  IF v_field IS NULL THEN RETURN false; END IF;
  v_raw := p_payload -> v_field;
  IF v_raw IS NULL THEN
    v_txt := NULL;
  ELSIF jsonb_typeof(v_raw) IN ('string','number','boolean') THEN
    v_txt := v_raw #>> '{}';
  ELSE
    v_txt := v_raw::text;
  END IF;

  IF v_op = 'empty' THEN RETURN v_txt IS NULL OR btrim(v_txt) = ''; END IF;
  IF v_op = 'not_empty' THEN RETURN v_txt IS NOT NULL AND btrim(v_txt) <> ''; END IF;
  IF v_txt IS NULL THEN RETURN false; END IF;

  v_is_num := v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' AND v_val ~ '^-?[0-9]+(\.[0-9]+)?$';
  IF v_op IN ('gt','gte','lt','lte') THEN
    IF NOT v_is_num THEN RETURN false; END IF;
    IF v_op = 'gt' THEN RETURN v_txt::numeric > v_val::numeric;
    ELSIF v_op = 'gte' THEN RETURN v_txt::numeric >= v_val::numeric;
    ELSIF v_op = 'lt' THEN RETURN v_txt::numeric < v_val::numeric;
    ELSE RETURN v_txt::numeric <= v_val::numeric;
    END IF;
  END IF;
  IF v_op = 'eq' THEN
    RETURN (v_is_num AND v_txt::numeric = v_val::numeric) OR (NOT v_is_num AND v_txt = v_val);
  END IF;
  IF v_op = 'ne' THEN
    RETURN NOT ((v_is_num AND v_txt::numeric = v_val::numeric) OR (NOT v_is_num AND v_txt = v_val));
  END IF;
  IF v_op = 'contains' THEN RETURN v_txt ILIKE '%' || v_val || '%'; END IF;
  IF v_op = 'not_contains' THEN RETURN v_txt NOT ILIKE '%' || v_val || '%'; END IF;
  RETURN false;
END $_$;


--
-- Name: wf_pick_branch("jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."wf_pick_branch"("p_node" "jsonb", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_branches jsonb := COALESCE(p_node->'branches', '[]'::jsonb);
  v_branch jsonb;
  v_group jsonb;
  v_ok boolean;
BEGIN
  IF jsonb_typeof(v_branches) <> 'array' OR jsonb_array_length(v_branches) = 0 THEN
    RETURN NULL;
  END IF;
  FOR v_branch IN SELECT jsonb_array_elements(v_branches) LOOP
    v_ok := true;
    IF jsonb_typeof(COALESCE(v_branch->'conditions', '[]'::jsonb)) = 'array' THEN
      FOR v_group IN SELECT jsonb_array_elements(v_branch->'conditions') LOOP
        v_ok := v_ok AND public.wf_eval_group(v_group, p_payload);
        IF NOT v_ok THEN EXIT; END IF;
      END LOOP;
    END IF;
    IF v_ok THEN RETURN v_branch; END IF;
  END LOOP;
  RETURN (SELECT b FROM jsonb_array_elements(v_branches) AS b LIMIT 1);
END $$;


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "category" "text" DEFAULT 'notice'::"text" NOT NULL,
    "publisher" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "announcements_category_check" CHECK (("category" = ANY (ARRAY['notice'::"text", 'update'::"text", 'guide'::"text"])))
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "key_preview" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "user_name" "text",
    "action" "text" NOT NULL,
    "target" "text",
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: biz_approval; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."biz_approval" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "biz_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "node_name" "text" NOT NULL,
    "approver_type" "text" DEFAULT 'user'::"text" NOT NULL,
    "approvers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "mode" "text" DEFAULT 'or'::"text" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "acts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "current" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "node_id" "text",
    "node_type" "text" DEFAULT 'approval'::"text",
    "confirm_fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "field_perms" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "biz_approval_approver_type_check" CHECK (("approver_type" = ANY (ARRAY['user'::"text", 'role'::"text", 'dept_leader'::"text", 'initiator'::"text", 'initiator_choice'::"text", 'multi_level_leader'::"text"]))),
    CONSTRAINT "biz_approval_mode_check" CHECK (("mode" = ANY (ARRAY['countersign'::"text", 'or'::"text", 'sequential'::"text"]))),
    CONSTRAINT "biz_approval_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'skipped'::"text"])))
);


--
-- Name: china_regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."china_regions" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "level" integer NOT NULL,
    "parent_code" "text",
    "province_code" "text",
    CONSTRAINT "china_regions_level_check" CHECK (("level" = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "uuid",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "leader_id" "uuid"
);


--
-- Name: meta_action_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_action_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "user_name" "text",
    "form_id" "uuid",
    "biz_id" "uuid",
    "action_name" "text" NOT NULL,
    "action_type" "text" NOT NULL,
    "params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result" "jsonb",
    "error" "text",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: meta_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "position" "text" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text" DEFAULT 'mouse-pointer-click'::"text" NOT NULL,
    "variant" "text" DEFAULT 'secondary'::"text" NOT NULL,
    "action_type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "show_condition" "jsonb",
    "enable_condition" "jsonb",
    "permission_code" "text",
    "confirm_text" "text",
    "success_text" "text",
    "after_behavior" "text" DEFAULT 'refresh'::"text" NOT NULL,
    "sort" integer DEFAULT 0 NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "meta_actions_after_behavior_check" CHECK (("after_behavior" = ANY (ARRAY['refresh'::"text", 'close'::"text", 'navigate'::"text", 'back'::"text", 'none'::"text"]))),
    CONSTRAINT "meta_actions_position_check" CHECK (("position" = ANY (ARRAY['toolbar'::"text", 'row'::"text", 'batch'::"text", 'form-top'::"text", 'form-bottom'::"text", 'field'::"text"]))),
    CONSTRAINT "meta_actions_variant_check" CHECK (("variant" = ANY (ARRAY['primary'::"text", 'secondary'::"text", 'danger'::"text", 'link'::"text"])))
);


--
-- Name: meta_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "icon" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "published_version" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "schema_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "list_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "app_type" "text" DEFAULT 'form'::"text" NOT NULL,
    "form_mode" "text" DEFAULT 'normal'::"text" NOT NULL,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "meta_forms_form_mode_check" CHECK (("form_mode" = ANY (ARRAY['normal'::"text", 'state'::"text", 'approval'::"text", 'wizard'::"text"]))),
    CONSTRAINT "meta_forms_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


--
-- Name: COLUMN "meta_forms"."form_mode"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."meta_forms"."form_mode" IS '表单模式：normal 普通表单 / state 状态机表单 / approval 审批表单（仅 app_type=form 时有意义）';


--
-- Name: meta_menu; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_menu" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "name" "text" NOT NULL,
    "path" "text",
    "icon" "text" DEFAULT 'layout'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "menu_type" "text" DEFAULT 'form'::"text" NOT NULL,
    "form_id" "uuid",
    "visible_roles" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    CONSTRAINT "meta_menu_menu_type_check" CHECK (("menu_type" = ANY (ARRAY['form'::"text", 'list'::"text", 'dashboard'::"text", 'custom'::"text"]))),
    CONSTRAINT "meta_menu_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


--
-- Name: meta_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "source_form_id" "uuid" NOT NULL,
    "target_form_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "relation_type" "text" DEFAULT 'many_to_many'::"text" NOT NULL,
    "backfill_field" "text" NOT NULL,
    "display_fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "multiple" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "field_mappings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "meta_relations_relation_type_check" CHECK (("relation_type" = ANY (ARRAY['one_to_many'::"text", 'many_to_many'::"text", 'belong'::"text"])))
);


--
-- Name: COLUMN "meta_relations"."field_mappings"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."meta_relations"."field_mappings" IS '主表字段赋值映射：关联后取首条关联记录字段值写入主表字段（[{mainKey,targetKey}]），被赋值字段编辑页只读';


--
-- Name: meta_state_machine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_state_machine" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "states" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "transitions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: meta_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_version" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "changelog" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: meta_workflow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."meta_workflow" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "nodes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "transitions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb"
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "type" "text" DEFAULT 'todo'::"text" NOT NULL,
    "read" boolean DEFAULT false NOT NULL,
    "biz_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['todo'::"text", 'info'::"text", 'system'::"text"])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "employee_no" "text",
    "email" "text",
    "department_id" "uuid",
    "position" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_superadmin" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gender" "text" DEFAULT '男'::"text" NOT NULL,
    "education" "text",
    "id_card" "text",
    "hire_date" "date",
    "social_security_transfer_date" "date",
    "housing_fund_transfer_date" "date",
    "emergency_contact" "text",
    "emergency_contact_phone" "text",
    "avatar_url" "text",
    CONSTRAINT "profiles_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text"])))
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'enabled'::"text" NOT NULL,
    "data_scope" "text" DEFAULT 'self'::"text" NOT NULL,
    "menu_perms" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "button_perms" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "row_rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "col_rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "roles_data_scope_check" CHECK (("data_scope" = ANY (ARRAY['all'::"text", 'dept_and_below'::"text", 'dept'::"text", 'self'::"text", 'custom'::"text"]))),
    CONSTRAINT "roles_status_check" CHECK (("status" = ANY (ARRAY['enabled'::"text", 'disabled'::"text"])))
);


--
-- Name: serial_number_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."serial_number_counters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "field_key" "text" NOT NULL,
    "cycle_key" "text" DEFAULT ''::"text" NOT NULL,
    "current_value" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: TABLE "serial_number_counters"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."serial_number_counters" IS '流水号计数器，按租户+表单+字段+周期维度隔离';


--
-- Name: sys_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."sys_settings" (
    "tenant_id" "uuid" NOT NULL,
    "system_name" "text" DEFAULT '沐沐'::"text" NOT NULL,
    "logo_url" "text",
    "login_bg_url" "text",
    "login_welcome" "text" DEFAULT '欢迎使用低代码管理系统'::"text",
    "theme_color" "text" DEFAULT '#D54200'::"text" NOT NULL,
    "notify_config" "jsonb" DEFAULT '{"sms": false, "email": false, "inapp": true}'::"jsonb" NOT NULL,
    "backup_config" "jsonb" DEFAULT '{"auto": false, "frequency": "weekly"}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "annual_leave_rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "annual_leave_expire" "text" DEFAULT '03-31'::"text" NOT NULL,
    "ai_model_config" "jsonb" DEFAULT '{}'::"jsonb"
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "subdomain" "text",
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'announcements_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'announcements'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'api_keys_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'api_keys'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'audit_logs_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'audit_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval biz_approval_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_approval_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_approval'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_approval"
    ADD CONSTRAINT "biz_approval_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data biz_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_data_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_data"
    ADD CONSTRAINT "biz_data_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: china_regions china_regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'china_regions_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'china_regions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."china_regions"
    ADD CONSTRAINT "china_regions_pkey" PRIMARY KEY ("code");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'departments_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_action_logs meta_action_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_action_logs_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_action_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_action_logs"
    ADD CONSTRAINT "meta_action_logs_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_actions meta_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_actions_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_actions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_actions"
    ADD CONSTRAINT "meta_actions_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_forms meta_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_forms_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_forms'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_forms"
    ADD CONSTRAINT "meta_forms_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_forms meta_forms_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_forms_tenant_id_code_key'
      AND n.nspname = 'public'
      AND c.relname = 'meta_forms'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_forms"
    ADD CONSTRAINT "meta_forms_tenant_id_code_key" UNIQUE ("tenant_id", "code");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu meta_menu_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_menu_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_menu"
    ADD CONSTRAINT "meta_menu_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations meta_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_relations_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_relations"
    ADD CONSTRAINT "meta_relations_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_state_machine meta_state_machine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_state_machine_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_state_machine'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_state_machine"
    ADD CONSTRAINT "meta_state_machine_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_version meta_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_version_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_version'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_version"
    ADD CONSTRAINT "meta_version_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_workflow meta_workflow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_workflow_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_workflow'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_workflow"
    ADD CONSTRAINT "meta_workflow_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'notifications_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'notifications'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'roles_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'roles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: serial_number_counters serial_number_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'serial_number_counters_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'serial_number_counters'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."serial_number_counters"
    ADD CONSTRAINT "serial_number_counters_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: serial_number_counters serial_number_counters_tenant_id_form_id_field_key_cycle_ke_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'serial_number_counters_tenant_id_form_id_field_key_cycle_ke_key'
      AND n.nspname = 'public'
      AND c.relname = 'serial_number_counters'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."serial_number_counters"
    ADD CONSTRAINT "serial_number_counters_tenant_id_form_id_field_key_cycle_ke_key" UNIQUE ("tenant_id", "form_id", "field_key", "cycle_key");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: sys_settings sys_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'sys_settings_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'sys_settings'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."sys_settings"
    ADD CONSTRAINT "sys_settings_pkey" PRIMARY KEY ("tenant_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: tenants tenants_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'tenants_name_key'
      AND n.nspname = 'public'
      AND c.relname = 'tenants'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_name_key" UNIQUE ("name");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'tenants_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'tenants'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: tenants tenants_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'tenants_subdomain_key'
      AND n.nspname = 'public'
      AND c.relname = 'tenants'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_subdomain_key" UNIQUE ("subdomain");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'user_roles_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'user_roles_user_id_role_id_key'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_id_key" UNIQUE ("user_id", "role_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: idx_action_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_action_logs_tenant" ON "public"."meta_action_logs" USING "btree" ("tenant_id", "created_at" DESC);


--
-- Name: idx_announcements_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_announcements_tenant" ON "public"."announcements" USING "btree" ("tenant_id");


--
-- Name: idx_audit_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_audit_logs_tenant" ON "public"."audit_logs" USING "btree" ("tenant_id", "created_at" DESC);


--
-- Name: idx_biz_approval_biz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_biz_approval_biz" ON "public"."biz_approval" USING "btree" ("biz_id");


--
-- Name: idx_biz_approval_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_biz_approval_current" ON "public"."biz_approval" USING "btree" ("form_id", "current");


--
-- Name: idx_biz_data_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_biz_data_assignee" ON "public"."biz_data" USING "btree" ("tenant_id", "assignee_id", "status");


--
-- Name: idx_biz_data_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_biz_data_deleted" ON "public"."biz_data" USING "btree" ("form_id", "is_deleted");


--
-- Name: idx_biz_data_payload_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_biz_data_payload_gin" ON "public"."biz_data" USING "gin" ("payload");


--
-- Name: idx_biz_data_tenant_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_biz_data_tenant_form" ON "public"."biz_data" USING "btree" ("tenant_id", "form_id");


--
-- Name: idx_biz_data_tenant_form_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_biz_data_tenant_form_created" ON "public"."biz_data" USING "btree" ("tenant_id", "form_id", "created_at" DESC);


--
-- Name: idx_china_regions_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_china_regions_level" ON "public"."china_regions" USING "btree" ("level");


--
-- Name: idx_china_regions_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_china_regions_parent" ON "public"."china_regions" USING "btree" ("parent_code");


--
-- Name: idx_departments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_departments_tenant" ON "public"."departments" USING "btree" ("tenant_id");


--
-- Name: idx_meta_actions_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_meta_actions_form" ON "public"."meta_actions" USING "btree" ("form_id", "position", "sort");


--
-- Name: idx_meta_forms_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_meta_forms_tenant" ON "public"."meta_forms" USING "btree" ("tenant_id");


--
-- Name: idx_meta_menu_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_meta_menu_tenant" ON "public"."meta_menu" USING "btree" ("tenant_id");


--
-- Name: idx_meta_state_machine_form_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "idx_meta_state_machine_form_unique" ON "public"."meta_state_machine" USING "btree" ("form_id");


--
-- Name: idx_meta_workflow_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_meta_workflow_form" ON "public"."meta_workflow" USING "btree" ("form_id");


--
-- Name: idx_meta_workflow_form_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS "idx_meta_workflow_form_unique" ON "public"."meta_workflow" USING "btree" ("form_id");


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "public"."notifications" USING "btree" ("user_id", "read");


--
-- Name: idx_profiles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_profiles_tenant" ON "public"."profiles" USING "btree" ("tenant_id");


--
-- Name: idx_roles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_roles_tenant" ON "public"."roles" USING "btree" ("tenant_id");


--
-- Name: idx_user_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_user_roles_user" ON "public"."user_roles" USING "btree" ("user_id");


--
-- Name: biz_data trg_biz_data_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER "trg_biz_data_touch" BEFORE UPDATE ON "public"."biz_data" FOR EACH ROW EXECUTE FUNCTION "public"."biz_data_touch_updated"();


--
-- Name: announcements announcements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'announcements_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'announcements'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: api_keys api_keys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'api_keys_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'api_keys'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: audit_logs audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'audit_logs_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'audit_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval biz_approval_biz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_approval_biz_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_approval'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_approval"
    ADD CONSTRAINT "biz_approval_biz_id_fkey" FOREIGN KEY ("biz_id") REFERENCES "public"."biz_data"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval biz_approval_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_approval_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_approval'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_approval"
    ADD CONSTRAINT "biz_approval_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval biz_approval_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_approval_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_approval'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_approval"
    ADD CONSTRAINT "biz_approval_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data biz_data_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_data_assignee_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_data"
    ADD CONSTRAINT "biz_data_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data biz_data_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_data_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_data"
    ADD CONSTRAINT "biz_data_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data biz_data_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'biz_data_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."biz_data"
    ADD CONSTRAINT "biz_data_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: china_regions china_regions_parent_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'china_regions_parent_code_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'china_regions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."china_regions"
    ADD CONSTRAINT "china_regions_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "public"."china_regions"("code");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: china_regions china_regions_province_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'china_regions_province_code_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'china_regions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."china_regions"
    ADD CONSTRAINT "china_regions_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "public"."china_regions"("code");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments departments_leader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'departments_leader_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments departments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'departments_parent_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments departments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'departments_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_action_logs meta_action_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_action_logs_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_action_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_action_logs"
    ADD CONSTRAINT "meta_action_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_actions meta_actions_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_actions_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_actions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_actions"
    ADD CONSTRAINT "meta_actions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_actions meta_actions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_actions_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_actions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_actions"
    ADD CONSTRAINT "meta_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_forms meta_forms_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_forms_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_forms'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_forms"
    ADD CONSTRAINT "meta_forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu meta_menu_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_menu_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_menu"
    ADD CONSTRAINT "meta_menu_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu meta_menu_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_menu_parent_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_menu"
    ADD CONSTRAINT "meta_menu_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."meta_menu"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu meta_menu_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_menu_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_menu"
    ADD CONSTRAINT "meta_menu_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations meta_relations_source_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_relations_source_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_relations"
    ADD CONSTRAINT "meta_relations_source_form_id_fkey" FOREIGN KEY ("source_form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations meta_relations_target_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_relations_target_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_relations"
    ADD CONSTRAINT "meta_relations_target_form_id_fkey" FOREIGN KEY ("target_form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations meta_relations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_relations_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_relations"
    ADD CONSTRAINT "meta_relations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_state_machine meta_state_machine_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_state_machine_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_state_machine'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_state_machine"
    ADD CONSTRAINT "meta_state_machine_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_state_machine meta_state_machine_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_state_machine_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_state_machine'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_state_machine"
    ADD CONSTRAINT "meta_state_machine_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_version meta_version_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_version_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_version'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_version"
    ADD CONSTRAINT "meta_version_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_version meta_version_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_version_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_version'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_version"
    ADD CONSTRAINT "meta_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_workflow meta_workflow_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_workflow_form_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_workflow'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_workflow"
    ADD CONSTRAINT "meta_workflow_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."meta_forms"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_workflow meta_workflow_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'meta_workflow_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'meta_workflow'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."meta_workflow"
    ADD CONSTRAINT "meta_workflow_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: notifications notifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'notifications_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'notifications'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'notifications_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'notifications'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_department_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'roles_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'roles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: serial_number_counters serial_number_counters_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'serial_number_counters_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'serial_number_counters'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."serial_number_counters"
    ADD CONSTRAINT "serial_number_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: sys_settings sys_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'sys_settings_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'sys_settings'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."sys_settings"
    ADD CONSTRAINT "sys_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'user_roles_role_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles user_roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'user_roles_tenant_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'user_roles_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;

--
-- Name: china_regions anon 可读行政区划; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'anon 可读行政区划'
      AND n.nspname = 'public'
      AND c.relname = 'china_regions'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "anon 可读行政区划" ON "public"."china_regions" FOR SELECT TO "anon" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: china_regions authenticated 可读行政区划; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'authenticated 可读行政区划'
      AND n.nspname = 'public'
      AND c.relname = 'china_regions'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "authenticated 可读行政区划" ON "public"."china_regions" FOR SELECT TO "authenticated" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."biz_approval" ENABLE ROW LEVEL SECURITY;

--
-- Name: biz_data; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."biz_data" ENABLE ROW LEVEL SECURITY;

--
-- Name: china_regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."china_regions" ENABLE ROW LEVEL SECURITY;

--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_action_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_action_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_actions" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_forms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_forms" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_menu; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_menu" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_relations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_relations" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_state_machine; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_state_machine" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_version; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_version" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_workflow; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."meta_workflow" ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_action_logs p_action_logs_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_action_logs_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_action_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_action_logs_del" ON "public"."meta_action_logs" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_action_logs p_action_logs_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_action_logs_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_action_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_action_logs_ins" ON "public"."meta_action_logs" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_action_logs p_action_logs_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_action_logs_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_action_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_action_logs_sel" ON "public"."meta_action_logs" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: announcements p_ann_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_ann_del'
      AND n.nspname = 'public'
      AND c.relname = 'announcements'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_ann_del" ON "public"."announcements" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: announcements p_ann_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_ann_ins'
      AND n.nspname = 'public'
      AND c.relname = 'announcements'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_ann_ins" ON "public"."announcements" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: announcements p_ann_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_ann_sel'
      AND n.nspname = 'public'
      AND c.relname = 'announcements'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_ann_sel" ON "public"."announcements" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: api_keys p_api_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_api_del'
      AND n.nspname = 'public'
      AND c.relname = 'api_keys'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_api_del" ON "public"."api_keys" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: api_keys p_api_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_api_ins'
      AND n.nspname = 'public'
      AND c.relname = 'api_keys'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_api_ins" ON "public"."api_keys" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: api_keys p_api_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_api_sel'
      AND n.nspname = 'public'
      AND c.relname = 'api_keys'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_api_sel" ON "public"."api_keys" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval p_appr_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_appr_ins'
      AND n.nspname = 'public'
      AND c.relname = 'biz_approval'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_appr_ins" ON "public"."biz_approval" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval p_appr_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_appr_sel'
      AND n.nspname = 'public'
      AND c.relname = 'biz_approval'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_appr_sel" ON "public"."biz_approval" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_approval p_appr_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_appr_upd'
      AND n.nspname = 'public'
      AND c.relname = 'biz_approval'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_appr_upd" ON "public"."biz_approval" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: audit_logs p_audit_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_audit_del'
      AND n.nspname = 'public'
      AND c.relname = 'audit_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_audit_del" ON "public"."audit_logs" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: audit_logs p_audit_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_audit_ins'
      AND n.nspname = 'public'
      AND c.relname = 'audit_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_audit_ins" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: audit_logs p_audit_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_audit_sel'
      AND n.nspname = 'public'
      AND c.relname = 'audit_logs'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_audit_sel" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data p_biz_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_biz_del'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_biz_del" ON "public"."biz_data" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data p_biz_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_biz_ins'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_biz_ins" ON "public"."biz_data" FOR INSERT TO "authenticated" WITH CHECK ((("tenant_id" = "public"."get_my_tenant_id"()) AND ("created_by" = "auth"."uid"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data p_biz_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_biz_sel'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_biz_sel" ON "public"."biz_data" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: biz_data p_biz_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_biz_upd'
      AND n.nspname = 'public'
      AND c.relname = 'biz_data'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_biz_upd" ON "public"."biz_data" FOR UPDATE TO "authenticated" USING ((("tenant_id" = "public"."get_my_tenant_id"()) AND ("public"."is_superadmin"() OR ("created_by" = "auth"."uid"()))));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments p_depts_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_depts_del'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_depts_del" ON "public"."departments" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments p_depts_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_depts_ins'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_depts_ins" ON "public"."departments" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments p_depts_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_depts_sel'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_depts_sel" ON "public"."departments" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: departments p_depts_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_depts_upd'
      AND n.nspname = 'public'
      AND c.relname = 'departments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_depts_upd" ON "public"."departments" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_actions p_meta_actions_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_actions_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_actions'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_actions_del" ON "public"."meta_actions" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_actions p_meta_actions_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_actions_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_actions'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_actions_ins" ON "public"."meta_actions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_actions p_meta_actions_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_actions_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_actions'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_actions_sel" ON "public"."meta_actions" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_actions p_meta_actions_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_actions_upd'
      AND n.nspname = 'public'
      AND c.relname = 'meta_actions'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_actions_upd" ON "public"."meta_actions" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_forms p_meta_forms_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_forms_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_forms'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_forms_del" ON "public"."meta_forms" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_forms p_meta_forms_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_forms_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_forms'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_forms_ins" ON "public"."meta_forms" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_forms p_meta_forms_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_forms_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_forms'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_forms_sel" ON "public"."meta_forms" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_forms p_meta_forms_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_forms_upd'
      AND n.nspname = 'public'
      AND c.relname = 'meta_forms'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_forms_upd" ON "public"."meta_forms" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu p_meta_menu_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_menu_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_menu_del" ON "public"."meta_menu" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu p_meta_menu_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_menu_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_menu_ins" ON "public"."meta_menu" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu p_meta_menu_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_menu_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_menu_sel" ON "public"."meta_menu" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_menu p_meta_menu_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_menu_upd'
      AND n.nspname = 'public'
      AND c.relname = 'meta_menu'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_menu_upd" ON "public"."meta_menu" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations p_meta_relations_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_relations_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_relations_del" ON "public"."meta_relations" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations p_meta_relations_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_relations_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_relations_ins" ON "public"."meta_relations" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations p_meta_relations_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_relations_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_relations_sel" ON "public"."meta_relations" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_relations p_meta_relations_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_relations_upd'
      AND n.nspname = 'public'
      AND c.relname = 'meta_relations'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_relations_upd" ON "public"."meta_relations" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_state_machine p_meta_sm_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_sm_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_state_machine'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_sm_del" ON "public"."meta_state_machine" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_state_machine p_meta_sm_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_sm_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_state_machine'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_sm_ins" ON "public"."meta_state_machine" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_state_machine p_meta_sm_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_sm_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_state_machine'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_sm_sel" ON "public"."meta_state_machine" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_state_machine p_meta_sm_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_sm_upd'
      AND n.nspname = 'public'
      AND c.relname = 'meta_state_machine'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_sm_upd" ON "public"."meta_state_machine" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_version p_meta_ver_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_ver_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_version'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_ver_del" ON "public"."meta_version" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_version p_meta_ver_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_ver_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_version'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_ver_ins" ON "public"."meta_version" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_version p_meta_ver_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_ver_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_version'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_ver_sel" ON "public"."meta_version" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_workflow p_meta_wf_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_wf_del'
      AND n.nspname = 'public'
      AND c.relname = 'meta_workflow'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_wf_del" ON "public"."meta_workflow" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_workflow p_meta_wf_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_wf_ins'
      AND n.nspname = 'public'
      AND c.relname = 'meta_workflow'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_wf_ins" ON "public"."meta_workflow" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_workflow p_meta_wf_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_wf_sel'
      AND n.nspname = 'public'
      AND c.relname = 'meta_workflow'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_wf_sel" ON "public"."meta_workflow" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: meta_workflow p_meta_wf_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_meta_wf_upd'
      AND n.nspname = 'public'
      AND c.relname = 'meta_workflow'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_meta_wf_upd" ON "public"."meta_workflow" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: notifications p_noti_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_noti_del'
      AND n.nspname = 'public'
      AND c.relname = 'notifications'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_noti_del" ON "public"."notifications" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_superadmin"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: notifications p_noti_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_noti_ins'
      AND n.nspname = 'public'
      AND c.relname = 'notifications'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_noti_ins" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: notifications p_noti_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_noti_sel'
      AND n.nspname = 'public'
      AND c.relname = 'notifications'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_noti_sel" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_superadmin"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: notifications p_noti_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_noti_upd'
      AND n.nspname = 'public'
      AND c.relname = 'notifications'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_noti_upd" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles p_profiles_del_admin; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_profiles_del_admin'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_profiles_del_admin" ON "public"."profiles" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles p_profiles_ins_admin; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_profiles_ins_admin'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_profiles_ins_admin" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles p_profiles_ins_signup; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_profiles_ins_signup'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_profiles_ins_signup" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM "public"."profiles" "profiles_1"
  WHERE ("profiles_1"."id" = "auth"."uid"())))));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles p_profiles_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_profiles_sel'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_profiles_sel" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR ("tenant_id" = "public"."get_my_tenant_id"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles p_profiles_upd_admin; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_profiles_upd_admin'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_profiles_upd_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles p_profiles_upd_self; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_profiles_upd_self'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_profiles_upd_self" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: roles p_roles_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_roles_del'
      AND n.nspname = 'public'
      AND c.relname = 'roles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_roles_del" ON "public"."roles" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: roles p_roles_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_roles_ins'
      AND n.nspname = 'public'
      AND c.relname = 'roles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_roles_ins" ON "public"."roles" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: roles p_roles_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_roles_sel'
      AND n.nspname = 'public'
      AND c.relname = 'roles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_roles_sel" ON "public"."roles" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: roles p_roles_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_roles_upd'
      AND n.nspname = 'public'
      AND c.relname = 'roles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_roles_upd" ON "public"."roles" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: sys_settings p_sys_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_sys_sel'
      AND n.nspname = 'public'
      AND c.relname = 'sys_settings'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_sys_sel" ON "public"."sys_settings" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: sys_settings p_sys_upd; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_sys_upd'
      AND n.nspname = 'public'
      AND c.relname = 'sys_settings'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_sys_upd" ON "public"."sys_settings" FOR UPDATE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles p_user_roles_del; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_user_roles_del'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_user_roles_del" ON "public"."user_roles" FOR DELETE TO "authenticated" USING ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles p_user_roles_ins; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_user_roles_ins'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_user_roles_ins" ON "public"."user_roles" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_superadmin"());
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: user_roles p_user_roles_sel; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'p_user_roles_sel'
      AND n.nspname = 'public'
      AND c.relname = 'user_roles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "p_user_roles_sel" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."get_my_tenant_id"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;

--
-- Name: serial_number_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."serial_number_counters" ENABLE ROW LEVEL SECURITY;

--
-- Name: sys_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sys_settings" ENABLE ROW LEVEL SECURITY;

--
-- Name: serial_number_counters tenant_isolation_serial_counters; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'tenant_isolation_serial_counters'
      AND n.nspname = 'public'
      AND c.relname = 'serial_number_counters'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "tenant_isolation_serial_counters" ON "public"."serial_number_counters" TO "authenticated" USING (("tenant_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'tenant_id'::"text"))::"uuid"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




-- ============================================================
-- SECTION: DIFF FILTER OBJECTS
-- ============================================================
-- Objects that match diff-filter.json but cannot be represented
-- precisely by pg_dump --filter.

-- policy: avatars_delete on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'avatars_delete'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY avatars_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = ''avatars''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: avatars_insert on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'avatars_insert'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY avatars_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = ''avatars''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: avatars_select on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'avatars_select'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY avatars_select ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = ''avatars''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: avatars_update on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'avatars_update'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY avatars_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING ((bucket_id = ''avatars''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: biz_media_auth_delete on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'biz_media_auth_delete'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY biz_media_auth_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = ''biz-media''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: biz_media_auth_insert on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'biz_media_auth_insert'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY biz_media_auth_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = ''biz-media''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: biz_media_auth_update on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'biz_media_auth_update'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY biz_media_auth_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING ((bucket_id = ''biz-media''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: biz_media_public_read on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'biz_media_public_read'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY biz_media_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = ''biz-media''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: logos_authenticated_delete on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'logos_authenticated_delete'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY logos_authenticated_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = ''logos''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: logos_authenticated_insert on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'logos_authenticated_insert'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY logos_authenticated_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = ''logos''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: logos_authenticated_update on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'logos_authenticated_update'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY logos_authenticated_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING ((bucket_id = ''logos''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: logos_public_read on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'logos_public_read'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY logos_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = ''logos''::text));';
  END IF;
END
$pg_schema_restore$;

-- ============================================================
-- SECTION: STORAGE BUCKETS DATA
-- ============================================================

INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES ('avatars', 'avatars', NULL, '2026-09-22 02:51:27.14091+00', '2026-09-22 02:51:27.14091+00', 'true', 'false', NULL, NULL, NULL, 'STANDARD') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "owner" = EXCLUDED."owner", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "public" = EXCLUDED."public", "avif_autodetection" = EXCLUDED."avif_autodetection", "file_size_limit" = EXCLUDED."file_size_limit", "allowed_mime_types" = EXCLUDED."allowed_mime_types", "owner_id" = EXCLUDED."owner_id", "type" = EXCLUDED."type";
INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES ('biz-media', 'biz-media', NULL, '2026-10-21 07:55:39.88124+00', '2026-10-21 07:55:39.88124+00', 'true', 'false', NULL, NULL, NULL, 'STANDARD') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "owner" = EXCLUDED."owner", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "public" = EXCLUDED."public", "avif_autodetection" = EXCLUDED."avif_autodetection", "file_size_limit" = EXCLUDED."file_size_limit", "allowed_mime_types" = EXCLUDED."allowed_mime_types", "owner_id" = EXCLUDED."owner_id", "type" = EXCLUDED."type";
INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES ('logos', 'logos', NULL, '2026-09-18 05:32:43.14204+00', '2026-09-18 05:32:43.14204+00', 'true', 'false', NULL, NULL, NULL, 'STANDARD') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "owner" = EXCLUDED."owner", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "public" = EXCLUDED."public", "avif_autodetection" = EXCLUDED."avif_autodetection", "file_size_limit" = EXCLUDED."file_size_limit", "allowed_mime_types" = EXCLUDED."allowed_mime_types", "owner_id" = EXCLUDED."owner_id", "type" = EXCLUDED."type";

-- ============================================================
-- SECTION: CRON JOBS
-- ============================================================
-- 用户自定义 pg_cron 任务。

