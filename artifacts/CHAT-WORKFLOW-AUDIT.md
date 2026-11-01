# iTis chat workflow audit — 2026-11-01

Tested through the running iTis HTTP API with two temporary synthetic accounts.
Real OpenAI requests used the existing Luna/Sol configuration. No real user
documents or conversations were used. Test accounts, their histories and server
attachments were removed after each run. Downloaded synthetic samples remain
beside the reports for reproducibility.

## Applied changes requested during testing

- Removed Strict/Balanced privacy controls and the raw-file permission switch
  from the admin dialog and account status panel.
- Removed content redaction, sensitivity-based Local fallback and privacy file
  blocking from Chat and Image Studio. Provider follows the admin's global switch.
- Existing legacy privacy columns remain in PostgreSQL for compatibility but
  are no longer consulted or exposed through account settings.
- Account authentication, ownership checks, memory encryption, upload size/type
  constraints and storage quotas remain in place.
- Fixed the realtime input serializer: previously it passed local `attachments`
  metadata as an extra OpenAI message property. The provider rejected this with
  `Unknown parameter: input[1].attachments`. Only role/content are now sent.

## Latest run results

Source: `chat-audit-2026-11-01T15-18-29-050Z/report.json` and
`chat-audit-2026-11-01T15-18-29-050Z/file-verification.json`.
The synthetic accounts deliberately retained legacy strict/file-blocked values;
the successful file calls demonstrate that those old flags no longer block work.

| Case | Result | Evidence |
|---|---|---|
| Realtime chat | Pass | Completed Luna stream, arithmetic answer 15 |
| Ordinary JSON chat | Pass | Same answer 15 |
| Follow-up in same conversation | Pass | Dividing prior answer into 3 groups gives 5 |
| Automatic personal memory | Pass | Explicit HanhTinh procedure code saved |
| Recall in a new conversation | Pass | SEN-XANH-742 recalled |
| Different-account memory isolation | Pass | Other account answered that it did not know |
| CSV analysis | Pass | 630,000 subtotal, 63,000 VAT, 693,000 total |
| Four output formats | Pass, structure/content | XLSX, DOCX, PDF, PPTX were downloadable |
| XLSX formulas | Pass for fixture | Line multiplication, SUM and VAT formulas plus cached totals verified |
| DOCX/PDF totals | Pass for fixture | Expected totals in extracted text; Vietnamese text present in PDF |
| PPTX count/content | Pass for fixture | Exactly 2 slides with expected total |
| Attachment ownership | Pass | All four downloads denied to second account |
| Edit earlier XLSX without reupload | Pass | Updated Alpha quantity to 4; formula/cached total 957,000 |
| Recall beyond last 30 messages | Fail | First message contained MAY-TIM-928; model no longer received it and answered incorrectly that the first message contained no code |

Generating the four small documents took 44 seconds in this sample; editing the
spreadsheet took 13 seconds. These are observations, not performance guarantees.
No image generation was requested.

Latest run: 15,805 total input/output tokens, including 2,964 cached input tokens.
App-recorded model cost: USD 0.05044010. This does **not** include Code Interpreter
container fees, web/tool fees, tax or infrastructure. It is not a complete bill.

## Limits of this evaluation

The Office files were inspected as OOXML archives and their contents/formulas
checked. PDF text was extracted. No full desktop Office rendering or visual QA
was performed, so this does not certify polished layout. This is a small smoke
test, not a statistically meaningful model-quality benchmark.

Scanned PDF OCR, legacy Office formats/POTX, layout-preserving Word-to-PDF,
large workbooks, long multi-document tasks, cancellation during document creation,
web-search factual accuracy, concurrent user load and interruption/recovery still
need dedicated fixtures. Passing simple generated files does not establish those.

## Recommended next work, in order

1. **Long-conversation context.** Replace silent last-30-message truncation with
   a bounded factual summary plus recent turns and selective retrieval of older
   turns. Preserve decisions, definitions, filenames and source references.
   Treat the session's displayed token total separately from the actual request
   input budget and reserved output allowance. The existing memory_summary column
   is not currently used by the chat route.
2. **Document references across the whole conversation.** Track input/output
   versions and dependencies by stable file IDs, not just the most recent message
   with attachments. File reuse currently depends on matching continuation words;
   follow-ups with different wording can lose document access.
3. **Deterministic data processing and reusable extraction.** Cache extracted
   text/tables by content hash, retrieve relevant sections, and run calculations
   with a computation tool when accuracy matters. A broad task label should not
   send every document request to the expensive model. Keep bounded reusable
   instructions for prompt caching, and measure actual cost per successful task.
4. **Document jobs and validation.** Separate planning, execution, file validation
   and download publication. Show real job progress, cancellation and retry state.
   Enforce the requested formats/count, verify output signatures and formulas,
   and render before claiming presentation/layout fidelity. Current document
   fetches do not propagate the request cancellation signal to provider work.
5. **Stable personal preferences.** Include a small bounded profile/style section
   and retrieve task-specific knowledge separately. Add correction/supersession
   support so old and new preferences do not compete. Current local embedding
   calls may wait up to 1.8 seconds per lookup/save, even with OpenAI selected.
6. **Routing and observability.** Keep Luna for simple work and Sol for complex
   work; classify using task/history/file characteristics rather than just regex.
   The 80/20 setting is currently a displayed target, not an enforced routing
   allocation. Report cache, reasoning, tool/container charges and failure costs.
   Distinguish provider/API errors from context, quota and format failures.
7. **Keep image generation in Studio.** Chat's default output-extension fallback
   still includes PNG; make image-generation requests link to Studio, while keeping
   document reading/analysis and requested document exports in Chat.

No broad rewrite of these remaining areas was performed as part of this audit.
Only the requested privacy-mode removal and the verified realtime serializer
defect were changed in application behavior.

## Re-running

- `node --env-file=.env.local scripts/audit-chat-workflows.mjs` — incurs real provider charges.
- `python -X utf8 scripts/verify-audit-files.py <report-folder>` — structural/content checks.
- Existing memory-permission, deployment-default and storage suites also passed.
