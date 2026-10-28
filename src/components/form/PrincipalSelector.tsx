import type { PrincipalGroup } from '@/types';
import EntityPicker from './EntityPicker';

interface Props {
  value?: PrincipalGroup;
  onChange: (v: PrincipalGroup) => void;
  members: { id: string; name: string; position?: string | null }[];
  departments: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}

/** 主体范围选择器：分别从人员/部门/角色中选择，用于发起人、抄送等配置 */
export default function PrincipalSelector({ value, onChange, members, departments, roles }: Props) {
  const g: PrincipalGroup = value ?? { users: [], depts: [], roles: [] };
  const set = (patch: Partial<PrincipalGroup>) => onChange({ ...g, ...patch });

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">人员</p>
        <EntityPicker
          options={members.map((m) => ({ id: m.id, label: m.name, sub: m.position ?? undefined }))}
          value={g.users}
          multi
          onChange={(v) => set({ users: Array.isArray(v) ? (v as string[]) : [] })}
          placeholder="选择人员（可多选）"
        />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">部门</p>
        <EntityPicker
          options={departments.map((d) => ({ id: d.id, label: d.name }))}
          value={g.depts}
          multi
          onChange={(v) => set({ depts: Array.isArray(v) ? (v as string[]) : [] })}
          placeholder="选择部门（可多选）"
        />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">角色</p>
        <EntityPicker
          options={roles.map((r) => ({ id: r.id, label: r.name }))}
          value={g.roles}
          multi
          onChange={(v) => set({ roles: Array.isArray(v) ? (v as string[]) : [] })}
          placeholder="选择角色（可多选）"
        />
      </div>
    </div>
  );
}