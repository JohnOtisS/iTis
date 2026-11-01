# iTis PRO review — 1 November 2026

## Applied defaults and deployment

| Role | Rolling 5-hour tokens | Total allocation | Storage |
|---|---:|---:|---:|
| Standard | 100,000 | 1,000,000 | 2 GiB |
| Plus | 250,000 | 3,000,000 | 2 GiB |
| Admin | Unlimited | Unlimited | 2 GiB |

The total allocation does not renew monthly. Admin can override account quotas
and storage. Existing usage is retained. The one-time 0011 migration updates only
the former stock Standard 250K/3M plan and matching accounts; custom plans and
individual allocations are preserved. Both production startup migration hooks
and fresh seed defaults include the new plans. API creation now reads the saved
role plan, including Admin unlimited flags, rather than hardcoded Standard values.
UI and API fallback plans share one module.

Plan saves apply to accounts matching all four fields of the previous plan;
different individual grants survive. Matching fields are treated as inheritance;
there is no explicit per-account inheritance flag yet.

## Fixes discovered by additional tests

- A source-format mention in a negative instruction (“do not upload CSV again”)
  was incorrectly treated as another required output. This caused an unnecessary
  paid correction and a failed export. The reproduced case now succeeds in one
  provider response; regression tests cover both excluded CSV and intentional
  XLSX + CSV output.
- XLSX quick reads now resolve shared strings and rich-text runs into actual cell
  values, retain whitespace, name sheets/cells and show formula expressions with
  cached results. Old raw-XML extraction caches are refreshed lazily.
- Spreadsheet publication rejects error cells, non-finite numeric formula caches,
  absent formula caches, and missing requested formulas. These checks detect
  common faults; they are not a universal Excel formula engine.
- A first message over the session limit is rejected before a provider call;
  previously that guard applied only to existing conversations.
- Automatic paid correction rechecks active-account status and token quotas.
  It remains bounded to one correction rather than looping indefinitely.
- Expensive document/computation/web jobs are limited to two concurrent jobs per
  account, with a PostgreSQL lock that works across server replicas. Environment
  override: ITIS_MAX_CONCURRENT_CHAT_JOBS, integer 1–10. Stale jobs over 15 minutes
  are cancelled on admission. Ordinary text chat streams are outside this limit.
- Verification failures now name the failed checks instead of hiding all causes
  behind a generic file-generation error. Invalid outputs are not published.

## Live tests and independent output checks

Synthetic data only; temporary authenticated accounts and server-side test files
were cleaned up. Real HTTP calls invoked the configured OpenAI account.

Final run: `pro-edge-2026-11-01T16-26-58-432Z/report.json`.

| Case | Time | Result |
|---|---:|---|
| Decimal prices, negative refund, 8% VAT, half-up rounding | 15.335 s | Subtotal 75.07, VAT 6.01, total 81.08 |
| Follow-up edit of previously uploaded CSV, export formula XLSX | 28.792 s | Beta quantity 3, refund retained; subtotal 85.12, VAT 6.81, total 91.93 |
| Convert existing Vietnamese Word to PDF | 19.750 s | Two pages; every normalized source paragraph and SOURCE-742 retained |
| Recall a correction after 42 older messages | 1.255 s | ORCHID-928; obsolete ORCHID-111 not returned |

`verify-pro-edge.py` independently recomputes totals with Decimal, inspects each
expected formula/cache in the downloaded XLSX, and checks downloaded PDF text
against all original Word paragraphs. See the final run's `verification.json`.
Content checks do not certify pagination fidelity or all visual layout details.

Additional passing checks:

- `test-pro-policy.ts`: routing, explicit source/output formats, source versions,
  lineage, malformed output rejection, shared/rich strings, Excel errors/caches.
- `test-word-fast.ts`: valid Word generation, exact replacements across split
  runs, occurrence counts, unchanged styles/footer/relationships.
- `test-pro-chat.mjs`: cached file reading without a container fee; real streamed
  calculations and progress; real provider cancellation; cross-account job
  isolation; no published files after Stop; images directed to Studio.
- `test-deployment-defaults.mjs`: role-specific server creation, Admin unlimited
  flags, custom grants retained on plan save, task capacity rejection without
  paid usage.
- `test-storage.mjs --http`: concurrent storage quota enforcement, history/file
  accounting, physical attachment cleanup and quota release, account isolation,
  lowering quotas without deleting existing data.
- `test-continuation-budget.ts`: cycle/total exhaustion and disabled users block
  correction; explicit unlimited permissions remain effective.
- Live cycle/total exhaustion and oversized-first-message tests made no paid call.
- TypeScript, ESLint and production build passed.

The first two new edge runs failed and were not counted as successes. Diagnostics
identified the spurious CSV output requirement; the final run passed after the
parser correction. Sample timings are observations, not latency guarantees.

## Remaining priorities

1. Reserve usage budgets before provider calls, including concurrent text streams,
   documents and Studio; settle against actual usage afterwards. Current quotas
   use recorded usage and can be crossed by an already-running request. They are
   not exact monetary caps.
2. Add admin-configured monthly USD budgets, 80%/95% alerts and a hard stop that
   accounts for tools and estimated model cost. Monthly renewal must be explicit
   rather than silently resetting the current lifetime allocation.
3. Add a global queue/provider concurrency limit and PostgreSQL-backed request
   rate limits when Redis is unavailable. Current account job capacity protects
   document jobs; it does not cap all provider calls globally.
4. Run broader golden-document tests with visual comparisons for complex Word
   layouts, PowerPoint templates, charts, pivots, external references, scanned
   PDFs and ambiguous source data. Human review remains useful for high-impact
   accounting outputs; passing these fixtures cannot prove all future answers.

No model changes were made; Luna/Sol routing and the separate Image Studio remain.
