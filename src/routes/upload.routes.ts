import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireSeller } from '../middleware/auth';
import * as uploadController from '../controllers/upload.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

const router = Router();

router.use(authenticate);

router.post(
  '/image',
  requireSeller,
  upload.single('image'),
  uploadController.uploadProductImage
);

router.post(
  '/images',
  requireSeller,
  upload.array('images', 5),
  uploadController.uploadMultipleImages
);

export default router;
