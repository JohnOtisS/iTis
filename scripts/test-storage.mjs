import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ids = [randomUUID(), randomUUID()];
const testFileId = `${randomUUID()}.txt`;
const testPath = join(resolve(process.env.GENERATED_FILES_DIR || "storage/files"), testFileId);
try {
  for (const id of ids) await pool.query(`INSERT INTO users(id,email,name,password_hash,storage_limit_bytes) VALUES($1,$2,'Storage test','not-a-real-login',1000)`, [id, `${id}@storage-test.invalid`]);
  const owner = ids[0];
  const [{ status: a }, { status: b }] = await Promise.allSettled([
    pool.query("INSERT INTO stored_files(url,user_id,bytes) VALUES($1,$2,600)", [`test:${randomUUID()}`, owner]),
    pool.query("INSERT INTO stored_files(url,user_id,bytes) VALUES($1,$2,600)", [`test:${randomUUID()}`, owner]),
  ]);
  assert.equal([a,b].filter(s => s === "fulfilled").length, 1, "concurrent uploads must share the same capacity");
  const { rows: [other] } = await pool.query("SELECT coalesce(sum(bytes),0) AS bytes FROM stored_files WHERE user_id=$1", [ids[1]]);
  assert.equal(Number(other.bytes), 0, "accounts must be isolated");
  const { rows: [chat] } = await pool.query("INSERT INTO conversations(user_id,title) VALUES($1,'Test') RETURNING id", [owner]);
  await assert.rejects(pool.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'user',$2)", [chat.id, "a".repeat(500)]), /Storage quota exceeded/);
  await pool.query("DELETE FROM stored_files WHERE user_id=$1", [owner]);
  await pool.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'user',$2)", [chat.id, "a".repeat(500)]);
  const { rows: [before] } = await pool.query("SELECT itis_history_bytes($1) AS bytes", [owner]);
  assert.equal(Number(before.bytes), 506, "UTF-8 content and attachment metadata count toward storage");
  await pool.query("UPDATE users SET storage_limit_bytes=0 WHERE id=$1", [owner]);
  const { rows: [retained] } = await pool.query("SELECT count(*) AS count FROM messages WHERE conversation_id=$1", [chat.id]);
  assert.equal(Number(retained.count), 1, "lowering quota must preserve existing data");
  await pool.query("DELETE FROM conversations WHERE id=$1", [chat.id]);
  const { rows: [after] } = await pool.query("SELECT itis_history_bytes($1) AS bytes", [owner]);
  assert.equal(Number(after.bytes), 0, "deleting chat frees history storage");
  if (process.argv.includes("--http")) {
    await pool.query("UPDATE users SET storage_limit_bytes=1000000,role='admin' WHERE id=$1", [owner]);
    const token = randomUUID();
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')", [owner, createHash("sha256").update(token).digest("hex")]);
    const headers = { cookie: `itis_session=${token}`, "content-type": "application/json" };
    const origin = "http://127.0.0.1:5173";
    const account = await fetch(`${origin}/api/account`, { headers });
    assert.equal(account.status, 200, "account endpoint");
    assert.equal((await account.json()).storage.limitBytes, 1000000);
    const admin = await fetch(`${origin}/api/admin/users`, { headers });
    assert.equal(admin.status, 200, "admin users endpoint");
    const create = await fetch(`${origin}/api/conversations`, { method: "POST", headers, body: JSON.stringify({ title: "Storage HTTP test" }) });
    assert.equal(create.status, 201);
    const { conversation } = await create.json();
    const url = `/api/files/${testFileId}`;
    await mkdir(resolve(process.env.GENERATED_FILES_DIR || "storage/files"), { recursive: true });
    await writeFile(testPath, "test fixture");
    await pool.query("INSERT INTO stored_files(url,user_id,bytes) VALUES($1,$2,12)", [url, owner]);
    await pool.query("INSERT INTO messages(conversation_id,role,content,attachments) VALUES($1,'user','test',$2)", [conversation.id, JSON.stringify([{ name: "test.txt", url, size: 12 }])]);
    const remove = await fetch(`${origin}/api/conversations/${conversation.id}`, { method: "DELETE", headers });
    assert.equal(remove.status, 200);
    await assert.rejects(stat(testPath), { code: "ENOENT" });
    const { rows: [fileCount] } = await pool.query("SELECT count(*) AS count FROM stored_files WHERE url=$1", [url]);
    assert.equal(Number(fileCount.count), 0, "physical delete releases quota");
    const patch = await fetch(`${origin}/api/admin/users/${owner}`, { method: "PATCH", headers, body: JSON.stringify({ storageLimitBytes: 0 }) });
    assert.equal(patch.status, 200);
    const blocked = await fetch(`${origin}/api/conversations`, { method: "POST", headers, body: JSON.stringify({ title: "Blocked" }) });
    assert.equal(blocked.status, 413, "HTTP quota error must be readable");
    console.log("PASS HTTP: account/admin storage, real attachment unlink, quota release, admin quota update, full-account rejection.");
  }
  console.log("PASS: concurrent quota enforcement, account isolation, history quota, file capacity release, lowered quota preserves data, cascade cleanup.");
} finally {
  await unlink(testPath).catch(error => { if (error.code !== "ENOENT") throw error; });
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await pool.end();
}
