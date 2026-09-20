import { connectDatabase, migrate } from "./db.js";
import { createApp } from "./app.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import staticPlugin from "@fastify/static";
const db = await connectDatabase();
if (!process.env.DATABASE_URL) await migrate(db);
if (process.env.NODE_ENV === "production") {
  if (!process.env.APP_ORIGIN?.startsWith("https://"))
    throw new Error("Production APP_ORIGIN must use HTTPS");
  const role = (
    await db.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (role.rolsuper || role.rolbypassrls)
    throw new Error("Runtime database user must not bypass row security");
}
const app = await createApp(db);
if (existsSync("dist/web")) {
  await app.register(staticPlugin, { root: resolve("dist/web") });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/")
      ? reply.code(404).send({ error: "Not found" })
      : reply.sendFile("index.html"),
  );
}
const stop = async () => {
  await app.close();
  await db.close();
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await app.listen({
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST ?? "0.0.0.0",
});
