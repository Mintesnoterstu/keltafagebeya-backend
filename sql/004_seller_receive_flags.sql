-- Optional flags: sellers only get order/request alerts when admin enables them
-- Run in Supabase SQL Editor

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS receive_orders BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS receive_requests BOOLEAN DEFAULT false;

-- Existing approved sellers stay off until admin enables
UPDATE users
SET receive_orders = COALESCE(receive_orders, false),
    receive_requests = COALESCE(receive_requests, false)
WHERE role = 'seller' OR seller_status = 'approved';
