import { supabase } from '@/db/supabase';

/** 通用图片上传：格式校验 → 超 1MB 自动压缩（WEBP / 1080p / q0.8 递降）→ Storage 上传 */
export interface UploadResult {
  url: string;
  compressed: boolean;
  sizeKb: number;
}

export type UploadStage = 'checking' | 'compressing' | 'uploading';

const MAX_BYTES = 1024 * 1024; // 1MB
const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];

export async function uploadImage(
  file: File,
  bucket: string,
  onStage?: (stage: UploadStage) => void,
): Promise<UploadResult> {
  if (!ACCEPTED.includes(file.type)) throw new Error('仅支持 JPEG / PNG / GIF / WEBP / AVIF 格式');
  onStage?.('checking');
  let finalFile = file;
  let compressed = false;
  if (file.size > MAX_BYTES) {
    onStage?.('compressing');
    finalFile = await compressImage(file);
    compressed = true;
  }
  onStage?.('uploading');
  const ext = finalFile.type === 'image/webp'
    ? 'webp'
    : (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const name = `${Date.now()}${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(name, finalFile, { upsert: true });
  if (error) throw new Error('上传失败：' + error.message);
  const { data } = supabase.storage.from(bucket).getPublicUrl(name);
  return { url: data.publicUrl, compressed, sizeKb: Math.round(finalFile.size / 1024) };
}

/** 超限压缩：canvas 转 WEBP，最长边压到 1920（1080p），质量 0.8 起步递降 */
async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  let quality = 0.8;
  let blob = await toWebp(canvas, quality);
  while (blob.size > MAX_BYTES && quality > 0.3) {
    quality -= 0.15;
    blob = await toWebp(canvas, quality);
  }
  if (blob.size > MAX_BYTES) throw new Error('图片过大，自动压缩后仍超过 1MB，请更换图片');
  return new File([blob], 'image.webp', { type: 'image/webp' });
}

function toWebp(canvas: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/webp', q);
  });
}
