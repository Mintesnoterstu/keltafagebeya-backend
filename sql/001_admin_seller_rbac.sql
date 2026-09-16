-- KeltaFagebeya: Admin / Seller / RBAC schema updates
-- Run this in Supabase SQL Editor

-- 1. Extend users table (add missing columns first)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS is_seller BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS seller_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS seller_name TEXT,
  ADD COLUMN IF NOT EXISTS seller_bio TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS business_description TEXT,
  ADD COLUMN IF NOT EXISTS business_phone TEXT,
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Backfill role for existing rows
UPDATE users
SET role = 'customer'
WHERE role IS NULL OR role = '' OR role = 'buyer';

UPDATE users
SET seller_status = 'none'
WHERE seller_status IS NULL OR seller_status = '';

UPDATE users
SET is_seller = false
WHERE is_seller IS NULL;

-- Soft constraints (safe to re-run)
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('customer', 'seller', 'admin', 'buyer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_seller_status_check
    CHECK (seller_status IN ('none', 'pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_business_type_check
    CHECK (business_type IS NULL OR business_type IN ('individual', 'small_business', 'company'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Seller applications
CREATE TABLE IF NOT EXISTS seller_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  business_description TEXT NOT NULL,
  phone TEXT NOT NULL,
  business_type TEXT NOT NULL CHECK (business_type IN ('individual', 'small_business', 'company')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_applications_user_id ON seller_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_applications_status ON seller_applications(status);

-- 3. Extend requests table
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'normal';

DO $$ BEGIN
  ALTER TABLE requests ADD CONSTRAINT requests_urgency_check
    CHECK (urgency IS NULL OR urgency IN ('low', 'normal', 'high', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Soft-delete flag for products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

UPDATE products SET is_active = true WHERE is_active IS NULL;

-- 6. Timestamps (required — login fails without users.updated_at)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE users SET created_at = COALESCE(created_at, NOW());
UPDATE users SET updated_at = COALESCE(updated_at, NOW());

-- 5. Optional: promote your Telegram admin user (replace with your telegram_id)
-- UPDATE users SET role = 'admin' WHERE telegram_id = 8118358536;

-- 6. Storage bucket (dashboard):
-- Storage → New bucket → name: product-images → Public: ON
