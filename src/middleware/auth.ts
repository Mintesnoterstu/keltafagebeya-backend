import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AuthRequest, JwtPayload, User, isAdminRole, isSellerRole } from '../types';
import { AppError } from '../utils/AppError';

async function loadUser(userId: string): Promise<User> {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw new AppError('User not found', 401);
  }

  return user as User;
}

function isEnvAdmin(user: User): boolean {
  return String(user.telegram_id) === String(env.TELEGRAM_ADMIN_CHAT_ID);
}

export async function authenticate(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401);
    }

    const token = header.slice(7);
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const user = await loadUser(payload.userId);

    // Promote Telegram admin chat owner if not yet flagged in DB
    if (isEnvAdmin(user) && user.role !== 'admin') {
      const { data: promoted } = await supabase
        .from('users')
        .update({ role: 'admin' })
        .eq('id', user.id)
        .select()
        .single();
      req.user = (promoted as User) || { ...user, role: 'admin' };
    } else {
      req.user = user;
    }

    req.userId = req.user.id;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('Invalid or expired token', 401));
  }
}

export function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }

  authenticate(req, _res, next).catch(next);
}

export function requireAdmin(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    next(new AppError('Authentication required', 401));
    return;
  }

  const admin =
    isAdminRole(req.user.role) || isEnvAdmin(req.user);

  if (!admin) {
    next(new AppError('Admin access required', 403));
    return;
  }

  req.user.isAdmin = true;
  next();
}

export function requireSeller(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    next(new AppError('Authentication required', 401));
    return;
  }

  const seller =
    isSellerRole(req.user.role, req.user.is_seller) ||
    req.user.seller_status === 'approved' ||
    isAdminRole(req.user.role) ||
    isEnvAdmin(req.user);

  if (!seller) {
    next(new AppError('Seller access required', 403));
    return;
  }

  req.user.isSeller = true;
  next();
}

/**
 * Factory: ensures the authenticated user owns a resource loaded earlier,
 * or is an admin. Controllers typically do ownership checks inline;
 * use this when `req.params.userId` / seller_id must match.
 */
export function requireOwner(paramKey: string = 'userId') {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    if (isAdminRole(req.user.role) || isEnvAdmin(req.user)) {
      req.user.isAdmin = true;
      next();
      return;
    }

    const ownerId = req.params[paramKey] || (req as AuthRequest & { resourceOwnerId?: string }).resourceOwnerId;
    if (!ownerId || ownerId !== req.user.id) {
      next(new AppError('Not authorized to access this resource', 403));
      return;
    }

    next();
  };
}

export type { AuthRequest, Request };
