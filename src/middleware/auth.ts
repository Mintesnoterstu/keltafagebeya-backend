import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AuthRequest, JwtPayload, User } from '../types';
import { AppError } from '../utils/AppError';

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

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', payload.userId)
      .single();

    if (error || !user) {
      throw new AppError('User not found', 401);
    }

    req.user = user as User;
    req.userId = user.id;
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

export function requireSeller(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user?.is_seller && req.user?.role !== 'admin') {
    next(new AppError('Seller access required', 403));
    return;
  }
  next();
}

export function requireAdmin(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== 'admin') {
    next(new AppError('Admin access required', 403));
    return;
  }
  next();
}

/** Type helper so controllers can treat req as AuthRequest */
export type { AuthRequest, Request };
