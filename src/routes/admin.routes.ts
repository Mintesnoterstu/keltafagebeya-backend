import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  adminRequestUpdateSchema,
  adminNotifySchema,
  adminListQuerySchema,
  adminRejectSellerSchema,
  idParamSchema,
  orderIdParamSchema,
  adminOrderStatusSchema,
  sellerPermissionsSchema,
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

// Frontend uses PATCH; also keep PUT
const updateRequestHandlers = [
  validate(idParamSchema, 'params'),
  validate(adminRequestUpdateSchema),
  adminController.updateAdminRequest,
] as const;
router.put('/requests/:id', ...updateRequestHandlers);
router.patch('/requests/:id', ...updateRequestHandlers);

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

// Frontend uses POST; also keep PUT
const approveHandlers = [
  validate(idParamSchema, 'params'),
  adminController.approveSeller,
] as const;
router.put('/sellers/:id/approve', ...approveHandlers);
router.post('/sellers/:id/approve', ...approveHandlers);

const rejectHandlers = [
  validate(idParamSchema, 'params'),
  validate(adminRejectSellerSchema),
  adminController.rejectSeller,
] as const;
router.put('/sellers/:id/reject', ...rejectHandlers);
router.post('/sellers/:id/reject', ...rejectHandlers);

router.get(
  '/orders',
  validate(adminListQuerySchema, 'query'),
  adminController.getAdminOrders
);
router.get(
  '/orders/:id',
  validate(orderIdParamSchema, 'params'),
  adminController.getAdminOrderById
);
router.patch(
  '/orders/:id',
  validate(orderIdParamSchema, 'params'),
  validate(adminOrderStatusSchema),
  adminController.updateAdminOrderStatus
);
router.put(
  '/orders/:id',
  validate(orderIdParamSchema, 'params'),
  validate(adminOrderStatusSchema),
  adminController.updateAdminOrderStatus
);
router.put(
  '/sellers/:id/permissions',
  validate(idParamSchema, 'params'),
  validate(sellerPermissionsSchema),
  adminController.updateSellerPermissions
);
router.patch(
  '/sellers/:id/permissions',
  validate(idParamSchema, 'params'),
  validate(sellerPermissionsSchema),
  adminController.updateSellerPermissions
);

export default router;
