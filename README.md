# Wastro Website Server

Storefront API on `:4001` against the shared Admin PostgreSQL database.

## Phase 06 — Payments

- `POST /api/v1/store/payments/create` (customer + CSRF + Idempotency-Key)
- `GET /api/v1/store/payments/:id` (customer, ownership enforced)
- `POST /api/v1/store/payments/mock/confirm` (dev only — simulates provider capture)
- `POST /api/v1/store/webhooks/payments/:provider` (HMAC `x-wastro-signature`, idempotent)

Browser return/redirect alone never marks an order paid. Capture happens via verified webhook processing (mock confirm reuses that path in development).

Apply shared migrations from Admin:

```bash
cd ../../Admin/server && npm run migrate
```

Set `PAYMENT_WEBHOOK_SECRET` in `.env`.
