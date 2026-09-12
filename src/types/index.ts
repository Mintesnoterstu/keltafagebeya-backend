import { Request } from 'express';

export type UserRole = 'customer' | 'buyer' | 'seller' | 'admin';
export type SellerStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type BusinessType = 'individual' | 'small_business' | 'company';

export interface User {
  id: string;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  phone: string | null;
  role: UserRole;
  is_seller: boolean;
  seller_status: SellerStatus;
  seller_name: string | null;
  seller_bio: string | null;
  business_name: string | null;
  business_description: string | null;
  business_phone: string | null;
  business_type: BusinessType | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  /** Request-scoped flags set by middleware */
  isAdmin?: boolean;
  isSeller?: boolean;
}

export interface SellerApplication {
  id: string;
  user_id: string;
  business_name: string;
  business_description: string;
  phone: string;
  business_type: BusinessType;
  status: 'pending' | 'approved' | 'rejected';
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  seller_id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  category: string;
  sub_category: string | null;
  images: string[];
  stock: number;
  is_available: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  products?: Product;
}

export interface OrderItem {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  seller_id: string;
}

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type PaymentMethod = 'stripe' | 'chapa' | 'cash';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'paid';

export interface Order {
  id: string;
  user_id: string;
  items: OrderItem[];
  total_amount: number;
  currency: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  payment_id: string | null;
  shipping_address: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type RequestStatus =
  | 'pending'
  | 'reviewing'
  | 'sourcing'
  | 'found'
  | 'closed'
  | 'approved'
  | 'rejected'
  | 'fulfilled';

export type RequestUrgency = 'low' | 'normal' | 'high' | 'urgent';

export interface ProductRequest {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  budget: number | null;
  category: string | null;
  images: string[];
  status: RequestStatus;
  urgency: RequestUrgency | null;
  admin_notes: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface JwtPayload {
  userId: string;
  telegramId: number;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: User;
  userId?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export const PRODUCT_CATEGORIES: Record<string, string[]> = {
  Electronics: ['Phones', 'Laptops', 'Accessories', 'Audio', 'Gaming'],
  Fashion: ['Men', 'Women', 'Kids', 'Shoes', 'Bags'],
  'Home & Living': ['Furniture', 'Kitchen', 'Decor', 'Bedding'],
  Beauty: ['Skincare', 'Makeup', 'Haircare', 'Fragrance'],
  Food: ['Groceries', 'Snacks', 'Beverages', 'Spices'],
  Sports: ['Fitness', 'Outdoor', 'Team Sports', 'Wearables'],
  Books: ['Fiction', 'Non-Fiction', 'Educational', 'Comics'],
  Other: ['Miscellaneous'],
};

export function isAdminRole(role?: UserRole): boolean {
  return role === 'admin';
}

export function isSellerRole(role?: UserRole, isSeller?: boolean): boolean {
  return role === 'seller' || role === 'admin' || isSeller === true;
}

export function isCustomerRole(role?: UserRole): boolean {
  return role === 'customer' || role === 'buyer' || !role;
}
