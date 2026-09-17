import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import { supabase } from "../config/supabase";
import { AppError } from "../utils/AppError";
import { ApiResponse, OrderItem } from "../types";
import {
  notifyNewSellerApplication,
  notifyOrderStatusChange,
  notifyNewProduct,
} from "../services/telegram.service";
import { uploadMultipleProductImages } from "../services/storage.service";
import { logger } from "../config/logger";

function pagination(page: number, limit: number) {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1, page, limit };
}

export async function getSellerStats(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    const sellerId = req.user.id;

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, stock, is_available, is_active, price")
      .eq("seller_id", sellerId);

    if (productsError) throw new AppError(productsError.message, 500);

    const productList = products ?? [];

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (ordersError) throw new AppError(ordersError.message, 500);

    const sellerOrders = (orders ?? []).filter(
      (order) =>
        Array.isArray(order.items) &&
        order.items.some((item: OrderItem) => item.seller_id === sellerId),
    );

    let totalRevenue = 0;
    let pendingOrders = 0;

    for (const order of sellerOrders) {
      const sellerItems = (order.items as OrderItem[]).filter(
        (item) => item.seller_id === sellerId,
      );
      const orderRevenue = sellerItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );

      if (
        order.payment_status === "completed" ||
        order.payment_status === "paid" ||
        ["paid", "delivered", "shipped", "processing", "confirmed"].includes(
          order.status,
        )
      ) {
        totalRevenue += orderRevenue;
      }

      if (!["delivered", "cancelled", "refunded"].includes(order.status)) {
        pendingOrders += 1;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        totalProducts: productList.filter((p) => p.is_active !== false).length,
        totalOrders: sellerOrders.length,
        pendingOrders,
        totalRevenue,
        currency: "ETB",
        available_products: productList.filter((p) => p.is_available).length,
        low_stock_products: productList.filter(
          (p) => p.stock > 0 && p.stock <= 5,
        ).length,
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getSellerProducts(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    const {
      status = "all",
      search,
      page = 1,
      limit = 20,
    } = req.query as Record<string, string | number>;
    const {
      from,
      to,
      page: pageNum,
      limit: limitNum,
    } = pagination(Number(page), Number(limit));

    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("seller_id", req.user.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status === "active") query = query.eq("is_active", true);
    if (status === "inactive") query = query.eq("is_active", false);
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw new AppError(error.message, 500);

    const total = count ?? 0;
    res.status(200).json({
      success: true,
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function createSellerProduct(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    const body = req.body as Record<string, unknown>;
    let images: string[] = [];

    if (Array.isArray(body.images)) {
      images = body.images as string[];
    } else if (typeof body.images === "string" && body.images) {
      try {
        images = JSON.parse(body.images);
      } catch {
        images = [body.images];
      }
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (files && files.length > 0) {
      const uploaded = await uploadMultipleProductImages(files, req.user.id);
      images = [...images, ...uploaded];
    }

    // Optional single URL from admin form "(optional URL)" + Add
    for (const key of ["image_url", "imageUrl", "url"]) {
      const extra = body[key];
      if (typeof extra === "string" && extra.trim()) {
        images.push(extra.trim());
      }
    }

    // Only columns that exist on the live products table (no currency)
    const insertRow: Record<string, unknown> = {
      name: body.name || body.title,
      description: body.description ?? "",
      price: Number(body.price),
      category: body.category,
      sub_category: body.sub_category || body.subCategory || "Other",
      stock: Number(body.stock ?? body.quantity ?? 0),
      images,
      is_available:
        body.is_available === undefined
          ? true
          : body.is_available === true || body.is_available === "true",
      is_active: true,
      seller_id: req.user.id,
    };

    let { data, error } = await supabase
      .from("products")
      .insert(insertRow)
      .select()
      .single();

    // Retry without optional columns if schema is leaner
    if (error) {
      logger.warn(`Product insert retry without optional cols: ${error.message}`);
      const lean = {
        name: insertRow.name,
        description: insertRow.description,
        price: insertRow.price,
        category: insertRow.category,
        sub_category: insertRow.sub_category,
        stock: insertRow.stock,
        images,
        seller_id: req.user.id,
      };
      const retry = await supabase.from("products").insert(lean).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      throw new AppError(error?.message || "Failed to create product", 500);
    }

    try {
      await notifyNewProduct({
        productId: data.id,
        productName: data.name,
        sellerName:
          req.user.business_name ||
          req.user.seller_name ||
          `${req.user.first_name} ${req.user.last_name || ""}`.trim(),
        price: Number(data.price),
        category: data.category,
      });
    } catch (e) {
      logger.error(`Product created but admin notify failed: ${e}`);
    }

    res.status(201).json({
      success: true,
      message: "Product created",
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function updateSellerProduct(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);
    const { id } = req.params;

    const { data: existing } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (!existing) throw new AppError("Product not found", 404);
    if (existing.seller_id !== req.user.id && req.user.role !== "admin") {
      throw new AppError("Not authorized to update this product", 403);
    }

    const body = { ...req.body } as Record<string, unknown>;
    let images = existing.images as string[];

    if (body.images !== undefined) {
      if (Array.isArray(body.images)) images = body.images as string[];
      else if (typeof body.images === "string") {
        try {
          images = JSON.parse(body.images);
        } catch {
          images = [body.images];
        }
      }
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (files && files.length > 0) {
      const uploaded = await uploadMultipleProductImages(files, req.user.id);
      images = [...images, ...uploaded];
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      images,
    };

    for (const key of ["name", "description", "category", "sub_category"]) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (body.subCategory !== undefined) updates.sub_category = body.subCategory;

    for (const key of ["image_url", "imageUrl", "url"]) {
      const extra = body[key];
      if (typeof extra === "string" && extra.trim()) {
        images = [...images, extra.trim()];
        updates.images = images;
      }
    }
    if (body.price !== undefined) updates.price = Number(body.price);
    if (body.stock !== undefined) updates.stock = Number(body.stock);
    if (body.is_available !== undefined) {
      updates.is_available =
        body.is_available === true || body.is_available === "true";
    }
    if (body.is_active !== undefined) {
      updates.is_active = body.is_active === true || body.is_active === "true";
    }

    const { data, error } = await supabase
      .from("products")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || "Failed to update product", 500);
    }

    res.status(200).json({
      success: true,
      message: "Product updated",
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function deleteSellerProduct(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);
    const { id } = req.params;

    const { data: existing } = await supabase
      .from("products")
      .select("seller_id")
      .eq("id", id)
      .single();

    if (!existing) throw new AppError("Product not found", 404);
    if (existing.seller_id !== req.user.id && req.user.role !== "admin") {
      throw new AppError("Not authorized to delete this product", 403);
    }

    // Soft delete
    const { data, error } = await supabase
      .from("products")
      .update({
        is_active: false,
        is_available: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);

    res.status(200).json({
      success: true,
      message: "Product deactivated",
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getSellerOrders(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    const {
      status,
      page = 1,
      limit = 20,
    } = req.query as Record<string, string | number>;
    const pageNum = Number(page);
    const limitNum = Number(limit);

    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw new AppError(error.message, 500);

    const sellerId = req.user.id;
    const filtered = (data ?? []).filter(
      (order) =>
        Array.isArray(order.items) &&
        order.items.some((item: OrderItem) => item.seller_id === sellerId),
    );

    const total = filtered.length;
    const from = (pageNum - 1) * limitNum;
    const mapped = filtered.slice(from, from + limitNum).map((order) => ({
      ...order,
      items: (order.items as OrderItem[]).filter(
        (item) => item.seller_id === sellerId,
      ),
    }));

    res.status(200).json({
      success: true,
      data: mapped,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function updateSellerOrderStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);
    const { id } = req.params;
    const { status } = req.body;

    const { data: order, error: fetchError } = await supabase
      .from("orders")
      .select("*, users(telegram_id, id)")
      .eq("id", id)
      .single();

    if (fetchError || !order) throw new AppError("Order not found", 404);

    const owns =
      Array.isArray(order.items) &&
      order.items.some((item: OrderItem) => item.seller_id === req.user!.id);

    if (!owns && req.user.role !== "admin") {
      throw new AppError("Not authorized to update this order", 403);
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || "Failed to update order", 500);
    }

    const user = order.users as { telegram_id: number; id: string } | null;
    if (user) {
      await notifyOrderStatusChange(user.telegram_id, user.id, id, status);
    }

    res.status(200).json({
      success: true,
      message: "Order status updated",
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getSellerProfile(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    res.status(200).json({
      success: true,
      data: {
        id: req.user.id,
        role: req.user.role,
        is_seller: req.user.is_seller,
        seller_status: req.user.seller_status,
        business_name: req.user.business_name || req.user.seller_name,
        business_description:
          req.user.business_description || req.user.seller_bio,
        business_phone: req.user.business_phone || req.user.phone,
        business_type: req.user.business_type,
        seller_name: req.user.seller_name,
        seller_bio: req.user.seller_bio,
        phone: req.user.phone,
        first_name: req.user.first_name,
        last_name: req.user.last_name,
        username: req.user.username,
        photo_url: req.user.photo_url,
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function updateSellerProfile(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    const updates: Record<string, unknown> = {
      ...req.body,
      updated_at: new Date().toISOString(),
    };

    // Keep legacy seller_name/seller_bio in sync
    if (req.body.business_name) updates.seller_name = req.body.business_name;
    if (req.body.business_description !== undefined) {
      updates.seller_bio = req.body.business_description;
    }
    if (req.body.business_phone) updates.phone = req.body.business_phone;

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.user.id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || "Failed to update profile", 500);
    }

    res.status(200).json({
      success: true,
      message: "Seller profile updated",
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function applyAsSeller(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    if (req.user.role === "seller" || req.user.seller_status === "approved") {
      throw new AppError("You are already an approved seller", 409);
    }

    const { data: existing } = await supabase
      .from("seller_applications")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      throw new AppError("You already have a pending application", 409);
    }

    const { business_name, business_description, phone, business_type } =
      req.body;

    const { data, error } = await supabase
      .from("seller_applications")
      .insert({
        user_id: req.user.id,
        business_name,
        business_description,
        phone,
        business_type,
        status: "pending",
      })
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || "Failed to submit application", 500);
    }

    await supabase
      .from("users")
      .update({
        seller_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.user.id);

    const userName =
      `${req.user.first_name} ${req.user.last_name || ""}`.trim();
    try {
      await notifyNewSellerApplication({
        applicationId: data.id,
        applicantName: userName,
        username: req.user.username,
        businessName: business_name,
        businessType: business_type,
        phone,
      });
    } catch (e) {
      logger.error(`Seller application notify failed: ${e}`);
    }

    res.status(201).json({
      success: true,
      message: "Seller application submitted",
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getApplicationStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);

    const { data: application } = await supabase
      .from("seller_applications")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    res.status(200).json({
      success: true,
      data: {
        seller_status: req.user.seller_status || "none",
        role: req.user.role,
        is_seller: req.user.is_seller,
        application: application ?? null,
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}
