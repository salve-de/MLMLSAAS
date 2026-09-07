# Public launch gates

## Initial release is an operational MVP, not a money-live service

All demo balances and sample products are fictional and nonredeemable. Product listing approval does not create or verify the underlying SaaS. Unrestricted external seller onboarding is not enabled automatically. Begin with operator-owned products, not a multi-merchant financial service.

| Gate | Current state | Required work |
|---|---|---|
| Real product/customer value | Sample listings only | Publish actual owned products and connect paid entitlement/access |
| Payment provider approval | Not obtained in this PR | Obtain written approval of the actual multi-level compensation model; do not disguise it |
| Checkout/subscriptions | Disabled | Server-side provider adapter, recurring billing, customer portal, cancellation and product entitlements |
| Payment reconciliation | Normalized signed intake only | Provider signatures, invoice mapping, gross/net/tax/fee normalization, reconciliation jobs, retries/dead letters, disputes and partial refunds |
| Legal/commercial terms | Not reviewed | Jurisdiction-specific legal review, required business disclosures, refund terms, promotional rules, privacy/cookies and affiliate agreement |
| Participation rules | Free, no forced purchase, no recruitment-only payment | Preserve these rules; they do not on their own prove a scheme is lawful |
| Identity/security | Password sessions and basic controls | Email verification/recovery, MFA for admins, identity/sanctions/abuse checks appropriate to the provider and market |
| Payouts | Default off; reservation/CSV/reference logging implemented | Approved payment rail, payee verification, tax reporting, funded reserves, separation of duties and idempotent payout reconciliation |
| Support/moderation | Basic product review UI | Complaint, refund and abuse handling with defined response responsibilities |
| Data/availability | Single SQLite volume | Backups, recovery drill, monitoring, alerts, retention/access/deletion procedures |
| Deployment/load | Local Node tested | Real HTTPS smoke test, Docker build, deployment-specific security review, measured load tests |
| Browser E2E | Not verified against a live browser origin in this environment | Run all flows in docs/QA.md on the deployed review environment |

Do not represent a 10% or other geometric payout ceiling as proof of profitability, legal compliance, provider acceptance or unlimited scalability. These are separate questions. Do not add fees/products that users must buy to qualify for higher network rewards without a new review.
