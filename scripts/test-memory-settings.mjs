import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const accounts = ["standard", "admin"].map(role => ({ id: randomUUID(), token: randomUUID(), role }));
const origin = "http://127.0.0.1:5173";
const settings = { memoryEnabled: false, autoMemory: false };
async function request(account, path, method, body) {
  return fetch(`${origin}${path}`, { method, headers: { cookie: `itis_session=${account.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
try {
  for (const account of accounts) {
    await pool.query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Memory permission test','not-a-real-login',$3)", [account.id, `${account.id}@memory-test.invalid`, account.role]);
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')", [account.id, createHash("sha256").update(account.token).digest("hex")]);
  }
  const [member, admin] = accounts;
  assert.equal((await request(member, "/api/account/memory", "PATCH", settings)).status, 403, "self-service settings are blocked");
  assert.equal((await request(member, `/api/admin/users/${member.id}`, "PATCH", settings)).status, 403, "members cannot use admin settings");
  assert.equal((await request(admin, "/api/account/memory", "PATCH", settings)).status, 403, "admin also edits via Admin > Users");
  let { rows: [before] } = await pool.query("SELECT memory_enabled,allow_openai_files FROM users WHERE id=$1", [member.id]);
  assert.equal(before.memory_enabled, true);
  assert.equal(before.allow_openai_files, false);
  assert.equal((await request(admin, `/api/admin/users/${member.id}`, "PATCH", settings)).status, 200);
  const result = await request(member, "/api/account/memory", "GET");
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).settings, settings, "member sees admin-assigned policy");
  assert.equal((await request(member, "/api/account/memory", "POST", { content: "Test personal memory" })).status, 403, "disabled memory cannot be written");
  assert.equal((await request(member, "/api/account/memory", "DELETE")).status, 200, "member can still delete their own memories");
  console.log("PASS: self-service blocked, admin-only updates, settings unchanged after rejected requests, policy reflected to user, disabled-memory enforcement, own-memory deletion retained.");
} finally {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [accounts.map(a => a.id)]);
  await pool.end();
}
