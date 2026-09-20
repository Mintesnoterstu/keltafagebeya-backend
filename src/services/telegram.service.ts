import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { supabase } from '../config/supabase';

const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Core sender — never throws. */
export async function sendTelegramNotification(
  chatId: string | number,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data } = await axios.post(
      `${TELEGRAM_API}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 10000 }
    );

    if (!data?.ok) {
      const err = JSON.stringify(data);
      logger.error(`Telegram API rejected message to ${chatId}: ${err}`);
      return { ok: false, error: err };
    }

    logger.info(`Telegram OK → chat ${chatId}`);
    return { ok: true };
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data || err.message)
      : String(err);
    logger.error(`Telegram FAIL → chat ${chatId}: ${detail}`);
    return { ok: false, error: detail };
  }
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<boolean> {
  return (await sendTelegramNotification(chatId, text)).ok;
}

export async function notifyAdmin(text: string): Promise<boolean> {
  const result = await sendTelegramNotification(
    env.TELEGRAM_ADMIN_CHAT_ID,
    text
  );
  if (!result.ok) {
    logger.error(
      `ADMIN NOTIFY FAILED (chat=${env.TELEGRAM_ADMIN_CHAT_ID}): ${result.error}`
    );
  }
  return result.ok;
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
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      title,
      message,
      type,
      is_read: false,
      data: data ?? null,
    });
    if (error) logger.error(`In-app notification failed: ${error.message}`);
  } catch (err) {
    logger.error(`In-app notification exception: ${err}`);
  }
}

export async function notifyNewUser(params: {
  name: string;
  username?: string | null;
  telegramId: number;
}): Promise<void> {
  await notifyAdmin(
    `🆕 <b>NEW USER</b>\n` +
      `Name: ${escapeHtml(params.name)}\n` +
      `Username: @${escapeHtml(params.username || 'none')}\n` +
      `Telegram ID: <code>${params.telegramId}</code>`
  );
}

export async function notifyNewOrder(params: {
  orderId: string;
  total: number;
  currency?: string;
  customerName: string;
  username?: string | null;
  paymentMethod?: string;
  itemCount: number;
}): Promise<void> {
  const link = `${env.FRONTEND_URL}/admin/orders/${params.orderId}`;
  await notifyAdmin(
    `🛒 <b>NEW ORDER</b>\n` +
      `Order ID: <code>${escapeHtml(params.orderId)}</code>\n` +
      `Total: ${params.total} ${escapeHtml(params.currency || 'ETB')}\n` +
      `Customer: ${escapeHtml(params.customerName)} (@${escapeHtml(params.username || 'none')})\n` +
      `Payment: ${escapeHtml(params.paymentMethod || 'n/a')}\n` +
      `Items: ${params.itemCount}\n\n` +
      `View in admin panel: ${link}`
  );
}

export async function notifyNewRequest(params: {
  requestId: string;
  productName: string;
  customerName: string;
  username?: string | null;
  category?: string | null;
  urgency?: string | null;
  description?: string | null;
}): Promise<void> {
  await notifyAdmin(
    `🔍 <b>NEW PRODUCT REQUEST</b>\n` +
      `Product: ${escapeHtml(params.productName)}\n` +
      `From: ${escapeHtml(params.customerName)} (@${escapeHtml(params.username || 'none')})\n` +
      `Category: ${escapeHtml(params.category || 'n/a')}\n` +
      `Urgency: ${escapeHtml(params.urgency || 'normal')}\n` +
      `Description: ${escapeHtml((params.description || '').slice(0, 400))}\n` +
      `ID: <code>${escapeHtml(params.requestId)}</code>`
  );
}

export async function notifyNewSellerApplication(params: {
  applicationId: string;
  applicantName: string;
  username?: string | null;
  businessName: string;
  businessType?: string;
  phone?: string;
}): Promise<void> {
  await notifyAdmin(
    `👤 <b>NEW SELLER APPLICATION</b>\n` +
      `Applicant: ${escapeHtml(params.applicantName)} (@${escapeHtml(params.username || 'none')})\n` +
      `Business: ${escapeHtml(params.businessName)}\n` +
      `Type: ${escapeHtml(params.businessType || 'n/a')}\n` +
      `Phone: ${escapeHtml(params.phone || 'n/a')}\n\n` +
      `Review in admin panel\n` +
      `ID: <code>${escapeHtml(params.applicationId)}</code>`
  );
}

export async function notifyNewProduct(params: {
  productId: string;
  productName: string;
  sellerName: string;
  price: number;
  category?: string;
}): Promise<void> {
  await notifyAdmin(
    `📦 <b>NEW PRODUCT LISTED</b>\n` +
      `Product: ${escapeHtml(params.productName)}\n` +
      `Seller: ${escapeHtml(params.sellerName)}\n` +
      `Price: ${params.price} ETB\n` +
      `Category: ${escapeHtml(params.category || 'n/a')}\n` +
      `ID: <code>${escapeHtml(params.productId)}</code>`
  );
}

export async function notifyPaymentReceived(params: {
  orderId: string;
  amount: number;
  method: 'stripe' | 'chapa';
  currency?: string;
}): Promise<void> {
  await notifyAdmin(
    `💰 <b>PAYMENT RECEIVED</b>\n` +
      `Order: <code>${escapeHtml(params.orderId)}</code>\n` +
      `Amount: ${params.amount} ${escapeHtml(params.currency || 'ETB')}\n` +
      `Method: ${params.method}`
  );
}

export async function notifySystemError(params: {
  endpoint: string;
  error: string;
}): Promise<void> {
  await notifyAdmin(
    `⚠️ <b>SYSTEM ERROR</b>\n` +
      `Endpoint: ${escapeHtml(params.endpoint)}\n` +
      `Error: ${escapeHtml(params.error.slice(0, 500))}\n` +
      `Time: ${new Date().toISOString()}`
  );
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

export async function notifySellerApplicationDecision(
  telegramId: number,
  userId: string,
  approved: boolean,
  notes?: string | null
): Promise<void> {
  const dashboard = `${env.FRONTEND_URL}/seller`;
  const message = approved
    ? `🎉 Your seller application was <b>approved</b>!\nYou can now list products.\n<a href="${dashboard}">Open seller dashboard</a>`
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

export async function notifySellerDeliveryConfirmed(
  telegramId: number,
  orderId: string
): Promise<void> {
  await notifyUser(
    telegramId,
    `✅ Customer confirmed delivery for order #<code>${orderId.slice(0, 8)}</code>`
  );
}

export async function notifyAdminNewFeedback(params: {
  customerName: string;
  username?: string | null;
  category: string;
  message: string;
  rating?: number | null;
}): Promise<void> {
  const handle = params.username ? `@${escapeHtml(params.username)}` : '—';
  await notifyAdmin(
    `📩 <b>NEW FEEDBACK</b>\n` +
      `From: ${escapeHtml(params.customerName)} (${handle})\n` +
      `Category: ${escapeHtml(params.category)}\n` +
      `Message: ${escapeHtml(params.message)}\n` +
      `Rating: ${params.rating ?? '—'}`
  );
}

export async function notifyAdminNewReview(params: {
  customerName: string;
  username?: string | null;
  productName: string;
  rating: number;
  comment?: string | null;
}): Promise<void> {
  const handle = params.username ? `@${escapeHtml(params.username)}` : '—';
  await notifyAdmin(
    `⭐ <b>NEW PRODUCT REVIEW</b>\n` +
      `From: ${escapeHtml(params.customerName)} (${handle})\n` +
      `Product: ${escapeHtml(params.productName)}\n` +
      `Rating: ${params.rating}/5\n` +
      `Comment: ${escapeHtml(params.comment || '—')}`
  );
}
