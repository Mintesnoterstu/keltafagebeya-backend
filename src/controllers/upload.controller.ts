import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import { ApiResponse } from '../types';
import { uploadImage } from '../services/cloudinary.service';

export async function uploadProductImage(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const file = req.file;
    if (!file) {
      throw new AppError('No image file provided', 400);
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      throw new AppError('Only JPEG, PNG, WebP, and GIF images are allowed', 400);
    }

    const result = await uploadImage(file.buffer, 'keltafagebeya/products');

    const body: ApiResponse = {
      success: true,
      message: 'Image uploaded',
      data: {
        url: result.url,
        public_id: result.publicId,
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function uploadMultipleImages(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      throw new AppError('No image files provided', 400);
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const uploads = [];

    for (const file of files) {
      if (!allowed.includes(file.mimetype)) {
        throw new AppError(`Invalid file type: ${file.originalname}`, 400);
      }
      const result = await uploadImage(file.buffer, 'keltafagebeya/products');
      uploads.push({
        url: result.url,
        public_id: result.publicId,
      });
    }

    const body: ApiResponse = {
      success: true,
      message: `${uploads.length} image(s) uploaded`,
      data: uploads,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
