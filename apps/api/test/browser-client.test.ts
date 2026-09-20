import { test } from "node:test";
import assert from "node:assert/strict";
import { connectDatabase, migrate, context, one } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/security.js";
import { api, ApiError, setCsrf } from "../../web/src/api.js";

process.env.NODE_ENV = "test";
test("real frontend request helper logs out without a JSON body and revokes all portal sessions", async () => {
  const db = await connectDatabase(undefined, true);
  await migrate(db);
  const password = "Client-regression-only-913";
  const hash = await hashPassword(password);
  await context(db, null, true, async (tx) => {
    const org = await one(
      tx,
      "INSERT INTO organizations(name,slug,email) VALUES('Client Gym','client-gym','client@example.test') RETURNING id",
    );
    for (const role of [
      "SUPER_ADMIN",
      "OWNER",
      "RECEPTIONIST",
      "TRAINER",
      "MEMBER",
    ])
      await tx.query(
        "INSERT INTO users(name,email,role,organization_id,password_hash) VALUES($1,$2,$1,$3,$4)",
        [
          role,
          `${role.toLowerCase()}@client.test`,
          role === "SUPER_ADMIN" ? null : org.id,
          hash,
        ],
      );
  });
  const app = await createApp(db);
  const originalFetch = globalThis.fetch;
  let cookie = "";
  globalThis.fetch = async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    if (cookie) headers.cookie = cookie;
    const response = await app.inject({
      method: (init?.method ?? "GET") as any,
      url: String(input),
      headers,
      payload: init?.body as string | undefined,
    });
    const setCookie = response.headers["set-cookie"];
    if (setCookie)
      cookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
        .map((c) => c.split(";")[0])
        .join("; ");
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    for (const [role, portal] of [
      ["SUPER_ADMIN", "admin"],
      ["OWNER", "owner"],
      ["RECEPTIONIST", "staff"],
      ["TRAINER", "staff"],
      ["MEMBER", "member"],
    ]) {
      const login = await api(`/${portal}/auth/login`, "POST", {
        email: `${role.toLowerCase()}@client.test`,
        password,
      });
      setCsrf(login.user.csrf_token);
      assert.equal((await api("/auth/me")).user.role, role);
      if(role==='SUPER_ADMIN')await assert.rejects(
        api('/admin/gyms','POST',{name:'Invalid Gym',slug:'bad@slug',owner_name:'Owner',email:'invalid@client.test',plan_id:'BASIC',delivery:'LINK'}),
        (error:unknown)=>error instanceof ApiError && error.status===400 && error.fields.some(f=>f.path==='slug' && f.message.includes('Example: iron-fitness')),
      );
      const previousCookie = cookie;
      assert.deepEqual(await api("/auth/logout", "POST"), { ok: true });
      assert.equal(cookie, "gymos_session=");
      assert.equal(
        (
          await app.inject({
            url: "/api/auth/me",
            headers: { cookie: previousCookie },
          })
        ).statusCode,
        401,
      );
      await assert.rejects(api("/auth/me"), /sign in/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
    setCsrf("");
    await app.close();
    await db.close();
  }
});
