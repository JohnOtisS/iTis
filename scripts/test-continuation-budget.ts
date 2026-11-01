import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { usageEvents, users } from "../db/schema";
import { assertContinuationBudget } from "../lib/token-budget";

const id=randomUUID();const db=getDb();
try {
  await db.insert(users).values({id,email:`${id}@budget-test.invalid`,name:"Synthetic budget QA",passwordHash:"no-login",tokenLimit:10,totalTokenLimit:100});
  await assertContinuationBudget(id);
  await db.insert(usageEvents).values({userId:id,model:"synthetic",inputTokens:10,outputTokens:0,estimatedCostUsd:"0"});
  await assert.rejects(assertContinuationBudget(id),/Token quota reached/);
  await db.update(usageEvents).set({createdAt:new Date(Date.now()-6*3600000),inputTokens:100}).where(eq(usageEvents.userId,id));
  await assert.rejects(assertContinuationBudget(id),/Token quota reached/);
  await db.update(users).set({unlimited:true,totalUnlimited:true}).where(eq(users.id,id));
  await assertContinuationBudget(id);
  await db.update(users).set({isActive:false}).where(eq(users.id,id));
  await assert.rejects(assertContinuationBudget(id),/no longer active/);
  console.log("PASS: paid correction stops at cycle/total quota and disabled account; explicit unlimited permissions respected.");
} finally {
  await db.delete(users).where(eq(users.id,id));
  await globalThis.__itisPostgresPool?.end();
}
