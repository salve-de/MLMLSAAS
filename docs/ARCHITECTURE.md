# Architecture / v0.1

## Small, inspectable system

Node.js HTTP server + native SQLite + browser ES modules. No runtime npm dependencies. Static assets and JSON API share one origin. SQLite uses WAL, foreign keys and `BEGIN IMMEDIATE` transactions. One writable process/volume is the deployment contract. `settings.schema_version=1` marks the initial schema; future changes need explicit migrations rather than relying on CREATE TABLE IF NOT EXISTS.

`src/server.mjs`: routing, security boundary and mode gates. `src/platform.mjs`: auth, product lifecycle, billing, network and payout services. `src/commission.mjs`: pure integer allocation. `src/db.mjs`: constraints/schema. `public/`: Japanese responsive interface. `test/`: executable unit and HTTP tests.

## Attribution and network

Two separate concepts: (1) an immutable sponsor captured at free partner registration, (2) the product-specific direct seller recorded in a purchase intent. An opaque HttpOnly visitor cookie keys server-side attribution records, first-touch for 30 days per product. A signed sponsor cookie supplies registration attribution; a caller cannot send arbitrary sponsorId/referrerId to obtain credit. Direct links are `/r/{code}/{slug}`; partner invitations are `/join/{code}`. Attribution does not work across browsers/devices, deleted cookies, or unintegrated external checkouts. No claim of perfect tracking.

New users may only point to existing sponsors, and a database trigger prevents sponsor changes. This keeps the graph acyclic. Network browsing checks descendant ownership and pages direct children 50 at a time. There is no business-level depth cap; the current implementation calculates descendant counts with a recursive SQL query, so millions of accounts would require performance redesign and load tests.

## Money

Amounts are positive integer **JPY commission bases**, excluding tax, discounts and processor fees according to the actual approved commercial agreement. The payment adapter, not a browser, must derive this number from verified settled transactions. A product's displayed retail price is not necessarily this base. Initial implementation handles one operator/normalized provider namespace; an external-merchant marketplace requires additional seller-scoped identity, settlement and reconciliation design.

- Direct allocation: floor(base × directBps / 10000), 0–50%.
- Network budget: floor(base × networkBps / 10000), 0–10%.
- Ancestor amounts: floor(network budget / 2), then halve the previous integer repeatedly. Skip ineligible beneficiaries without moving other ancestors up the schedule. Stop once the next amount is below one yen. There is **no promise to pay infinitely small amounts**.
- Platform: floor(base × 1000 / 10000), fixed 10%.
- Creator: all remainder, including unallocated network budget and rounding dust.

Direct self-referrals and creator purchases receive no affiliate-chain payment. Recruitment/registration itself generates no ledger event. Multi-account identity fraud is not solved by an ID comparison; stronger identity controls are a launch blocker. A bounded distribution is not a profitability guarantee: hosting, API, refunds, tax, support and other costs still matter.

Product rates are snapshotted into a server-created purchase intent; subsequent subscription invoices reuse the same intent. The initial payment must arrive within 24h; recorded renewals can reuse the intent after that. Price changes do not silently change promised rates for existing intents. Creation of an intent grants neither payment status nor product access.

`ledger` is append-only: positive allocation entries reference an order; a full refund writes negative entries referencing the exact originals, preserving the original availability date. Partial refunds return 422, and refunds arriving before the original sale return 409 for retry/reconciliation. No original transaction is deleted or edited. Duplicate event IDs have a payload digest; duplicate provider order IDs do not issue a second allocation. Accounting side effects and event receipt are atomic.

Available balance = matured ledger total − requested/paid payouts. The default hold is 30 days; this is a configurable operational policy, not a chargeback guarantee. A refund after payout produces a negative balance carried forward. A refund during an outstanding request blocks recording a payout as paid until sufficient balance exists or the request is rejected. Payout request IDs are idempotent. CSV export has no payment side effects; the administrative paid action only records an independently verified bank/provider reference.

## Billing adapter contract (not a PSP integration)

The route is disabled unless `LIVE_PAYMENTS_ENABLED=true`, `BILLING_WEBHOOK_SECRET` has at least 32 characters, and `PAYMENT_APPROVAL_REFERENCE` is nonempty. These environment values are operator acknowledgments, **not automated legal/provider approval**. Demo mode can never enter this route. Checkout remains disabled until a real adapter is implemented; setting a flag does not create one.

1. Authenticated customer creates `POST /api/intents` with `{"productId":"..."}` and the normal CSRF token. The server supplies attribution and returns the intent ID.
2. A future server-side checkout adapter must validate the product/customer, create an actual provider checkout session, and bind the intent to provider metadata. Never take settled amount, affiliate ID or payment success from a browser.
3. The adapter verifies the provider's signature and successful settlement, then sends a normalized event below. The source `orderId` must identify an actual invoice/payment, not an easily duplicated notification ID.

```json
{
  "type": "sale.paid",
  "currency": "JPY",
  "eventId": "provider-event-id",
  "orderId": "provider-invoice-id",
  "intentId": "server-issued-intent-id",
  "amountJpy": 10000
}
```

Full refund: same currency/orderId and original amountJpy, `type: "sale.refunded"`, new eventId. Do not simulate partial refunds as full refunds. Add a reviewed partial-refund allocation strategy and reconciliation queue before handling providers that emit them.

`POST /api/billing/events`, `Content-Type: application/json`, `X-Billing-Timestamp: <unix milliseconds>` and `X-Billing-Signature: <hex HMAC-SHA256(secret, timestamp + "." + exact raw JSON body)>`. Timestamp freshness tolerance is ±5 minutes. Retrying an event should recompute its envelope timestamp/signature but retain its eventId and semantic contents. 409 for out-of-order events requires retry after source settlement; 422 requires manual handling, not an infinite retry loop. Periodic reconciliation against the actual provider is not implemented.

## Security and operational boundaries

scrypt hashes, opaque 256-bit sessions stored as SHA-256 hashes, 30-day expiration, HttpOnly/SameSite=Lax cookies and Secure on HTTPS; strict Origin checks and per-session CSRF for authenticated writes; persistent IP/account rate limits; JSON body limit; SQL parameterization; output escaping; restrictive CSP; no CORS enablement; no frontend secrets; role/descendant authorization; audit events; CSV formula neutralization. Only enable TRUST_PROXY behind a proxy overwriting the forwarded-IP header.

This is not a full security audit or production compliance certification. Missing email verification, self-service password recovery, MFA, risk/KYC, device abuse detection, retention/delete requests, backup scheduling and restoration drills are listed in the launch checklist. Rate limiter cleanup and descendant counting are intentionally simple and should be revisited after measured usage. Logs must not receive bank details, passwords, provider payload secrets or payment card data.
