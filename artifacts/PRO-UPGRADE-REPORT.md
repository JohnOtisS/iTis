# iTis Pro workflow upgrade — 2026-11-01

Implemented for the existing Sol/Luna API stack. Image generation remains in
Image Studio. Privacy redaction/routing controls removed in the previous change
remain removed. Account ownership checks and storage quotas remain active.

## Delivered

1. **Long context:** bounded extractive summaries of early instructions and
   milestones, plus full-text retrieval of relevant older messages and 16 recent
   turns. Summaries retain exact excerpts/source IDs rather than inventing facts.
   The persisted summary is reused while its source facts remain unchanged.
2. **Document versions:** stable file URLs, version numbers, source relationships,
   original/latest/explicit-version selection, and a conversation document manifest.
   File lookup is independent of the recent-message context window.
3. **Computation and validation:** actual Python tool execution for numerical
   analysis; required executed-check JSON; Office/PDF output structure checks;
   required output formats checked before publication. One bounded corrective
   follow-up can reuse the same container when verification/output is incomplete.
4. **Jobs:** persisted owner-scoped task status, progress from provider processing,
   background response polling, an explicit provider cancellation endpoint,
   and a Retry action that reuses saved input files. Browser reloads
   can reattach to running task status while the server process remains alive.
5. **Efficiency and costs:** cached local extraction for text/CSV/DOCX/XLSX/PPTX,
   relevant excerpts for simple reading, temporary provider file IDs reused for
   subsequent processing, 1 GiB containers by default, and model/tool/cache/
   reasoning usage breakdown. Ordinary document reading opens no compute container.

Extraction caches are included in account storage usage. Provider file uploads
expire after one hour. Background response records are deleted after completion
or cancellation. The task database record, output messages and local files are
kept under the account until the user deletes them.

## Verification

Latest full workflow fixture:
`chat-audit-2026-11-01T15-43-50-004Z/report.json`.
File inspection:
`chat-audit-2026-11-01T15-43-50-004Z/file-verification.json`.

| Case | Result |
|---|---|
| Realtime arithmetic and follow-up | Passed, 15 then 5 |
| Explicit personal memory across chats | Passed, SEN-XANH-742 |
| Different-user memory isolation | Passed |
| CSV line totals, VAT and source references | Passed, 630000 + 63000 = 693000 |
| Four downloadable formats | Passed: XLSX, DOCX, PDF, PPTX |
| Office archive/PDF signatures and content | Passed for fixture |
| XLSX formulas and cached totals | Passed for fixture |
| Exactly two PPTX slides | Passed |
| Edit existing XLSX without reupload | Passed, updated total 957000 |
| Old-context recall beyond 30 messages | Passed, MAY-TIM-928 |
| Cross-account file downloads | Denied correctly |
| Cached document Q&A without continuation keywords | Passed dedicated suite |
| Simple document Q&A incurs no container charge | Passed dedicated suite |
| Calculation progress and executed verification | Passed dedicated suite |
| Real provider cancellation and no published outputs after stop | Passed dedicated suite |
| Cross-account job access | Denied correctly |
| Explicit version selection and lineage | Passed policy suite |
| Invalid Office/PDF rejection | Passed policy suite |
| Image-generation requests redirected to Studio | Passed dedicated suite |
| Storage, memory permissions and deployment defaults | Regression suites passed |
| TypeScript, ESLint, production build | Passed |

All workflow tests used temporary synthetic accounts and fake document data;
those server accounts and their files were cleaned up. Downloaded synthetic
fixtures remain under artifacts for inspection.

The full run recorded 35,392 model input/output tokens, including a corrective
request, and approximately USD 0.2060113 total estimated model/tool charges.
The historical `modelcostusd` field in that raw report was named before tool
costs were included: interpret it as combined cost. The harness now records
model, tool and total cost separately for subsequent runs. These figures are
not the provider invoice and exclude tax/infrastructure.

## Operational limits

- Context is bounded and retrieval-based; it is not a guarantee of perfect
  verbatim recall for unlimited conversations. The admin session limit still
  applies. Large PDFs may still need the raw provider file path.
- The file verifier checks formats, structure and computed checks. It does not
  certify Word/PPT layout fidelity without rendering. Scanned OCR and complex
  layout-preserving conversion need separate fixtures.
- Jobs are persisted, but a host process termination can interrupt the local
  worker. Stale jobs are cancelled/reported as interrupted and can be retried.
  A separate durable worker service is not included in this implementation.
- Cost estimates use the documented model rates and 1 GiB container/web-search
  charges. Failed/cancelled provider responses may omit final token usage; the
  tool details mark unavailable usage rather than pretending it is exact.
- Complex validation can consume more model tokens than an unverified answer.
  Savings come from selective context, cached extraction, cheap-model routing
  and avoiding unnecessary compute containers, not omitting relevant data.
- Existing historical usage records are not retroactively repriced for past
  tool sessions whose charges were not recorded.

Migration 0010 is applied locally and will run through the existing production
startup migration step on deployment. package-lock.json includes the document
parsers so the Docker npm-ci build remains reproducible.
