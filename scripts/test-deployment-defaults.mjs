import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adminId = randomUUID();
const token = randomUUID();
const createdIds = [adminId];
try {
  await pool.query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Defaults test','not-a-real-login','admin')", [adminId, `${adminId}@defaults-test.invalid`]);
  await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')", [adminId, createHash("sha256").update(token).digest("hex")]);
  const headers = { cookie: `itis_session=${token}`, "content-type": "application/json" };
  const origin = "http://127.0.0.1:5173";
  const settingsResponse = await fetch(`${origin}/api/admin/settings`, { headers });
  assert.equal(settingsResponse.status, 200);
  const { settings } = await settingsResponse.json();
  assert.equal(settings.chatLimits.maxContextTokens, 50000);
  assert.equal(settings.tokenReset.windowHours, 5);
  assert.equal(settings.modelRouter.enabled, true);
  for (const role of ["standard", "plus", "admin"]) {
    const plan = settings.roleLimits[role];
    assert.deepEqual(plan, role === "standard" ? { cycleTokens: 100000, cycleUnlimited: false, totalTokens: 1000000, totalUnlimited: false } : role === "plus" ? { cycleTokens: 250000, cycleUnlimited: false, totalTokens: 3000000, totalUnlimited: false } : { cycleTokens: 2000000, cycleUnlimited: true, totalTokens: 0, totalUnlimited: true });
    const response = await fetch(`${origin}/api/admin/users`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "Defaults test", email: `${randomUUID()}@defaults-test.invalid`, password: randomUUID(), role }),
    });
    assert.equal(response.status, 201);
    const { user } = await response.json();
    createdIds.push(user.id);
    const { rows: [row] } = await pool.query("SELECT token_limit,total_token_limit,reset_window_hours,storage_limit_bytes,unlimited,total_unlimited FROM users WHERE id=$1", [user.id]);
    assert.equal(Number(row.token_limit), plan.cycleTokens);
    assert.equal(Number(row.total_token_limit), plan.totalTokens);
    assert.equal(row.reset_window_hours, 5);
    assert.equal(Number(row.storage_limit_bytes), 2 * 1024 ** 3);
    assert.equal(row.unlimited, plan.cycleUnlimited);
    assert.equal(row.total_unlimited, plan.totalUnlimited);
  }
  const custom = await fetch(`${origin}/api/admin/users`, { method: "POST", headers, body: JSON.stringify({name:"Custom quota QA", email:`${randomUUID()}@defaults-test.invalid`, password:randomUUID(), role:"standard", tokenLimit:1234,totalTokenLimit:5678}) });
  assert.equal(custom.status,201);
  const {user:customUser} = await custom.json(); createdIds.push(customUser.id);
  const save = await fetch(`${origin}/api/admin/settings`, {method:"PATCH",headers,body:JSON.stringify({roleLimits:settings.roleLimits})});
  assert.equal(save.status,200);
  const {rows:[retained]} = await pool.query("SELECT token_limit,total_token_limit FROM users WHERE id=$1",[customUser.id]);
  assert.equal(Number(retained.token_limit),1234);assert.equal(Number(retained.total_token_limit),5678);
  const conversations=[];
  for(let i=0;i<2;i++){
    const {rows:[chat]}=await pool.query("INSERT INTO conversations(user_id,title) VALUES($1,'Synthetic capacity QA') RETURNING id",[customUser.id]);conversations.push(chat.id);
    await pool.query("INSERT INTO chat_jobs(user_id,conversation_id) VALUES($1,$2)",[customUser.id,chat.id]);
  }
  const form=new FormData();form.set("prompt","Liệt kê nội dung file đính kèm.");form.append("files",new Blob(["Item\nAlpha\n"]),"qa.csv");
  const customToken=randomUUID();await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')",[customUser.id,createHash("sha256").update(customToken).digest("hex")]);
  const blocked=await fetch(`${origin}/api/chat`,{method:"POST",headers:{cookie:`itis_session=${customToken}`},body:form});
  assert.equal(blocked.status,429);assert.equal((await blocked.json()).code,"ACCOUNT_TASK_LIMIT");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM usage_events WHERE user_id=$1",[customUser.id])).rows[0].n),0);
  await fetch(`${origin}/api/conversations`,{method:"DELETE",headers:{cookie:`itis_session=${customToken}`}});
  console.log("PASS: distinct Standard/Plus/Admin defaults, role-aware server creation, unchanged custom allocations, 50K/session and 2 GiB storage.");
  console.log("PASS: two concurrent document tasks block another paid job across conversations.");
} finally {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [createdIds]);
  await pool.end();
}
