import Stripe from 'stripe';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { notifyOrderStatusChange } from './telegram.service';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export async function createPaymentIntent(
  orderId: string,
  amount: number,
  currency: string,
  metadata: Record<string, string> = {}
): Promise<Stripe.PaymentIntent> {
  // Stripe expects amounts in smallest currency unit (cents).
  // ETB is zero-decimal in some contexts; we use cents (x100) for USD-like currencies.
  const zeroDecimal = ['jpy', 'krw', 'vnd'];
  const unitAmount = zeroDecimal.includes(currency.toLowerCase())
    ? Math.round(amount)
    : Math.round(amount * 100);

  const intent = await stripe.paymentIntents.create({
    amount: unitAmount,
    currency: currency.toLowerCase(),
    metadata: {
      order_id: orderId,
      ...metadata,
    },
    automatic_payment_methods: { enabled: true },
  });

  await supabase
    .from('orders')
    .update({ payment_id: intent.id })
    .eq('id', orderId);

  return intent;
}

export async function handleStripeWebhook(
  payload: Buffer,
  signature: string
): Promise<void> {
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error(`Stripe webhook signature verification failed: ${err}`);
    throw new AppError('Invalid Stripe webhook signature', 400);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markOrderPaid(intent.id, intent.metadata.order_id);
      break;
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markOrderPaymentFailed(intent.id, intent.metadata.order_id);
      break;
    }
    default:
      logger.debug(`Unhandled Stripe event: ${event.type}`);
  }
}

async function markOrderPaid(
  paymentId: string,
  orderId?: string
): Promise<void> {
  let query = supabase.from('orders').select('*, users(telegram_id, id, first_name)');

  if (orderId) {
    query = query.eq('id', orderId);
  } else {
    query = query.eq('payment_id', paymentId);
  }

  const { data: order, error } = await query.single();

  if (error || !order) {
    logger.error(`Order not found for Stripe payment ${paymentId}`);
    return;
  }

  await supabase
    .from('orders')
    .update({
      payment_status: 'completed',
      status: 'confirmed',
      payment_id: paymentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  const user = order.users as { telegram_id: number; id: string } | null;
  if (user) {
    await notifyOrderStatusChange(user.telegram_id, user.id, order.id, 'confirmed');
  }

  logger.info(`Order ${order.id} marked as paid via Stripe`);
}

async function markOrderPaymentFailed(
  paymentId: string,
  orderId?: string
): Promise<void> {
  let query = supabase.from('orders').update({
    payment_status: 'failed',
    updated_at: new Date().toISOString(),
  });

  if (orderId) {
    query = query.eq('id', orderId);
  } else {
    query = query.eq('payment_id', paymentId);
  }

  await query;
  logger.warn(`Stripe payment failed for ${paymentId}`);
}
