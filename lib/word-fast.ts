import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { z } from "zod";

const escapeXml = (value:string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const unescapeXml = (value:string) => value.replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const wordDraftSchema=z.object({filename:z.string().max(120),title:z.string().min(1).max(300),summary:z.string().max(1000),blocks:z.array(z.object({type:z.enum(["heading","paragraph","bullet","table"]),text:z.string().max(6000),rows:z.array(z.array(z.string().max(2000))).max(100)})).min(1).max(100)});
export const wordDraftFormat={type:"json_schema",name:"word_document",strict:true,schema:{type:"object",additionalProperties:false,properties:{filename:{type:"string"},title:{type:"string"},summary:{type:"string"},blocks:{type:"array",items:{type:"object",additionalProperties:false,properties:{type:{type:"string",enum:["heading","paragraph","bullet","table"]},text:{type:"string"},rows:{type:"array",items:{type:"array",items:{type:"string"}}}},required:["type","text","rows"]}}},required:["filename","title","summary","blocks"]}};
export const wordEditSchema=z.object({summary:z.string().max(1000),replacements:z.array(z.object({from:z.string().min(1).max(4000),to:z.string().max(6000),occurrences:z.number().int().min(1).max(100)})).min(1).max(30)});
export const wordEditFormat={type:"json_schema",name:"word_edit",strict:true,schema:{type:"object",additionalProperties:false,properties:{summary:{type:"string"},replacements:{type:"array",items:{type:"object",additionalProperties:false,properties:{from:{type:"string"},to:{type:"string"},occurrences:{type:"integer"}},required:["from","to","occurrences"]}}},required:["summary","replacements"]}};

function paragraph(text:string,style="Normal") {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}
export function buildWord(draft:z.infer<typeof wordDraftSchema>) {
  let body=paragraph(draft.title,"Title");
  for(const block of draft.blocks){
    if(block.type==="table"){
      if(!block.rows.length||block.rows.some(row=>!row.length||row.length>10))throw new Error("Invalid document table.");
      const columns=Math.max(...block.rows.map(row=>row.length));
      body+='<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+["top","left","bottom","right","insideH","insideV"].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="CBD5E1"/>`).join("")+'</w:tblBorders></w:tblPr>';
      body+=`<w:tblGrid>${Array.from({length:columns},()=>'<w:gridCol w:w="'+Math.floor(9000/columns)+'"/>').join("")}</w:tblGrid>`;
      body+=block.rows.map((row,i)=>`<w:tr>${Array.from({length:columns},(_,col)=>row[col]??"").map(cell=>`<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000/columns)}" w:type="dxa"/>${i===0?'<w:shd w:fill="E6F0F3"/>':""}</w:tcPr>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`).join("");
      body+='</w:tbl>'+paragraph("");
    }else body+=paragraph(block.type==="bullet"?`• ${block.text}`:block.text,block.type==="heading"?"Heading1":"Normal");
  }
  body+='<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/></w:sectPr>';
  const files:Record<string,Uint8Array>={
    "[Content_Types].xml":strToU8(declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'),
    "_rels/.rels":strToU8(declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml":strToU8(declaration+`<w:document xmlns:w="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`),
    "word/_rels/document.xml.rels":strToU8(declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'),
    "word/styles.xml":strToU8(declaration+`<w:styles xmlns:w="${ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="280"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="155E75"/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="155E75"/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`),
    "word/footer1.xml":strToU8(declaration+`<w:ftr xmlns:w="${ns}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`),
  };
  for(const bytes of Object.values(files))if(XMLValidator.validate(strFromU8(bytes))!==true)throw new Error("Generated document XML is invalid.");
  return zipSync(files,{level:6});
}

export function readEditableWord(bytes:Uint8Array){
  let expanded=0;
  const files=unzipSync(bytes,{filter:entry=>{expanded+=entry.originalSize;if(expanded>32*1024**2)throw new Error("Word file exceeds fast-edit budget.");return true;}});
  const xml=strFromU8(files["word/document.xml"]??new Uint8Array());
  if(!xml||/<w:(?:ins|del)\b|<!DOCTYPE|<!ENTITY/i.test(xml)||Object.keys(files).some(name=>/vbaProject|embeddings\//.test(name)))throw new Error("This document needs the full editing workflow.");
  const paragraphs=[...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(p=>[...p[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(t=>unescapeXml(t[1])).join(""));
  const text=paragraphs.join("\n");
  if(text.length>24000)throw new Error("Word file needs the full editing workflow.");
  return {files,xml,text};
}
export function editWord(source:ReturnType<typeof readEditableWord>,plan:z.infer<typeof wordEditSchema>){
  let xml=source.xml;
  for(const edit of plan.replacements){
    if(edit.from===edit.to)throw new Error("Edit must change the original text.");
    let count=0;
    xml=xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,paragraph=>{
      const nodes=[...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)];
      const text=nodes.map(n=>unescapeXml(n[1])).join("");
      const originals=nodes.map(n=>unescapeXml(n[1]));const values=[...originals];
      let at=text.lastIndexOf(edit.from);
      while(at>=0){
        count++;const end=at+edit.from.length;let offset=0;
        for(let i=0;i<values.length;i++){
          const nodeEnd=offset+originals[i].length;
          if(offset<end&&nodeEnd>at){const startIn=Math.max(0,at-offset),endIn=Math.min(originals[i].length,end-offset);values[i]=values[i].slice(0,startIn)+(at>=offset?edit.to:"")+values[i].slice(endIn);}
          offset=nodeEnd;
        }
        if(at===0)break;
        at=text.lastIndexOf(edit.from,at-1);
        // Stop before index zero is clamped back to zero by lastIndexOf.
        if(count>100)throw new Error("Ambiguous replacement.");
      }
      let result=paragraph;
      for(let i=nodes.length-1;i>=0;i--){const node=nodes[i];if(values[i]===originals[i])continue;const replacement=node[0].slice(0,node[0].indexOf(">")+1)+escapeXml(values[i])+"</w:t>";result=result.slice(0,node.index)+replacement+result.slice(node.index!+node[0].length);}
      return result;
    });
    if(count!==edit.occurrences)throw new Error(`Replacement occurrence mismatch: expected ${edit.occurrences}, found ${count}.`);
  }
  if(XMLValidator.validate(xml)!==true)throw new Error("Edited document XML is invalid.");
  return zipSync({...source.files,"word/document.xml":strToU8(xml)},{level:6});
}
