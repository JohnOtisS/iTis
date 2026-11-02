import {sql} from "drizzle-orm";
import {getDb} from "@/db";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
  try{await getDb().execute(sql`select 1`);return Response.json({status:"ready",release:process.env.ITIS_RELEASE_SHA??"development"},{headers:{"Cache-Control":"no-store"}});}
  catch{return Response.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
