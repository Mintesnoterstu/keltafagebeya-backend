import { Router } from 'express';
import authRoutes from './auth.routes';
import productsRoutes from './products.routes';
import cartRoutes from './cart.routes';
import ordersRoutes from './orders.routes';
import requestsRoutes from './requests.routes';
import paymentsRoutes from './payments.routes';
import sellerRoutes from './seller.routes';
import adminRoutes from './admin.routes';
import uploadRoutes from './upload.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productsRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', ordersRoutes);
router.use('/requests', requestsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/seller', sellerRoutes);
router.use('/admin', adminRoutes);
router.use('/upload', uploadRoutes);

router.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'KeltaFagebeya API is healthy',
    timestamp: new Date().toISOString(),
  });
});

export default router;
