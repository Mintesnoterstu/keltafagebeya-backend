import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { notifyOrderStatusChange } from './telegram.service';

const CHAPA_BASE = 'https://api.chapa.co/v1';

interface ChapaInitializeParams {
  orderId: string;
  amount: number;
  currency: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

interface ChapaInitializeResponse {
  status: string;
  message: string;
  data: {
    checkout_url: string;
  };
}

interface ChapaVerifyResponse {
  status: string;
  message: string;
  data: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    tx_ref: string;
  };
}

function chapaHeaders() {
  return {
    Authorization: `Bearer ${env.CHAPA_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function initializeChapaPayment(
  params: ChapaInitializeParams
): Promise<{ checkoutUrl: string; txRef: string }> {
  const txRef = `kelt-${params.orderId.slice(0, 8)}-${Date.now()}`;

  try {
    const { data } = await axios.post<ChapaInitializeResponse>(
      `${CHAPA_BASE}/transaction/initialize`,
      {
        amount: params.amount.toString(),
        currency: params.currency || 'ETB',
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        phone_number: params.phone,
        tx_ref: txRef,
        callback_url: `${env.FRONTEND_URL}/payment/chapa/callback`,
        return_url: `${env.FRONTEND_URL}/payment/success?order_id=${params.orderId}`,
        customization: {
          title: 'KeltaFagebeya',
          description: `Order payment ${params.orderId.slice(0, 8)}`,
        },
        meta: {
          order_id: params.orderId,
        },
      },
      { headers: chapaHeaders() }
    );

    if (data.status !== 'success') {
      throw new AppError(data.message || 'Chapa initialization failed', 502);
    }

    await supabase
      .from('orders')
      .update({ payment_id: txRef })
      .eq('id', params.orderId);

    return {
      checkoutUrl: data.data.checkout_url,
      txRef,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(`Chapa initialize error: ${err}`);
    throw new AppError('Failed to initialize Chapa payment', 502);
  }
}

export async function verifyChapaPayment(txRef: string): Promise<ChapaVerifyResponse['data']> {
  try {
    const { data } = await axios.get<ChapaVerifyResponse>(
      `${CHAPA_BASE}/transaction/verify/${txRef}`,
      { headers: chapaHeaders() }
    );

    if (data.status !== 'success') {
      throw new AppError(data.message || 'Chapa verification failed', 400);
    }

    if (data.data.status === 'success') {
      await markChapaOrderPaid(txRef);
    }

    return data.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(`Chapa verify error: ${err}`);
    throw new AppError('Failed to verify Chapa payment', 502);
  }
}

export async function handleChapaWebhook(
  body: {
    trx_ref?: string;
    tx_ref?: string;
    status?: string;
    [key: string]: unknown;
  },
  signatureHeader?: string
): Promise<void> {
  if (env.CHAPA_WEBHOOK_SECRET) {
    if (!signatureHeader) {
      throw new AppError('Missing x-chapa-signature header', 401);
    }

    const payload =
      typeof body === 'string' ? body : JSON.stringify(body);
    const expected = crypto
      .createHmac('sha256', env.CHAPA_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    const provided = signatureHeader.replace(/^sha256=/i, '');
    const valid =
      expected.length === provided.length &&
      crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(provided)
      );

    if (!valid) {
      throw new AppError('Invalid Chapa webhook signature', 401);
    }
  }

  const txRef = body.trx_ref || body.tx_ref;
  const status = body.status;

  if (!txRef) {
    throw new AppError('Missing transaction reference', 400);
  }

  if (status === 'success' || status === 'successful') {
    await markChapaOrderPaid(txRef);
  } else {
    await supabase
      .from('orders')
      .update({
        payment_status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('payment_id', txRef);

    logger.warn(`Chapa payment failed for ${txRef}`);
  }
}

async function markChapaOrderPaid(txRef: string): Promise<void> {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, users(telegram_id, id)')
    .eq('payment_id', txRef)
    .single();

  if (error || !order) {
    logger.error(`Order not found for Chapa tx ${txRef}`);
    return;
  }

  if (order.payment_status === 'completed') {
    return;
  }

    await supabase
    .from('orders')
    .update({
      payment_status: 'completed',
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  const user = order.users as { telegram_id: number; id: string } | null;
  if (user) {
    await notifyOrderStatusChange(user.telegram_id, user.id, order.id, 'confirmed');
  }

  logger.info(`Order ${order.id} marked as paid via Chapa`);
}
