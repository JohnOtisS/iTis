import { createHash } from "node:crypto";
import { extname } from "node:path";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, storedFiles } from "@/db/schema";
import { readChatFile, type ChatAttachment } from "@/lib/chat-files";
import { relevantExcerpt } from "@/lib/chat-context";

const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
const textTypes = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".js", ".ts", ".py", ".sql"]);
function xmlText(xml: Uint8Array) {
  // Validate XML first; extract text without resolving external entities.
  const raw = new TextDecoder().decode(xml);
  parser.parse(raw);
  return raw.replace(/<\/(?:w:p|a:p|row|c)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/ +/g," ");
}
export function inspectDocument(bytes: Uint8Array, name: string) {
  const extension = extname(name).toLowerCase();
  if (textTypes.has(extension)) return new TextDecoder().decode(bytes).slice(0, 60000);
  if (![".docx", ".xlsx", ".pptx"].includes(extension)) return null;
  let expanded = 0;
  const zip = unzipSync(bytes, { filter: entry => {
    const relevant = /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/(workbook|sharedStrings|worksheets\/sheet\d+)\.xml|xl\/_rels\/workbook\.xml\.rels)$/.test(entry.name);
    if (!relevant) return false;
    expanded += entry.originalSize;
    if (entry.originalSize > 8 * 1024 ** 2 || expanded > 32 * 1024 ** 2) throw new Error("Document is too large to extract safely; use the computation tool.");
    return true;
  } });
  if (extension === ".xlsx") return spreadsheetText(zip).slice(0, 60000);
  return Object.entries(zip).map(([path,data]) => `[${path}]\n${xmlText(data)}`).join("\n").slice(0,60000);
}
function spreadsheetText(zip: Record<string, Uint8Array>) {
  const reader = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false, processEntities: false });
  const read = (path: string) => zip[path] ? reader.parse(new TextDecoder().decode(zip[path])) : {};
  const list = (v: unknown): Array<Record<string, unknown>> => Array.isArray(v) ? v : v && typeof v === "object" ? [v as Record<string, unknown>] : [];
  const decode = (v: string) => v.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
  const text = (v: unknown): string => typeof v === "string" ? decode(v) : v && typeof v === "object" ? Object.entries(v).filter(([k]) => !k.startsWith("@_")).map(([, item]) => Array.isArray(item) ? item.map(text).join("") : text(item)).join("") : "";
  const strings = list(read("xl/sharedStrings.xml").sst?.si).map(text);
  const relations = list(read("xl/_rels/workbook.xml.rels").Relationships?.Relationship);
  const sheetNames = new Map(list(read("xl/workbook.xml").workbook?.sheets?.sheet).map(sheet => {
    const rel = relations.find(r => r["@_Id"] === sheet["@_id"]);
    const target = String(rel?.["@_Target"] ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
    return [`xl/${target}`, String(sheet["@_name"] ?? "")];
  }));
  return Object.entries(zip).filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).map(([path]) => {
    const lines: string[] = [];
    for (const row of list(read(path).worksheet?.sheetData?.row)) {
      const cells = list(row.c).map(cell => {
        const raw = String(cell.v ?? "");
        const value = cell["@_t"] === "s" ? strings[Number(raw)] ?? "[unresolved shared string]" : cell["@_t"] === "inlineStr" ? text(cell.is) : raw;
        return `${cell["@_r"]}: ${value}${cell.f !== undefined ? ` [formula: ${text(cell.f)}]` : ""}`;
      });
      lines.push(cells.join(" | "));
    }
    return `[sheet: ${sheetNames.get(path) || path}]\n${lines.join("\n")}`;
  }).join("\n");
}
export function validateOutput(bytes: Uint8Array, name: string) {
  const extension = extname(name).toLowerCase();
  if (bytes.byteLength === 0) throw new Error(`Empty output file: ${name}`);
  if (extension === ".pdf" && new TextDecoder().decode(bytes.slice(0,5)) !== "%PDF-") throw new Error(`Invalid PDF: ${name}`);
  if ([".docx", ".xlsx", ".pptx"].includes(extension)) {
    let expanded = 0;
    const expected = extension === ".docx" ? "word/document.xml" : extension === ".xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml";
    const zip = unzipSync(bytes, { filter: entry => {
      expanded += entry.originalSize;
      if (expanded > 64 * 1024 ** 2) throw new Error("Output archive exceeds validation budget.");
      return entry.name === expected || entry.name === "[Content_Types].xml";
    } });
    if (!zip[expected] || !zip["[Content_Types].xml"]) throw new Error(`Invalid Office output: ${name}`);
  }
}
export function spreadsheetIssues(bytes:Uint8Array,requireFormulas=false){
  let expanded=0;
  const files=unzipSync(bytes,{filter:entry=>{if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))return false;expanded+=entry.originalSize;if(expanded>32*1024**2)throw new Error("Spreadsheet validation exceeds its size budget.");return true;}});
  const reader=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false});
  const issues:string[]=[];let formulas=0;
  const list=(value:unknown):Array<Record<string,unknown>>=>Array.isArray(value)?value:value&&typeof value==="object"?[value as Record<string,unknown>]:[];
  for(const [name,xml] of Object.entries(files)){
    const parsed=reader.parse(new TextDecoder().decode(xml));
    for(const row of list(parsed.worksheet?.sheetData?.row))for(const cell of list(row.c)){
      if(cell["@_t"]==="e")issues.push(`${name}:${cell["@_r"]} contains spreadsheet error ${String(cell.v)}.`);
      if(cell.f===undefined)continue;formulas++;
      if(cell["@_t"]!=="str"&&(cell.v===undefined||cell.v===""))issues.push(`${name}:${cell["@_r"]} has a formula but no calculated cached value.`);
      else if(!["str","b","e"].includes(String(cell["@_t"])) && !Number.isFinite(Number(cell.v)))issues.push(`${name}:${cell["@_r"]} has an invalid numeric formula result.`);
    }
  }
  if(requireFormulas&&!formulas)issues.push("The requested spreadsheet formulas are missing.");
  return issues.slice(0,12);
}

export async function documentCatalog(conversationId: string) {
  const rows = await getDb().select({ attachments: messages.attachments }).from(messages)
    .where(and(eq(messages.conversationId, conversationId),sql`jsonb_array_length(${messages.attachments}) > 0`)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(500);
  return [...new Map(rows.flatMap(row => row.attachments as ChatAttachment[]).map(file => [file.url,file])).values()].slice(0,80);
}
export function selectDocuments(catalog: ChatAttachment[], prompt: string) {
  const lower = prompt.toLowerCase();
  const extensions = ["xlsx","docx","pptx","pdf","csv"].filter(ext => lower.includes(ext) || (ext === "xlsx" && /excel/.test(lower)) || (ext === "docx" && /word/.test(lower)));
  const named = catalog.filter(file => lower.includes(file.name.toLowerCase()) || lower.includes(file.name.toLowerCase().replace(/\.[^.]+$/, "")));
  let candidates = named.length ? named : /\b(original|source)\b|file gốc|tệp gốc/i.test(prompt) ? catalog.filter(file => file.kind === "input") : catalog;
  const requestedVersions = [...prompt.matchAll(/\bv(?:ersion)?\s*(\d+)|bản\s+(\d+)/gi)].map(match=>Number(match[1]??match[2]));
  if (requestedVersions.length) candidates = candidates.filter(file => requestedVersions.includes(file.version ?? 1));
  if (!named.length && extensions.length) {
    const matching = candidates.filter(file => extensions.includes(extname(file.name).slice(1).toLowerCase()));
    if (matching.length) candidates = matching;
  }
  const seen = new Set<string>();
  return candidates.filter(file => {
    const key = `${file.family ?? file.name.toLowerCase()}:${extname(file.name)}${requestedVersions.length?`:${file.version??1}`:""}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, /compare|đối chiếu|so sánh|tất cả|all files/i.test(prompt) ? 10 : 4);
}
export function versionOutput(file: ChatAttachment, sources: ChatAttachment[], catalog: ChatAttachment[]): ChatAttachment {
  const previous = sources.find(source => extname(source.name) === extname(file.name));
  const family = previous?.family ?? previous?.url ?? file.url;
  const version = Math.max(0, ...catalog.filter(item => (item.family ?? item.url) === family).map(item => item.version ?? 1)) + 1;
  return { ...file, family, version, sourceUrls: sources.map(item => item.url) };
}
export async function prepareDocument(file: ChatAttachment, userId: string, query: string) {
  const [record] = await getDb().select().from(storedFiles).where(and(eq(storedFiles.url,file.url),eq(storedFiles.userId,userId))).limit(1);
  if (!record) throw new Error(`Stored document unavailable: ${file.name}`);
  const id = file.url.replace(/^\/api\/files\//, "");
  const bytes = await readChatFile(id);
  if (!bytes) throw new Error(`Stored document unavailable: ${file.name}`);
  const hash = record.contentHash ?? createHash("sha256").update(bytes).digest("hex");
  let extracted = record.extractedText;
  if (extracted === null || (/\.xlsx$/i.test(file.name) && !extracted.startsWith("[sheet:"))) {
    try { extracted = inspectDocument(bytes,file.name); } catch { extracted = null; }
    await getDb().update(storedFiles).set({contentHash:hash,extractedText:extracted}).where(eq(storedFiles.url,file.url));
  }
  return { file, bytes: new Uint8Array(bytes), excerpt: extracted ? relevantExcerpt(extracted,query,5000) : null, cached: record.extractedText !== null, providerFileId: record.providerFileId, providerExpiresAt: record.providerExpiresAt };
}
export async function providerFile(document: Awaited<ReturnType<typeof prepareDocument>>, signal: AbortSignal) {
  if (document.providerFileId && document.providerExpiresAt && document.providerExpiresAt.getTime() > Date.now()+60000) return document.providerFileId;
  const form = new FormData();
  form.set("purpose","user_data"); form.set("expires_after[anchor]","created_at"); form.set("expires_after[seconds]","3600");
  form.set("file",new Blob([document.bytes]),document.file.name);
  const response = await fetch("https://api.openai.com/v1/files", {method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form,signal});
  if (!response.ok) throw new Error(`Document upload failed (${response.status}).`);
  const data = await response.json() as {id:string;expires_at?:number};
  await getDb().update(storedFiles).set({providerFileId:data.id,providerExpiresAt:new Date((data.expires_at ?? Date.now()/1000+3600)*1000)}).where(eq(storedFiles.url,document.file.url));
  return data.id;
}
