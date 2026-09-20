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
import { sendTelegramNotification } from '../services/telegram.service';
import { env } from '../config/env';

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
    version: '1.0.0',
    build: 'admin-order-fix-2026-09-20',
    timestamp: new Date().toISOString(),
  });
});

/** Verify Telegram admin notifications */
router.get('/test-notification', async (_req, res) => {
  const result = await sendTelegramNotification(
    env.TELEGRAM_ADMIN_CHAT_ID,
    `✅ <b>TEST NOTIFICATION</b>\n` +
      `KeltaFagebeya backend is connected.\n` +
      `Admin chat: <code>${env.TELEGRAM_ADMIN_CHAT_ID}</code>\n` +
      `Time: ${new Date().toISOString()}`
  );

  if (result.ok) {
    res.status(200).json({
      success: true,
      message: 'Test notification sent to admin Telegram',
      data: { chat_id: env.TELEGRAM_ADMIN_CHAT_ID },
    });
    return;
  }

  res.status(502).json({
    success: false,
    message: 'Failed to send test notification',
    error: result.error,
    data: {
      chat_id: env.TELEGRAM_ADMIN_CHAT_ID,
      hint:
        'Open @keltafagebeyaBot and tap Start. On Railway set TELEGRAM_ADMIN_CHAT_ID=8118358536 (8576 is invalid).',
    },
  });
});

export default router;
