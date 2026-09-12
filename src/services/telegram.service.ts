import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { supabase } from '../config/supabase';

const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML'
): Promise<boolean> {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    });
    return true;
  } catch (err) {
    logger.error(`Failed to send Telegram message to ${chatId}: ${err}`);
    return false;
  }
}

export async function notifyAdmin(text: string): Promise<void> {
  await sendTelegramMessage(env.TELEGRAM_ADMIN_CHAT_ID, text);
}

export async function notifyUser(
  telegramId: number,
  text: string
): Promise<void> {
  await sendTelegramMessage(telegramId, text);
}

export async function createInAppNotification(
  userId: string,
  title: string,
  message: string,
  type: string,
  data?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    title,
    message,
    type,
    is_read: false,
    data: data ?? null,
  });

  if (error) {
    logger.error(`Failed to create notification: ${error.message}`);
  }
}

export async function notifyNewOrder(
  orderId: string,
  totalAmount: number,
  currency: string,
  buyerName: string
): Promise<void> {
  await notifyAdmin(
    `🛒 <b>New Order</b>\n` +
      `Order: <code>${orderId}</code>\n` +
      `Buyer: ${buyerName}\n` +
      `Total: ${totalAmount} ${currency}`
  );
}

export async function notifyOrderStatusChange(
  telegramId: number,
  userId: string,
  orderId: string,
  status: string
): Promise<void> {
  const message = `📦 Your order <code>${orderId.slice(0, 8)}</code> is now <b>${status}</b>.`;

  await notifyUser(telegramId, message);
  await createInAppNotification(
    userId,
    'Order Update',
    `Your order status changed to ${status}`,
    'order_status',
    { order_id: orderId, status }
  );
}

export async function notifyNewRequest(
  requestId: string,
  title: string,
  userName: string
): Promise<void> {
  await notifyAdmin(
    `📝 <b>New Product Request</b>\n` +
      `Request: <code>${requestId}</code>\n` +
      `Title: ${title}\n` +
      `From: ${userName}`
  );
}

export async function notifyRequestStatusChange(
  telegramId: number,
  userId: string,
  requestId: string,
  status: string
): Promise<void> {
  const message = `📋 Your product request <code>${requestId.slice(0, 8)}</code> is now <b>${status}</b>.`;

  await notifyUser(telegramId, message);
  await createInAppNotification(
    userId,
    'Request Update',
    `Your product request status changed to ${status}`,
    'request_status',
    { request_id: requestId, status }
  );
}

export async function notifyCustomMessage(
  telegramId: number,
  userId: string,
  message: string,
  title = 'Message from KeltaFagebeya'
): Promise<void> {
  await notifyUser(telegramId, message);
  await createInAppNotification(userId, title, message, 'custom');
}

export async function notifyNewSellerApplication(
  applicationId: string,
  businessName: string,
  userName: string
): Promise<void> {
  await notifyAdmin(
    `🏪 <b>New Seller Application</b>\n` +
      `ID: <code>${applicationId}</code>\n` +
      `Business: ${businessName}\n` +
      `Applicant: ${userName}`
  );
}

export async function notifySellerApplicationDecision(
  telegramId: number,
  userId: string,
  approved: boolean,
  notes?: string | null
): Promise<void> {
  const message = approved
    ? `🎉 Your seller application was <b>approved</b>! You can now list products on KeltaFagebeya.`
    : `❌ Your seller application was <b>rejected</b>.${notes ? `\nNotes: ${notes}` : ''}`;

  await notifyUser(telegramId, message);
  await createInAppNotification(
    userId,
    approved ? 'Seller Approved' : 'Seller Rejected',
    approved
      ? 'Your seller application was approved'
      : 'Your seller application was rejected',
    'seller_application',
    { approved, notes: notes ?? null }
  );
}

export async function notifySellerNewOrder(
  telegramId: number,
  orderId: string,
  itemCount: number
): Promise<void> {
  await notifyUser(
    telegramId,
    `🛒 New order <code>${orderId.slice(0, 8)}</code> includes <b>${itemCount}</b> of your product(s).`
  );
}
