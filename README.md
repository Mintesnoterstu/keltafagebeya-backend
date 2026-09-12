# KeltaFagebeya Backend API

REST API for **KeltaFagebeya (ክልታፋገብያ)** — an Ethiopian e-commerce Telegram Mini App.

## Stack

- Node.js 18+ / Express.js / TypeScript
- Supabase (PostgreSQL)
- Stripe + Chapa payments
- Telegram Bot API (auth + notifications)
- Zod validation / Winston logging
- JWT authentication

## Project Structure

```
src/
├── config/          # Env, Supabase, Winston logger
├── controllers/     # Route handlers
├── middleware/      # Auth, validation, error handling
├── routes/          # Express routers
├── schemas/         # Zod validation schemas
├── services/        # Stripe, Chapa, Telegram
├── types/           # Shared TypeScript types
├── utils/           # Helpers (Telegram auth, AppError)
├── app.ts           # Express app setup
└── index.ts         # Server entry point
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your credentials:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase **service role** key (server-side only) |
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_ADMIN_CHAT_ID` | Your Telegram user ID (for admin alerts) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `CHAPA_SECRET_KEY` | Chapa secret key |
| `FRONTEND_URL` | Deployed frontend URL |
| `JWT_SECRET` | Long random string (min 16 chars) |
| `CORS_ORIGIN` | Comma-separated allowed origins |

### 3. Run locally

```bash
npm run dev
```

API starts at `http://localhost:5000`.

### 4. Build for production

```bash
npm run build
npm start
```

## API Endpoints

### Health
- `GET /api/health`

### Auth
- `POST /api/auth/telegram` — Validate Telegram `initData`, upsert user, return JWT
- `GET /api/auth/me` — Current user (Bearer token)
- `GET /api/auth/config` — Public config (Stripe publishable key, bot username)

### Upload
- `POST /api/upload/image` — Upload one product image (seller, multipart field `image`)
- `POST /api/upload/images` — Upload up to 5 images (seller, multipart field `images`)

### Products
- `GET /api/products` — List with filters (`category`, `sub_category`, `search`, `min_price`, `max_price`, `page`, `limit`, `sort`)
- `GET /api/products/categories` — Categories + sub-categories
- `GET /api/products/:id` — Single product + seller
- `POST /api/products` — Create (seller)
- `PUT /api/products/:id` — Update (seller)
- `DELETE /api/products/:id` — Delete (seller)

### Cart
- `GET /api/cart`
- `POST /api/cart` — `{ product_id, quantity }`
- `PUT /api/cart/:id` — `{ quantity }`
- `DELETE /api/cart/:id`
- `DELETE /api/cart` — Clear cart

### Orders
- `POST /api/orders` — Create from cart
- `GET /api/orders` — User order history
- `GET /api/orders/seller` — Seller orders
- `GET /api/orders/:id`
- `PUT /api/orders/:id/status` — Seller/admin

### Requests
- `POST /api/requests`
- `GET /api/requests`
- `GET /api/requests/:id`
- `PUT /api/requests/:id` — Admin status update

### Payments
- `POST /api/payments/stripe/create-intent` — `{ order_id }`
- `POST /api/payments/stripe/webhook`
- `POST /api/payments/chapa/initialize` — `{ order_id, email?, ... }`
- `POST /api/payments/chapa/webhook`
- `POST /api/payments/chapa/verify/:id`

### Seller (dashboard + application)
- `POST /api/seller/apply` — Submit seller application (customer)
- `GET /api/seller/application-status` — Application / seller status
- `GET /api/seller/stats` — Dashboard stats
- `GET /api/seller/products` — Own products (`status`, `search`, `page`, `limit`)
- `POST /api/seller/products` — Create product (JSON or multipart `images`)
- `PUT /api/seller/products/:id` — Update own product
- `DELETE /api/seller/products/:id` — Soft-delete (`is_active=false`)
- `GET /api/seller/orders` — Orders containing seller's products
- `PUT /api/seller/orders/:id/status` — `confirmed|processing|shipped|delivered|cancelled`
- `GET /api/seller/profile` — Business profile
- `PUT /api/seller/profile` — Update business profile

### Admin (requires `role=admin` or matching `TELEGRAM_ADMIN_CHAT_ID`)
- `GET /api/admin/stats`
- `GET /api/admin/requests` — Filters: `status`, `urgency`, `search`, `page`, `limit`
- `GET /api/admin/requests/:id`
- `PUT /api/admin/requests/:id` — Update status / notes / assignee
- `POST /api/admin/requests/:id/notify` — `{ message }` Telegram to customer
- `GET /api/admin/sellers` — Seller applications
- `GET /api/admin/sellers/:id`
- `PUT /api/admin/sellers/:id/approve`
- `PUT /api/admin/sellers/:id/reject` — optional `{ admin_notes }`
- `GET /api/admin/orders` — Filters: `status`, `seller_id`, `date_from`, `date_to`
- `GET /api/admin/orders/:id`

## Database migration (required)

Run the SQL in Supabase SQL Editor before using admin/seller features:

```
sql/001_admin_seller_rbac.sql
```

Also ensure a public Storage bucket named `product-images` exists.

## Frontend API base URL

Set in Vercel / local frontend:

```
NEXT_PUBLIC_API_URL=https://keltafagebeya-backend-production.up.railway.app
```

Protected routes need:

```
Authorization: Bearer <jwt>
```

## Authentication

Send the JWT from `/api/auth/telegram` as:

```
Authorization: Bearer <token>
```

**Frontend:** set `NEXT_PUBLIC_API_URL=https://keltafagebeya-backend-production.up.railway.app` and include the Bearer token on protected calls.

**Local testing:** In `development`, you can POST `{ "initData": "dev-bypass" }` to get a test user + token without Telegram.

## Database

Expected tables: `users`, `products`, `orders`, `requests`, `cart_items`, `reviews`, `notifications`, `seller_applications`.

**Run this migration in Supabase SQL Editor** before using admin/seller features:

```
sql/001_admin_seller_rbac.sql
```

Also create a public Storage bucket named `product-images`.

The API uses the **service role** key, so it bypasses RLS. Keep that key secret and never expose it to the frontend.

## Deploy on Railway

1. Push this repo to GitHub.
2. Create a new project on [Railway](https://railway.app) → **Deploy from GitHub**.
3. Add all environment variables from `.env.example` in Railway **Variables**.
4. Set `NODE_ENV=production`.
5. Deploy — Railway runs `npm run build` then `npm start` (see `railway.json`).
6. Copy the public Railway URL and set it as your frontend API base URL.
7. Point Stripe/Chapa webhooks to:
   - `https://<your-railway-domain>/api/payments/stripe/webhook`
   - `https://<your-railway-domain>/api/payments/chapa/webhook`

## Response Format

```json
{
  "success": true,
  "message": "Optional message",
  "data": {},
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

Errors:

```json
{
  "success": false,
  "error": "Error message"
}
```

## License

MIT
