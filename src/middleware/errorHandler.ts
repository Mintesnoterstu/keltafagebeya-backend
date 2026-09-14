import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { ApiResponse } from '../types';
import { notifySystemError } from '../services/telegram.service';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: ApiResponse = {
      success: false,
      error: err.message,
      message: err.message,
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiResponse = {
      success: false,
      error: 'Validation failed',
      message: 'Validation failed',
      data: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    };
    res.status(400).json(body);
    return;
  }

  logger.error(err.stack || err.message);

  // Fire-and-forget admin alert for unexpected 500s
  void notifySystemError({
    endpoint: `${req.method} ${req.originalUrl}`,
    error: err.message || 'Unknown error',
  });

  const body: ApiResponse = {
    success: false,
    error: env.isDev ? err.message : 'Internal server error',
    message: env.isDev ? err.message : 'Internal server error',
  };
  res.status(500).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiResponse = {
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  };
  res.status(404).json(body);
}

type RequestSource = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, source: RequestSource = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
