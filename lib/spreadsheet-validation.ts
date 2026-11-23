import {unzipSync} from "fflate";
import {XMLParser} from "fast-xml-parser";
import {documentRequestText} from "@/lib/document-request";
import {isSpreadsheetFormattingOnly} from "@/lib/spreadsheet-policy";

type Node=Record<string,unknown>;
const list=(v:unknown):Node[]=>Array.isArray(v)?v:v&&typeof v==="object"?[v as Node]:[];
export function workbookSnapshot(bytes:Uint8Array) {
  let expanded=0;
  const zip=unzipSync(bytes,{filter:file=>{
    if(!/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml|vbaProject\.bin)$/.test(file.name))return false;
    expanded+=file.originalSize;
    if(expanded>32*1024**2)throw new Error("Workbook validation exceeds its size budget.");
    return true;
  }});
  const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false});
  const parse=(name:string)=>zip[name]?parser.parse(new TextDecoder().decode(zip[name])):{};
  const workbook=parse("xl/workbook.xml").workbook;
  if(!workbook)throw new Error("Missing workbook metadata.");
  const relations=list(parse("xl/_rels/workbook.xml.rels").Relationships?.Relationship);
  const sheets=list(workbook.sheets?.sheet).map(sheet=>{
    const relation=relations.find(r=>r["@_Id"]===sheet["@_id"]);
    const target=String(relation?.["@_Target"]??"").replace(/^\/?xl\//,"").replace(/^\//,"");
    const worksheet=parse(`xl/${target}`).worksheet;
    if(!worksheet)throw new Error(`Missing worksheet ${String(sheet["@_name"])}.`);
    const rows=list(worksheet.sheetData?.row).filter(row=>list(row.c).some(cell=>cell.f!==undefined || String(cell.v??"")!=="" || cell.is!==undefined));
    const formulas=new Map(rows.flatMap(row=>list(row.c).filter(c=>typeof c.f==="string").map(c=>[String(c["@_r"]),JSON.stringify(c.f)] as const)));
    return {name:String(sheet["@_name"]),rows:rows.length,formulas};
  });
  return {sheets,macro:zip["xl/vbaProject.bin"]};
}

export function workbookPreservationIssues(original:Uint8Array,output:Uint8Array,prompt:string,operation:string|null|undefined,retainMacros=false) {
  const before=workbookSnapshot(original),after=workbookSnapshot(output),issues:string[]=[];
  const text=documentRequestText(prompt);
  const changesStructure=/\b(?:loc|filter|dedup\w*|trung|gop|tach|pivot|unpivot|transpose|nhom|tong hop|bao cao|summary|report|group|merge|join|split|(?:xoa|bo|them|chen|insert|add|delete|remove|rename|doi ten) (?:cac |mot |nhieu |\d+ )?(?:dong|hang|sheet|row|worksheet)|chi (?:lay|giu)|top\s*\d+|only (?:keep|export))\b/.test(text);
  if((operation==="edit"||operation==="sort")&&!changesStructure){
    for(const source of before.sheets){
      const target=after.sheets.find(s=>s.name===source.name);
      if(!target){issues.push(`Original sheet ${source.name} is missing.`);continue;}
      const addsTotals=target.rows>source.rows&&/\b(?:tong|subtotal|total|grand total)\b/.test(text);
      if(target.rows!==source.rows&&!addsTotals)issues.push(`Sheet ${source.name} changed from ${source.rows} populated rows to ${target.rows} without a requested row transformation.`);
      const formatOnly=isSpreadsheetFormattingOnly(prompt);
      if(formatOnly)for(const [cell,formula] of source.formulas)if(target.formulas.get(cell)!==formula)issues.push(`Formatting changed the original formula at ${source.name}!${cell}.`);
    }
  }
  if(retainMacros&&before.macro&&(!after.macro||before.macro.length!==after.macro.length||before.macro.some((v,i)=>v!==after.macro![i])))issues.push("The original VBA project was lost or modified; preserve it without running macros.");
  return issues.slice(0,12);
}
