-- Optional: add currency if you want it later (NOT required for Add Product)
-- ALTER TABLE products ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'ETB';

-- Ensure common product columns exist
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS sub_category TEXT,
  ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
