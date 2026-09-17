# Fashion Corner Inventory Tracker

A React + Vite inventory and margin tracker backed by Supabase Auth and Postgres.

## Configure Supabase

1. In Supabase, open the SQL Editor and run [`supabase/migrations/20260917000000_create_products.sql`](./supabase/migrations/20260917000000_create_products.sql).
2. Run [`supabase/migrations/20260917000001_add_daily_sales.sql`](./supabase/migrations/20260917000001_add_daily_sales.sql), then [`supabase/migrations/20260917000002_add_editable_daily_sales.sql`](./supabase/migrations/20260917000002_add_editable_daily_sales.sql), then [`supabase/migrations/20260917000003_add_per_unit_sale_prices.sql`](./supabase/migrations/20260917000003_add_per_unit_sale_prices.sql).
3. Copy `.env.example` to `.env` and fill in your project's URL and anon key. Find both under **Project Settings → API** in Supabase.
4. In **Authentication → Providers**, make sure Email is enabled. If email confirmation is enabled, users must confirm their address before their first sign-in.

## Run locally

```bash
npm install
npm run dev
```

Run `npm run build` to create a production build.

## Included functionality

- Per-user email/password authentication
- RLS-protected product CRUD
- Dashboard totals for product count, inventory value, potential profit, and average margin
- Product profit per unit, profit margin, markup, stock value, and potential profit calculations
- Search, category filtering, sorting, responsive table, edit/add dialog, deletion confirmation, and status toasts
- Daily sales with editable amount, quantity, date, edit/delete actions, and stock restoration on deletion
