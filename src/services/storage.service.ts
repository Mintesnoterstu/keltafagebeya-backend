import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';

const BUCKET = 'product-images';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateImageFile(file: Express.Multer.File): void {
  if (!ALLOWED.has(file.mimetype)) {
    throw new AppError('Only JPEG, PNG, and WebP images are allowed', 400);
  }
  if (file.size > MAX_BYTES) {
    throw new AppError('Image must be 5MB or smaller', 400);
  }
}

export async function uploadProductImageToStorage(
  file: Express.Multer.File,
  sellerId: string
): Promise<string> {
  validateImageFile(file);

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${sellerId}/${Date.now()}-${safeName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error || !data) {
    logger.error(`Supabase storage upload failed: ${error?.message}`);
    throw new AppError('Failed to upload image', 502);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData.publicUrl;
}

export async function uploadMultipleProductImages(
  files: Express.Multer.File[],
  sellerId: string
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    urls.push(await uploadProductImageToStorage(file, sellerId));
  }
  return urls;
}
