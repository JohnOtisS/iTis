# Office workflow performance fix — 2026-11-01

## Changes

- New, ordinary single-format Word documents use a structured content response
  from Luna and a deterministic DOCX renderer on the iTis server. No Python
  container, hosted-code generation or background polling is needed for this path.
- Simple text substitutions in small DOCX documents use an exact replacement
  plan with occurrence counts. Replacements work across split text runs. Only
  document.xml changes; other package parts are preserved byte-for-byte.
- Larger/complex Word files, tracked changes, macros, template/structural work,
  multi-format exports, Excel computation and PowerPoint retain the full workflow.
- Follow-up edits can inherit the Word format from the selected document.
- Source IDs/requests to cite spreadsheet source cells no longer accidentally
  activate web search merely because they contain “SOURCE” or “nguồn”. Explicit
  web mode, URLs and actual current-information/search requests still work.
- XLSX publication now checks numeric formula cells for missing cached values;
  a bounded corrective request can populate independently verified cached results
  while preserving formula expressions. Requested formulas cannot silently vanish.
- Pending messages show the selected model and omit the misleading temporary
  “0 tokens” count. Queued provider work is distinguished from active processing.
- Removing sandbox URLs retains the readable filename instead of leaving a
  grammatically incomplete sentence.

## Latest measured test cases

Synthetic data, temporary authenticated account, actual running iTis HTTP API.
Files and timings are recorded in
`office-performance-2026-11-01T16-10-05-109Z/report.json`.

| Case | Elapsed | Model/path | Verification |
|---|---:|---|---|
| Create Vietnamese junior Backend Developer JD as DOCX | 17.47 s | Luna / local DOCX | Valid Word package and expected title/body/source marker |
| Replace Backend Developer with Full-stack Developer in uploaded Word | 4.01 s | Luna / exact local edits | All requested occurrences changed; SOURCE-742 retained; every other package part unchanged |
| Analyze uploaded XLSX, change Alpha quantity 2 to 4 and export updated XLSX | 24.55 s | Sol / computation | Formulas retained, computed/cached total 957000; source sheet/cells cited |
| Generate a Vietnamese PowerPoint with exactly three slides | 34.26 s | Sol / computation | Valid archive, exactly three slides and QA-DECK-742 marker |

Word create used 501 input / 1416 output tokens, estimated model cost USD
0.00075810, zero tool fees. Word edit used 1565 input / 269 output tokens,
estimated model cost USD 0.00029100, zero tool fees. These are observed sample
results, not a guaranteed latency or invoice amount.

`verify-office-workflows.py` checks real downloaded files using python-docx and
OOXML inspection. `test-word-fast.ts` additionally verifies split-run replacements,
unchanged styles/footer/relationships, exact occurrence counts and routing.
The existing PRO suite passed cached reading, calculation validation, real
provider cancellation, cross-account job access and image-Studio routing.
TypeScript, ESLint and production build passed.

The initial spreadsheet test caught missing cached formula results; that output
was not accepted as a passing verification. The final rerun above passed after
the server-side cache checks and computation instructions were added.

## Scope

No real user documents were used or modified in these tests. Test server
accounts/history/files were removed; downloaded synthetic artifacts remain for
inspection. The user’s already-created JD was not regenerated or replaced.

Content/package checks do not certify all visual layouts in desktop Office.
Complex layout-preserving edits and conversions can still take longer. Provider
latency can also vary. The fast path applies to ordinary new Word documents and
eligible text edits, not every possible Office operation.
