# QA / review instructions

## Executed in the authoring environment

- `npm run check`: syntax validation of browser/server/scripts/tests.
- `npm test`: 36 Node tests, including real local HTTP requests, SQLite transactions, 2,000 generated allocation cases and a 2,000-generation network.
- Offline Chromium rendering of the actual browser code and demo-product fixtures: 1440px desktop / 390px mobile, no horizontal overflow, search reduces six cards to one, no JavaScript page errors in that offline preview.

The environment's managed Chromium blocked navigation to localhost (`ERR_BLOCKED_BY_ADMINISTRATOR`). The restriction was not bypassed. **Offline rendering is not a live browser end-to-end pass**, does not exercise HTTP cookies, and does not validate a deployed Content-Security-Policy. Those are deliberately not claimed as completed browser checks. API cookie/CSRF behavior is covered by Node HTTP integration tests. Docker and remote deployment are not tested here.

## Browser acceptance pass on a permitted review origin

1. Start `npm run demo`. Confirm the DEMO warning and six sample products; no pre-populated fake sales figures.
2. Filter by category, search Signal, change sort order, view product details, open/close both dialogs with keyboard/Escape.
3. Enter demo as partner. Direct sale test adds a direct ledger allocation. Downstream sale adds a smaller network allocation. Refund restores the exact prior amounts, leaving original entries visible.
4. Copy a product referral URL. In a separate browser profile follow it and register. Confirm the original sponsor stays fixed after a different referral; create an intent through the authenticated API and confirm product attribution is server-selected.
5. Copy a partner invitation, register a separate free account without purchasing; no commission should appear solely for that registration.
6. Drill down network, return to root, and paginate. An unrelated account's subtree must be forbidden. Member records must not disclose downline email addresses.
7. Submit a product. It must be pending and absent from the public catalog. Switch to demo operator and approve/reject it. The market must reflect the review.
8. Attempt a payout and purchase in demo: both must be disabled. Export operator CSV: no balance or payout state changes.
9. Log out; protected APIs must reject requests even if the browser is pointed directly at them. Test expired sessions and CSRF mismatch; no success toast should be shown on failure.
10. Check widths 390/768/1440, keyboard focus, native validation, loading/error states, dialog scrolling and clipboard-denied fallback.

No real payment, live payout, merge or public deployment is authorized by this QA document.
