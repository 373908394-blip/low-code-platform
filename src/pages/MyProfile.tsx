import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { Department } from '@/types';
import { fmtDate, PHONE_RE } from '@/lib/field-catalog';
import { uploadImage, type UploadStage } from '@/lib/image-upload';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Save, Upload, User } from 'lucide-react';

const STAGE_TEXT: Record<UploadStage, string> = { checking: '检查中…', compressing: '压缩中…', uploading: '上传中…' };

export default function MyProfile() {
  const { profile, refreshProfile } = useAuth();
  const userId = profile?.id ?? '';
  const tenantId = profile?.tenant_id ?? '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [form, setForm] = useState({
    avatar_url: '',
    gender: '男',
    phone: '',
    emergency_contact: '',
    emergency_contact_phone: '',
  });
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarStage, setAvatarStage] = useState<UploadStage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, dRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      profile?.department_id
        ? supabase.from('departments').select('name').eq('id', profile.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const p = pRes.data as ReturnType<typeof Object> | null;
    if (p) {
      const d = p as Record<string, unknown>;
      setForm({
        avatar_url: (d.avatar_url as string) ?? '',
        gender: (d.gender as string) ?? '男',
        phone: (d.phone as string) ?? '',
        emergency_contact: (d.emergency_contact as string) ?? '',
        emergency_contact_phone: (d.emergency_contact_phone as string) ?? '',
      });
    }
    setDeptName(((dRes.data as { name: string } | null)?.name) ?? '');
    setLoading(false);
  }, [userId, profile?.department_id]);

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarUploading(true);
    setAvatarStage('checking');
    try {
      const { url, compressed, sizeKb } = await uploadImage(file, 'avatars', setAvatarStage);
      setForm((f) => ({ ...f, avatar_url: url }));
      toast.success(compressed ? `头像已上传（自动压缩至 ${sizeKb}KB），记得保存` : `头像已上传（${sizeKb}KB），记得保存`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setAvatarUploading(false);
      setAvatarStage(null);
    }
  };

  const save = async () => {
    if (!PHONE_RE.test(form.phone.trim())) return toast.error('请输入有效的 11 位手机号码');
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      avatar_url: form.avatar_url || null,
      gender: form.gender || '男',
      phone: form.phone || null,
      emergency_contact: form.emergency_contact || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
    }).eq('id', userId);
    setSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    await refreshProfile?.();
    toast.success('个人信息已保存');
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const ro = (label: string, value: string | null | undefined) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="h-9 flex items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
        {value && value.trim() !== '' ? value : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">我的信息</h1>
        <p className="text-sm text-muted-foreground mt-1">查看与维护当前账号的员工档案信息</p>
      </div>

      {/* 头像 */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-5">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted/40 flex items-center justify-center">
              {form.avatar_url ? (
                <img src={form.avatar_url} alt="头像" className="h-full w-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-muted-foreground/50" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <label>
                  <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" className="hidden" onChange={uploadAvatar} disabled={avatarUploading} />
                  <span className={`inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3.5 text-sm font-medium transition-colors cursor-pointer hover:bg-muted ${avatarUploading ? 'pointer-events-none opacity-60' : ''}`}>
                    {avatarUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {avatarStage ? STAGE_TEXT[avatarStage] : '上传头像'}
                  </span>
                </label>
                {form.avatar_url && (
                  <Button variant="outline" onClick={() => setForm((f) => ({ ...f, avatar_url: '' }))}>移除</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">支持 JPEG / PNG / GIF / WEBP / AVIF，超过 1MB 自动压缩</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 只读信息 */}
      <Card className="mb-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">档案信息（只读）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ro('姓名', profile?.name)}
            {ro('邮箱', profile?.email)}
            {ro('所属部门', deptName)}
            {ro('所属职位', profile?.position)}
            {ro('入职日期', profile?.hire_date ? fmtDate(profile.hire_date) : '')}
            {ro('教育程度', profile?.education)}
            {ro('身份证号', profile?.id_card)}
            {ro('社保转入日期', profile?.social_security_transfer_date ? fmtDate(profile.social_security_transfer_date) : '')}
            {ro('公积金转入日期', profile?.housing_fund_transfer_date ? fmtDate(profile.housing_fund_transfer_date) : '')}
          </div>
        </CardContent>
      </Card>

      {/* 可编辑信息 */}
      <Card className="mb-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">可编辑信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">性别</Label>
              <Select value={form.gender || '男'} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="男">男</SelectItem>
                  <SelectItem value="女">女</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">手机号</Label>
              <Input className="h-9 px-2" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="请输入 11 位手机号" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">紧急联络人</Label>
              <Input className="h-9 px-2" value={form.emergency_contact} onChange={(e) => setForm((f) => ({ ...f, emergency_contact: e.target.value }))} placeholder="选填" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">联络人电话</Label>
              <Input className="h-9 px-2" value={form.emergency_contact_phone} onChange={(e) => setForm((f) => ({ ...f, emergency_contact_phone: e.target.value }))} placeholder="选填" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Save className="mr-1.5 h-4 w-4" />保存信息</Button>
      </div>
    </div>
  );
}