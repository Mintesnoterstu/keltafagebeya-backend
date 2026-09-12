import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  adminRequestUpdateSchema,
  adminNotifySchema,
  adminListQuerySchema,
  adminRejectSellerSchema,
  idParamSchema,
} from '../schemas/admin.schema';
import * as adminController from '../controllers/admin.controller';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/stats', adminController.getAdminStats);

router.get(
  '/requests',
  validate(adminListQuerySchema, 'query'),
  adminController.getAdminRequests
);
router.get(
  '/requests/:id',
  validate(idParamSchema, 'params'),
  adminController.getAdminRequestById
);
router.put(
  '/requests/:id',
  validate(idParamSchema, 'params'),
  validate(adminRequestUpdateSchema),
  adminController.updateAdminRequest
);
router.post(
  '/requests/:id/notify',
  validate(idParamSchema, 'params'),
  validate(adminNotifySchema),
  adminController.notifyAdminRequestCustomer
);

router.get(
  '/sellers',
  validate(adminListQuerySchema, 'query'),
  adminController.getAdminSellers
);
router.get(
  '/sellers/:id',
  validate(idParamSchema, 'params'),
  adminController.getAdminSellerById
);
router.put(
  '/sellers/:id/approve',
  validate(idParamSchema, 'params'),
  adminController.approveSeller
);
router.put(
  '/sellers/:id/reject',
  validate(idParamSchema, 'params'),
  validate(adminRejectSellerSchema),
  adminController.rejectSeller
);

router.get(
  '/orders',
  validate(adminListQuerySchema, 'query'),
  adminController.getAdminOrders
);
router.get(
  '/orders/:id',
  validate(idParamSchema, 'params'),
  adminController.getAdminOrderById
);

export default router;
