import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { supabase } from '../config/supabase';

const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
    logger.info(`Telegram message sent to ${chatId}`);
    return true;
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data || err.message)
      : String(err);
    logger.error(`Failed to send Telegram message to ${chatId}: ${detail}`);
    return false;
  }
}

export async function notifyAdmin(text: string): Promise<boolean> {
  return sendTelegramMessage(env.TELEGRAM_ADMIN_CHAT_ID, text);
}

export async function notifyUser(
  telegramId: number,
  text: string
): Promise<boolean> {
  return sendTelegramMessage(telegramId, text);
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
  const adminUrl = `${env.FRONTEND_URL}/admin/orders/${orderId}`;
  const sent = await notifyAdmin(
    `🛒 <b>New Order</b>\n` +
      `Order: <code>${escapeHtml(orderId)}</code>\n` +
      `Buyer: ${escapeHtml(buyerName)}\n` +
      `Total: ${totalAmount} ${escapeHtml(currency)}\n` +
      `<a href="${adminUrl}">Open in admin</a>`
  );
  if (!sent) {
    logger.error(`Admin was NOT notified about order ${orderId}`);
  }
}

export async function notifyOrderStatusChange(
  telegramId: number,
  userId: string,
  orderId: string,
  status: string
): Promise<void> {
  const message = `📦 Your order <code>${orderId.slice(0, 8)}</code> is now <b>${escapeHtml(status)}</b>.`;

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
  userName: string,
  options?: {
    urgency?: string | null;
    description?: string | null;
    category?: string | null;
  }
): Promise<void> {
  const adminUrl = `${env.FRONTEND_URL}/admin/requests/${requestId}`;
  const desc = options?.description
    ? `\nDescription: ${escapeHtml(options.description.slice(0, 300))}`
    : '';
  const urgency = options?.urgency || 'normal';
  const category = options?.category
    ? `\nCategory: ${escapeHtml(options.category)}`
    : '';

  const sent = await notifyAdmin(
    `📝 <b>New Product Request</b>\n` +
      `Request: <code>${escapeHtml(requestId)}</code>\n` +
      `Title: ${escapeHtml(title)}\n` +
      `From: ${escapeHtml(userName)}\n` +
      `Urgency: <b>${escapeHtml(urgency)}</b>` +
      category +
      desc +
      `\n<a href="${adminUrl}">Open in admin</a>`
  );

  if (!sent) {
    logger.error(`Admin was NOT notified about request ${requestId}`);
  }
}

export async function notifyRequestStatusChange(
  telegramId: number,
  userId: string,
  requestId: string,
  status: string
): Promise<void> {
  const message = `📋 Your product request <code>${requestId.slice(0, 8)}</code> is now <b>${escapeHtml(status)}</b>.`;

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
  userName: string,
  businessType?: string
): Promise<void> {
  const adminUrl = `${env.FRONTEND_URL}/admin/sellers/${applicationId}`;
  const sent = await notifyAdmin(
    `🏪 <b>New Seller Application</b>\n` +
      `ID: <code>${escapeHtml(applicationId)}</code>\n` +
      `Business: ${escapeHtml(businessName)}\n` +
      `Applicant: ${escapeHtml(userName)}\n` +
      (businessType ? `Type: ${escapeHtml(businessType)}\n` : '') +
      `<a href="${adminUrl}">Open in admin</a>`
  );
  if (!sent) {
    logger.error(`Admin was NOT notified about seller application ${applicationId}`);
  }
}

export async function notifySellerApplicationDecision(
  telegramId: number,
  userId: string,
  approved: boolean,
  notes?: string | null
): Promise<void> {
  const dashboard = `${env.FRONTEND_URL}/seller`;
  const message = approved
    ? `🎉 Your seller application was <b>approved</b>!\nYou can now list products on KeltaFagebeya.\n<a href="${dashboard}">Open seller dashboard</a>`
    : `❌ Your seller application was <b>rejected</b>.${notes ? `\nNotes: ${escapeHtml(notes)}` : ''}`;

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
