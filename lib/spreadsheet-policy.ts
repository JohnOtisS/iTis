import {deliverableExtensions,documentRequestText,outputExtensions,sourceFormatText} from "@/lib/document-request";
import type {ChatAttachment} from "@/lib/chat-files";

export const isSpreadsheet = (file: {name:string}) => /\.(xlsx|xlsm|xls|csv|tsv)$/i.test(file.name);
export function isSpreadsheetFormattingOnly(prompt:string) {
  const text=documentRequestText(prompt).replace(/\bchuyen sau\b/g,"in depth");
  return /\b(?:dinh dang|format|reformat|can le|to mau|ke vien|wrap text|freeze panes?|autofit)\b/.test(text)
    && !/\b(?:sua|thay|tinh|them|xoa|doi|replace|calculate|insert|delete|add|remove|cong thuc moi|new formula)\b/.test(text);
}

export function spreadsheetOperation(prompt:string) {
  const text=documentRequestText(prompt).replace(/\bchuyen sau\b/g,"in depth");
  if (/^\s*(?:(?:bro|ban|hay|vui long|please)\s+)*(?:cach|huong dan|lam sao|how (?:to|do|can)|explain how)\b/.test(text)) return null;
  // Preserve negative constraints without mistaking them for requested edits.
  if (/\b(?:la gi|nghia la gi)\s*[?.!]*$|^\s*(?:what is|explain)\b/.test(text)) return null;
  const action=text.replace(/\b(?:khong|dung|do not|don't)\s+(?:xoa|sua|doi|them|chen|loc|sap xep|delete|edit|change|add|insert|filter|sort)\b.*?(?=[,;.!?\n]|\b(?:nhung|ma|but|then)\b|$)/g," ");
  if(/^\s*(?:(?:hay|vui long|please)\s+)*(?:chuyen|convert|luu|save|export|xuat|tai|download|gui|send)\b/.test(action)
    && /\b(?:excel|xlsx|xlsm|csv|tsv|pdf|word|docx)\b/.test(action))return "convert";
  if (/\b(?:dinh dang|chuan hoa|format|reformat|normalize|can (?:le|chinh)|to mau|ke vien|xuong dong|wrap text|freeze panes?|autofit|danh so thu tu|chuyen chu hoa|chu thuong|fill down|conditional formatting|data validation|danh sach chon|tao bieu do|create (?:a )?chart)\b/.test(action)
    && !/\b(?:dinh dang (?:gi|nao)|format (?:is|does)|what (?:is|format))\b/.test(action)) return "edit";
  if (/\b(?:sap (?:xep|theo|thu tu)|xep (?:theo|lai|tu|danh sach|tuoi)|sort(?:ing)?|reorder|tang dan|giam dan|ascending|descending|tu (?:cao|thap) (?:xuong|len))\b/.test(action)) return "sort";
  if (/\b(?:loc|filter(?:ing)?|khu trung|(?:bo|xoa|loai bo) (?:dong )?trung|deduplicat(?:e|ion))\b/.test(action)) return "filter";
  if (/\b(?:sua|chinh|thay doi|doi(?! chieu)|thay the|cap nhat|dien|bo sung|them|chen|xoa|gop|tach|noi|tron|dien|edit|modify|replace|update|insert|delete|add|append|merge|split|join|fill|remove|rename|pivot|unpivot|transpose)\b[^.!?\n]{0,120}\b(?:ngay|thang|nam sinh|tuoi|cot|dong|o|sheet|bang|cong thuc|du lieu|gia tri|ten|ma|date|birth|columns?|rows?|cells?|formulas?|values?|headers?|sheets?|tables?|data|records?|[a-z]{1,3}\d+)\b/.test(action)
    || /\b(?:bo sung|pivot|unpivot|transpose|vlookup|xlookup|sumifs?|countifs?)\b/.test(action)
    || /\b(?:tinh|calculate|compute)\b[^.!?\n]{0,60}\b(?:cot|o|cong thuc|column|cell|formula)\b/.test(action)) return "edit";
  if (/\b(?:chuyen|convert|export|xuat|tai|download|luu|save|gui|send)\b[^.!?\n]{0,60}\b(?:excel|xlsx|xlsm|csv|tsv|pdf|word|docx)\b/.test(action)) return "convert";
  if (/\b(?:phan tich|du lieu|xep hang|thong ke|nhom theo|dem|bao nhieu|top|cao tuoi nhat|tre tuoi nhat|lon nhat|nho nhat|tinh|tong|doi chieu|so sanh|analy[sz]\w*|data|rank\w*|count|group by|oldest|youngest|highest|lowest|calculate|compute|total|reconcile|compare)\b/.test(action)) return "read";
  return null;
}

export function wantsSpreadsheetFile(prompt:string,operation:ReturnType<typeof spreadsheetOperation>) {
  if(!operation || operation==="read")return false;
  const text=documentRequestText(prompt);
  return !/\b(?:chi (?:can )?(?:phan tich|liet ke|tra loi|hien thi)|analysis only|tra loi trong chat|khong (?:can )?(?:sua|xuat|tao|gui) (?:them )?(?:file|tep|excel|xlsx|csv)|(?:answer|show|list) (?:only )?in chat|(?:no|without|do not create) (?:an? |any )?(?:file|spreadsheet))\b/.test(text);
}

export function spreadsheetDeliverables(prompt:string,documents:ChatAttachment[],operation:ReturnType<typeof spreadsheetOperation>) {
  const explicit=outputExtensions(prompt);
  if(explicit.length)return explicit;
  if(operation && documents.length && documents.every(isSpreadsheet))return documents.length===1&&/\.xlsm$/i.test(documents[0].name)?[".xlsm"]:[".xlsx"];
  return deliverableExtensions(prompt,documents);
}

export function singleSpreadsheetOutput(prompt:string,formats:string[]) {
  return formats.length===1 && [".xlsx",".xlsm"].includes(formats[0])
    && !/\b(?:(?:hai|ba|bon|nhieu|[2-9]\d*|multiple|two|three|separate) (?:file|tep|bang|workbooks?)|(?:moi|tung) (?:file|sheet)|each (?:file|sheet))\b/.test(documentRequestText(prompt));
}

// Explicit references and comparisons retain the normal catalog selection.
// Otherwise continue the latest workbook, rather than reapplying edits to its old source.
export function spreadsheetRevisionSources(catalog:ChatAttachment[],prompt:string,recentFiles:ChatAttachment[],latestFiles=recentFiles) {
  const recent=recentFiles.filter(isSpreadsheet);
  if(!recent.length)return null;
  const text=documentRequestText(prompt);
  const conversion=text.search(/\b(?:sang|thanh|qua|ra|to|into|as)\s+(?:(?:file|tep|ban|bang|dinh dang|format|the|a)\s+)*(?:pdf|docx|word|xlsx|excel|xlsm|csv|tsv)\b/);
  const source=conversion>=0?text.slice(0,conversion):sourceFormatText(prompt);
  if(!latestFiles.some(isSpreadsheet)&&!/\b(?:excel|xlsx|xlsm|xls|csv|tsv)\b/.test(source))return null;
  if (/\b(?:file goc|tep goc|ban goc|original|v(?:ersion)?\s*\d+|ban\s+\d+|doi chieu|so sanh|gop|noi|tron|tat ca|ca hai|nhieu file|merge|join|compare|reconcile|all files)\b/.test(text))return null;
  if(catalog.some(file=>text.includes(documentRequestText(file.name))))return null;
  const workbookSource=/\b(?:excel|xlsx|xlsm|xls)\b/.test(source);
  if(workbookSource&&recent.every(file=>/\.(csv|tsv)$/i.test(file.name))){
    const workbook=catalog.find(file=>/\.(xlsx|xlsm|xls)$/i.test(file.name));
    return workbook?[workbook]:null;
  }
  // Asking to export a new format does not change the format of the source.
  if(outputExtensions(prompt).length || spreadsheetOperation(prompt))return recent;
  return null;
}

export function spreadsheetInstructions(prompt:string,operation:ReturnType<typeof spreadsheetOperation>,artifact:boolean,referenceDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh"}).format(new Date())) {
  const text=documentRequestText(prompt);
  const parts=[`Working date: ${referenceDate}, Asia/Ho_Chi_Minh; use the user's explicit cutoff when supplied. Spreadsheet workflow: inspect the complete originals with Python, list sheet names and header/data ranges, detect title/footer/total rows and actual records, then execute the latest request. Do not infer record counts from excerpts, max_row alone or old assistant replies. Reuse the active revised workbook for follow-up edits. Preserve unrelated sheets, values, identifier strings/leading zeros, formulas, styles, hyperlinks, merges, tables, validations and print settings. Do not run macros. Use openpyxl for XLSX/XLSM (keep_vba=True when retaining XLSM), xlrd for XLS. When using pandas, explicitly preserve identifier columns as strings; never let dtype inference or numeric casts strip their leading zeros. Never silently drop rows, sheets or unsupported features.`];
  if(artifact)parts.push("Return the requested final file formats only; default to XLSX for spreadsheet modifications, including XLS input. A completion claim requires a downloadable file. Do not publish converted source copies, diagnostic files or previews. Only modify requested data; create a new output, keeping the original intact. Reopen every final output with its reader and verify the requested transformation against the original, unchanged data, row counts and important totals. Record executed checks in itis-validation.json.");
  if(/\b(?:ngay|tuoi|sinh|date|birth|age)\b/.test(text))parts.push("Dates/age: identify the correct date columns from headers and cell types. Preserve the 1900/1904 epoch. For Vietnamese date normalization use day-first, default dd/mm/yyyy, and convert complete date strings to actual dates, not just number formats. Preserve blanks, invalid dates and year-only/partial dates; report exceptions without inventing day/month/year. Distinguish serial dates from identifiers. Calculate completed age on the user's exact cutoff (or today's supplied date, explicitly state the cutoff), accounting for whether the birthday has occurred. Interpret '16 đến dưới 18' as >=16 and <18. Do not substitute birth year for exact age, infer birth from identity numbers by default or change original birth values merely because they look unusual. If date fields conflict, identify them and retain unresolved records separately.");
  if(operation==="sort"||operation==="filter")parts.push("Sorting/filtering: move whole records with associated cell formatting and hyperlinks, keep headers and totals separate. Use stable tie-breaking, preserve every record unless filtering/limit was requested, and verify the count/order/predicate on every eligible original record. Sort descending age by ascending birth date; do not invent dates for year-only records. Missing/invalid keys must be handled explicitly, not silently lost. A previous top-N limit does not apply to a new unrestricted request.");
  if(/\b(?:tinh|tong|tien|thue|phan tram|ty le|lam tron|cong thuc|doi chieu|calculate|sum|total|tax|percent|formula|lookup|reconcile|vlookup|xlookup|sumifs?|countifs?)\b/.test(text))parts.push("Calculations: infer units, Vietnamese decimal/grouping conventions and percentages from the source. Use Decimal for money and the specified rounding rule. Distinguish blank from zero, exclude headers/subtotals from totals, avoid double counting, and check computed totals independently from raw inputs. Do not guess tax rates or financial rules. For formulas use valid Excel syntax/relative references, retain formulas AND verified calculated caches; reopen with data_only=True and compare results. Never put Python expressions in Excel formulas, fabricate cached values or replace formulas with static values when formulas were requested. Flag external links/unsupported calculations precisely.");
  if(/\b(?:gop|noi|doi chieu|trung|tach|nhom|pivot|join|merge|match|reconcile|dedup\w*|split|group)\b/.test(text))parts.push("Joins/grouping: determine matching keys from the request and headers. Retain identifier text and meaningful leading zeros. Do not fuzzy-match distinct people automatically. Check key uniqueness, duplicated/blank keys, unmatched records and many-to-many expansion before joining. Keep an exceptions sheet when needed; verify source and output counts/totals. Deduplicate only by the requested fields and retention rule, preserving unrelated records.");
  if(artifact && outputExtensions(prompt).some(ext=>[".csv",".tsv",".pdf",".docx"].includes(ext)))parts.push("Conversion: CSV/TSV carries one table, no workbook styles/formulas; export computed values with proper quoting, UTF-8 BOM, requested delimiter and preserved identifier text. For multiple sheets, create separately named files unless one sheet was explicitly selected; never silently discard other sheets. Warn briefly that spreadsheet programs can auto-coerce CSV identifiers; offer XLSX when exact Excel types are essential. PDF must include all requested columns/rows with readable pagination and repeated headers. Word tables must contain the requested data, not a status message. Use only the requested output formats; do not claim XLSX is the only supported output.");
  return parts.join("\n");
}
