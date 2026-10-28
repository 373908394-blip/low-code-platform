import { useRef, useState } from 'react';
import { Paperclip, Image as ImageIcon, X, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { uploadImage, type UploadStage } from '@/lib/image-upload';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  type: 'image' | 'attachment';
  value: unknown; // string[]（URL 数组）
  onChange: (v: string[]) => void;
  maxCount?: number;
  disabled?: boolean;
  bucket: string;
}

/** 图片/附件上传组件：支持多文件、进度提示、自动压缩（图片超 1MB 时） */
export function MediaUploadField({ type, value, onChange, maxCount = 1, disabled, bucket }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const urls: string[] = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
  const canAdd = urls.length < maxCount;

  const pick = () => { if (!disabled && !uploading && canAdd) inputRef.current?.click(); };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = maxCount - urls.length;
    const list = Array.from(files).slice(0, remaining);
    if (list.length < files.length) toast.info(`最多上传 ${maxCount} 个文件，已截取前 ${list.length} 个`);
    setUploading(true);
    for (const file of list) {
      try {
        if (type === 'image') {
          const r = await uploadImage(file, bucket, setStage);
          onChange([...urls, r.url]);
          toast.success(r.compressed ? `已压缩上传（${r.sizeKb}KB）` : '图片上传成功');
        } else {
          setStage('uploading');
          const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
          const safeName = `${Date.now()}${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error } = await supabase.storage.from(bucket).upload(safeName, file, { upsert: true });
          if (error) throw new Error('上传失败：' + error.message);
          const { data } = supabase.storage.from(bucket).getPublicUrl(safeName);
          onChange([...urls, data.publicUrl]);
          toast.success('附件上传成功');
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '上传失败');
      }
    }
    setUploading(false);
    setStage(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (idx: number) => {
    onChange(urls.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={type === 'image' ? 'image/jpeg,image/png,image/gif,image/webp,image/avif' : '*/*'}
        multiple={maxCount > 1}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {urls.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', type === 'image' && 'grid grid-cols-3 gap-2')}>
          {urls.map((url, i) => (
            <div key={i} className="relative group">
              {type === 'image' ? (
                <div className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted">
                  <img src={url} alt={`图片 ${i + 1}`} className="h-full w-full object-cover" />
                  {!disabled && (
                    <button type="button" onClick={() => remove(i)} className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs max-w-40">
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <a href={url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline flex-1 min-w-0">
                    {decodeURIComponent(url.split('/').pop() ?? `附件 ${i + 1}`)}
                  </a>
                  {!disabled && (
                    <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-foreground shrink-0">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canAdd && !disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full h-9 text-xs border-dashed"
          onClick={pick}
          disabled={uploading}
        >
          {uploading ? (
            <span className="flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5 animate-pulse" />
              {stage === 'compressing' ? '压缩中…' : stage === 'uploading' ? '上传中…' : '处理中…'}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              {type === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
              {type === 'image' ? '上传图片' : '上传附件'}
              {maxCount > 1 && `（${urls.length}/${maxCount}）`}
            </span>
          )}
        </Button>
      )}
      {disabled && urls.length === 0 && (
        <p className="text-xs text-muted-foreground">无可显示内容</p>
      )}
    </div>
  );
}
