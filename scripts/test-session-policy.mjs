// Disposable accounts only; never changes a real user's sessions or sends mail.
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { Pool } from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import assert from "node:assert/strict";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:15174";
const ids = [randomUUID(), randomUUID()];
const email = ids[1] + "@qa.invalid";
const password = randomBytes(20).toString("hex");
const adminToken = randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("hex");
async function api(token, path, body, method = body ? "POST" : "GET") {
  return fetch(origin + path, {
    method, headers: { "content-type": "application/json", ...(token ? { cookie: `itis_session=${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(supplied = password) {
  const r = await api(null, "/api/auth/login", { email, password: supplied });
  assert.equal(r.status, 200, await r.clone().text());
  const token = /itis_session=([^;]+)/.exec(r.headers.get("set-cookie") || "")?.[1];
  assert.ok(token);
  return token;
}
const active = async token => (await api(token, "/api/account/notifications")).status;
const patch = async (value, id = ids[1]) => {
  const r = await api(adminToken, `/api/admin/users/${id}`, value, "PATCH");
  assert.equal(r.status, 200, await r.clone().text());
};
const count = async () => Number((await pool.query("select count(*) from sessions where user_id=$1", [ids[1]])).rows[0].count);
try {
  const passwordHash = await bcrypt.hash(password, 12);
  for (let i = 0; i < 2; i++) await pool.query("insert into users(id,email,name,password_hash,role) values($1,$2,'Session policy QA',$3,$4)", [ids[i], i ? email : ids[i] + "@qa.invalid", passwordHash, i ? "standard" : "admin"]);
  await pool.query("insert into sessions(user_id,token_hash,expires_at,created_at) values($1,$2,now()+interval '1 hour',now()-interval '1 minute')", [ids[0], hash(adminToken)]);
  const a = await login(), b = await login();
  assert.deepEqual(await Promise.all([active(a), active(b)]), [200, 200]);
  assert.equal(await count(), 2);
  assert.equal((await api(null, "/api/auth/login", { email, password: "incorrect" })).status, 401);
  assert.equal(await active(a), 200);
  console.log("PASS default multi-session and incorrect password preserve existing sessions");

  await patch({ allowMultipleSessions: false });
  assert.deepEqual(await Promise.all([active(a), active(b)]), [401, 200]);
  const c = await login();
  assert.deepEqual(await Promise.all([active(b), active(c)]), [401, 200]);
  assert.equal(await count(), 1);
  console.log("PASS admin switching to single retains newest session; new login revokes previous");

  const concurrent = await Promise.all(Array.from({ length: 4 }, () => login()));
  const statuses = await Promise.all(concurrent.map(active));
  assert.equal(statuses.filter(s => s === 200).length, 1);
  assert.equal(statuses.filter(s => s === 401).length, 3);
  assert.equal(await active(c), 401);
  assert.equal(await count(), 1);
  const survivor = concurrent[statuses.indexOf(200)];
  console.log("PASS four concurrent logins leave exactly one valid session");

  assert.equal((await api(survivor, `/api/admin/users/${ids[1]}`, { allowMultipleSessions: true }, "PATCH")).status, 403);
  assert.equal((await api(survivor, "/api/account", { name: "Session policy QA", email, allowMultipleSessions: true }, "PATCH")).status, 200);
  assert.equal((await pool.query("select allow_multiple_sessions from users where id=$1", [ids[1]])).rows[0].allow_multiple_sessions, false);
  console.log("PASS standard account cannot change session policy through admin or profile API");

  await patch({ allowMultipleSessions: true });
  const d = await login(), e = await login();
  assert.deepEqual(await Promise.all([survivor, d, e].map(active)), [200, 200, 200]);
  assert.equal(await count(), 3);
  console.log("PASS re-enabling multi-session preserves all subsequent sign-ins");

  const newerAdmin = randomBytes(32).toString("base64url");
  await pool.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')", [ids[0], hash(newerAdmin)]);
  await patch({ allowMultipleSessions: false }, ids[0]);
  assert.deepEqual(await Promise.all([active(adminToken), active(newerAdmin)]), [200, 401]);
  console.log("PASS admin editing own policy preserves current session");

  const created = await api(adminToken, "/api/admin/users", { email: randomUUID() + "@qa.invalid", name: "Created single-session QA", password, sendWelcome: false, allowMultipleSessions: false });
  assert.equal(created.status, 201, await created.clone().text());
  const createdId = (await created.json()).user.id;
  ids.push(createdId);
  assert.equal((await pool.query("select allow_multiple_sessions from users where id=$1", [createdId])).rows[0].allow_multiple_sessions, false);
  const listed = await (await api(adminToken, "/api/admin/users")).json();
  assert.equal(listed.users.find(u => u.id === createdId).allowMultipleSessions, false);
  console.log("PASS account creation and admin listing honor single-session policy");

  const heartbeat = token => api(token, "/api/account/activity", undefined, "POST");
  const activity = async () => Number((await pool.query("select active_seconds from users where id=$1", [ids[1]])).rows[0].active_seconds);
  assert.equal((await heartbeat(null)).status, 401);
  assert.equal((await heartbeat(d)).status, 204);
  assert.equal(await activity(), 0);
  await pool.query("update users set activity_ping_at=now()-interval '60 seconds' where id=$1", [ids[1]]);
  assert.deepEqual(await Promise.all([d,e].map(async token => (await heartbeat(token)).status)), [204,204]);
  const measured = await activity();
  assert.ok(measured >= 59 && measured <= 65, `Expected a single minute, recorded ${measured}s`);
  await pool.query("update users set activity_ping_at=now()-interval '6 minutes' where id=$1", [ids[1]]);
  assert.equal((await heartbeat(d)).status, 204);
  assert.equal(await activity(), measured);
  console.log("PASS activity deduplicates devices and ignores idle gaps");

  const before = listed.users.find(u => u.id === ids[1]);
  const tokenGrant = { id: randomUUID(), amount: 125_000 };
  await Promise.all([
    patch({ tokenGrant }),
    patch({ tokenGrant }),
    patch({ tokenGrant: { id: randomUUID(), amount: 25_000 } }),
  ]);
  const refreshed = (await (await api(adminToken, "/api/admin/users")).json()).users.find(u => u.id === ids[1]);
  assert.equal(refreshed.totalTokenLimit, before.totalTokenLimit + 150_000);
  assert.equal(refreshed.usedTokens, before.usedTokens);
  assert.equal(refreshed.activeSeconds, measured);
  console.log("PASS concurrent token grants add to allocation and retries cannot double-credit");

  await patch({ accessExpiresAt: new Date(Date.now()+60_000).toISOString() });
  assert.equal(await active(e), 200);
  await pool.query("update users set access_expires_at=now()-interval '1 second' where id=$1", [ids[1]]);
  assert.equal(await active(e), 401);
  assert.equal((await heartbeat(e)).status, 401);
  assert.equal((await api(null, "/api/auth/login", {email,password})).status, 403);
  await patch({ accessExpiresAt: new Date(Date.now()+3_600_000).toISOString() });
  assert.equal(await active(e), 401);
  assert.equal(await active(await login()), 200);
  console.log("PASS deadline blocks login and old sessions; renewal requires a fresh login");

  await patch({ isActive: false });
  assert.equal(await count(), 0);
  assert.equal(await active(e), 401);
  console.log("PASS disabling account revokes all sessions");
} finally {
  await pool.query("delete from users where id=any($1::uuid[])", [ids]);
  await pool.end();
}
