export type UploadLimits={maxFileMb:number;maxTotalMb:number;maxFiles:number};
export const defaultUploadLimits:UploadLimits={maxFileMb:20,maxTotalMb:50,maxFiles:10};
export const MB=1024**2;
export function validUploadLimits(value:UploadLimits){return Number.isInteger(value.maxFileMb)&&value.maxFileMb>=1&&value.maxFileMb<=50&&Number.isInteger(value.maxTotalMb)&&value.maxTotalMb>=value.maxFileMb&&value.maxTotalMb<=50&&Number.isInteger(value.maxFiles)&&value.maxFiles>=1&&value.maxFiles<=10;}
export function normalizeUploadLimits(value:unknown):UploadLimits{
  const candidate=value&&typeof value==="object"?value as UploadLimits:null;
  return candidate&&validUploadLimits(candidate)?{maxFileMb:candidate.maxFileMb,maxTotalMb:candidate.maxTotalMb,maxFiles:candidate.maxFiles}:{...defaultUploadLimits};
}
export function uploadError(files:ReadonlyArray<{size:number;name?:string}>,limits:UploadLimits,vi=false){
  if(files.length>limits.maxFiles)return vi?`Tối đa ${limits.maxFiles} tệp mỗi lượt.`:`Up to ${limits.maxFiles} files per upload.`;
  const oversized=files.find(f=>f.size>limits.maxFileMb*MB);
  if(oversized){const name=(oversized.name??"File").slice(0,120);const size=(oversized.size/MB).toFixed(2);return vi?`“${name}” (${size} MB) vượt giới hạn ${limits.maxFileMb} MB/tệp do admin thiết lập.`:`“${name}” (${size} MB) exceeds the admin's ${limits.maxFileMb} MB per-file limit.`;}
  if(files.reduce((n,f)=>n+f.size,0)>limits.maxTotalMb*MB)return vi?`Tổng dung lượng tệp vượt giới hạn ${limits.maxTotalMb} MB mỗi lượt.`:`Combined attachments exceed the ${limits.maxTotalMb} MB upload limit.`;
  return null;
}
