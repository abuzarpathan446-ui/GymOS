import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { z } from "zod";
const scrypt = (
  password: string,
  salt: string,
  length: number,
  options: object,
) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, length, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const passwordSchema = z.string().min(12).max(128);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return `scrypt$32768$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, cost, salt, hash] = encoded.split("$");
  if (algorithm !== "scrypt" || cost !== "32768" || !salt || !hash)
    return false;
  const key = (await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === key.length && timingSafeEqual(key, expected);
}
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(code: number, message: string): never {
  throw new HttpError(code, message);
}
export type Role =
  "SUPER_ADMIN" | "OWNER" | "MANAGER" | "RECEPTIONIST" | "TRAINER" | "MEMBER";
export interface Actor {
  id: string;
  organization_id: string | null;
  branch_id: string | null;
  name: string;
  email: string;
  role: Role;
  csrf_token: string;
  token_hash: string;
  permission_overrides?: Record<string, boolean>;
  features?: string[];
}
const permissions: Record<Role, string[]> = {
  SUPER_ADMIN: ["platform"],
  OWNER: [
    "dashboard",
    "members:read",
    "members:account",
    "memberships",
    "payments",
    "attendance",
    "reports",
    "staff",
    "settings",
    "subscription",
    "trainers",
    "workouts",
    "progress",
    "leads",
    "appointments",
    "inventory",
    "notifications",
    "audit",
    "backup",
    "expenses",
    "whatsapp",
  ],
  MANAGER: [
    "members:create",
    "members:edit",
    "members:deactivate",
    "members:account",
    "whatsapp",
    "dashboard",
    "members:read",
    "members:write",
    "memberships",
    "payments",
    "attendance",
    "reports",
    "trainers",
    "workouts",
    "progress",
    "leads",
    "appointments",
    "inventory",
    "notifications",
  ],
  RECEPTIONIST: [
    "members:create",
    "members:edit",
    "members:deactivate",
    "whatsapp",
    "dashboard",
    "members:read",
    "members:write",
    "members:account",
    "payments",
    "attendance",
    "leads",
    "appointments",
    "notifications",
  ],
  TRAINER: ["assigned:read", "workouts", "progress", "appointments"],
  MEMBER: ["self:read"],
};
export function actorPermissions(actor: Actor) {
  const result = new Set(permissions[actor.role]);
  if (["MANAGER", "RECEPTIONIST", "TRAINER"].includes(actor.role))
    for (const [key, value] of Object.entries(actor.permission_overrides ?? {}))
      if (value === false) result.delete(key);
  if (actor.role === "OWNER")
    for (const key of [
      "members:read",
      "members:create",
      "members:edit",
      "members:deactivate",
      "members:account",
    ]) {
      if (actor.permission_overrides?.[key] === true) result.add(key);
      if (actor.permission_overrides?.[key] === false) result.delete(key);
    }
  return [...result];
}
export function rolePermissions(role: Role) {
  return permissions[role].filter((p) => p !== "members:write");
}
export function authorize(actor: Actor, permission: string) {
  if (!actorPermissions(actor).includes(permission))
    fail(403, "You do not have permission for this action.");
}
export function publicActor(a: Actor) {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    role: a.role,
    organization_id: a.organization_id,
    permissions: actorPermissions(a),
    features: a.features ?? [],
    csrf_token: a.csrf_token,
  };
}
