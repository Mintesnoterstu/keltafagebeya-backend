import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse } from '../types';
import { createPaymentIntent, handleStripeWebhook } from '../services/stripe.service';
import {
  initializeChapaPayment,
  verifyChapaPayment,
  handleChapaWebhook,
} from '../services/chapa.service';

export async function createStripeIntent(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { order_id } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !order) throw new AppError('Order not found', 404);

    if (order.payment_status === 'completed') {
      throw new AppError('Order already paid', 400);
    }

    const intent = await createPaymentIntent(
      order.id,
      order.total_amount,
      order.currency || 'usd',
      { user_id: req.user.id }
    );

    const body: ApiResponse = {
      success: true,
      data: {
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount: intent.amount,
        currency: intent.currency,
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function stripeWebhook(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const signature = req.headers['stripe-signature'] as string;
    if (!signature) throw new AppError('Missing Stripe signature', 400);

    await handleStripeWebhook(req.body as Buffer, signature);

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}

export async function initializeChapa(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { order_id, email, first_name, last_name, phone } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !order) throw new AppError('Order not found', 404);

    if (order.payment_status === 'completed') {
      throw new AppError('Order already paid', 400);
    }

    const result = await initializeChapaPayment({
      orderId: order.id,
      amount: order.total_amount,
      currency: order.currency || 'ETB',
      email: email || `${req.user.telegram_id}@telegram.user`,
      firstName: first_name || req.user.first_name,
      lastName: last_name || req.user.last_name || 'User',
      phone: phone || req.user.phone || undefined,
    });

    await supabase
      .from('orders')
      .update({ payment_method: 'chapa' })
      .eq('id', order.id);

    const body: ApiResponse = {
      success: true,
      data: {
        checkout_url: result.checkoutUrl,
        tx_ref: result.txRef,
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function chapaWebhook(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await handleChapaWebhook(req.body);
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}

export async function verifyChapa(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;
    const result = await verifyChapaPayment(id);

    const body: ApiResponse = {
      success: true,
      data: result,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
