import { OrderItem } from '../types';

/** Normalize DB order row → shape the Mini App expects */
export function normalizeOrderForClient(
  order: Record<string, unknown>,
  extras: {
    customer?: {
      id?: string;
      first_name?: string | null;
      last_name?: string | null;
      username?: string | null;
      telegram_id?: number | null;
      phone?: string | null;
    } | null;
    sellers?: unknown[];
    seller_breakdown?: unknown;
  } = {}
): Record<string, unknown> {
  const addressRaw =
    (order.shipping_address as Record<string, unknown> | null) ||
    (order.address as Record<string, unknown> | null) ||
    {};

  const shipping_address = {
    full_name:
      addressRaw.full_name ||
      addressRaw.name ||
      extras.customer?.first_name ||
      'Customer',
    name: addressRaw.name || addressRaw.full_name || extras.customer?.first_name || 'Customer',
    phone:
      addressRaw.phone ||
      extras.customer?.phone ||
      '',
    city: addressRaw.city || 'Addis Ababa',
    sub_city: addressRaw.sub_city || addressRaw.subcity || '',
    subcity: addressRaw.subcity || addressRaw.sub_city || '',
    woreda: addressRaw.woreda || '',
    street_address:
      addressRaw.street_address ||
      addressRaw.detail ||
      addressRaw.address ||
      '',
    detail: addressRaw.detail || addressRaw.street_address || addressRaw.address || '',
    landmark: addressRaw.landmark || addressRaw.notes || '',
    address:
      addressRaw.address ||
      addressRaw.street_address ||
      addressRaw.detail ||
      '',
    notes: addressRaw.notes || addressRaw.landmark || null,
    ...addressRaw,
  };

  const rawItems = Array.isArray(order.items) ? (order.items as OrderItem[]) : [];
  const items = rawItems.map((item) => {
    const price = Number(item.price ?? 0);
    const quantity = Number(item.quantity ?? 0);
    const name = item.name || (item as { product_name?: string }).product_name || 'Product';
    return {
      ...item,
      product_id: item.product_id,
      product_name: (item as { product_name?: string }).product_name || name,
      product_name_en:
        (item as { product_name_en?: string }).product_name_en || name,
      name,
      price,
      quantity,
      image: item.image,
      product_image: item.image,
      seller_id: item.seller_id || '',
      sub_total:
        Number((item as { sub_total?: number }).sub_total) ||
        price * quantity,
    };
  });

  const totalNum = Number(
    order.total_amount ?? order.total ?? items.reduce((s, i) => s + i.sub_total, 0)
  );

  const customerName =
    extras.customer
      ? `${extras.customer.first_name || ''} ${extras.customer.last_name || ''}`.trim()
      : '';

  const fromAddress = String(shipping_address.full_name || '').trim();

  return {
    ...order,
    items,
    total: totalNum,
    total_amount: totalNum,
    shipping_address,
    address: shipping_address,
    payment_status: order.payment_status || 'pending',
    status: order.status || 'pending',
    payment_method: order.payment_method || 'cash',
    customer_name: customerName || fromAddress || 'Customer',
    customer: extras.customer || null,
    users: extras.customer || order.users || null,
    seller_name:
      (Array.isArray(extras.sellers) &&
        extras.sellers[0] &&
        ((extras.sellers[0] as { business_name?: string }).business_name ||
          (extras.sellers[0] as { seller_name?: string }).seller_name ||
          (extras.sellers[0] as { first_name?: string }).first_name)) ||
      '—',
    sellers: extras.sellers ?? [],
    seller_breakdown: extras.seller_breakdown ?? [],
  };
}
