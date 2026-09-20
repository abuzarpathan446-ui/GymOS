import { one, type Executor } from "./db.js";
import { fail } from "./security.js";
export function resolvedFeatures(
  plan: string[],
  overrides: Record<string, boolean> = {},
) {
  const features = new Set(plan);
  features.delete("whatsapp_chat");
  features.delete("automated_whatsapp");
  features.delete("member_workouts");
  for (const [name, enabled] of Object.entries(overrides))
    enabled ? features.add(name) : features.delete(name);
  return [...features];
}
export async function accessPolicy(tx: Executor, org: string) {
  const row = await one(
    tx,
    `SELECT o.access_overrides,p.features,p.member_limit,p.staff_limit FROM organizations o JOIN subscriptions s ON s.organization_id=o.id JOIN subscription_plans p ON p.id=s.plan_id WHERE o.id=$1`,
    [org],
  );
  return {
    features: resolvedFeatures(
      row?.features ?? [],
      row?.access_overrides?.features,
    ),
    limits: {
      member: row?.member_limit ?? 0,
      staff: row?.staff_limit ?? 0,
      ...row?.access_overrides?.limits,
    },
  };
}
export async function entitlement(
  tx: Executor,
  org: string,
  feature?: string,
  limit?: "member" | "staff" | "TRAINER" | "RECEPTIONIST" | "MANAGER",
) {
  const s = await one(
    tx,
    `SELECT s.*,p.name,p.features,p.member_limit,p.staff_limit,p.price_paise FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 FOR UPDATE OF s`,
    [org],
  );
  if (!s) fail(403, "No platform subscription is configured.");
  const valid =
    ["ACTIVE", "TRIAL"].includes(s.status) &&
    new Date(s.renews_at) > new Date();
  const grace =
    s.status === "PAST_DUE" &&
    s.grace_until &&
    new Date(s.grace_until) > new Date();
  if (!valid && !grace)
    fail(
      403,
      "Your GymOS subscription requires renewal. Existing data is retained and can be exported.",
    );
  const policy = await accessPolicy(tx, org);
  s.features = policy.features;
  s.member_limit = policy.limits.member;
  s.staff_limit = policy.limits.staff;
  if (feature && !policy.features.includes(feature))
    fail(
      403,
      `${feature.replaceAll("_", " ")} is unavailable. Please contact the Super Admin.`,
    );
  if (limit) {
    const count =
      limit === "member"
        ? await one(
            tx,
            "SELECT count(*)::int AS n FROM members WHERE organization_id=$1 AND active",
            [org],
          )
        : limit === "staff"
          ? await one(
              tx,
              "SELECT count(*)::int AS n FROM users WHERE organization_id=$1 AND active AND role NOT IN ('MEMBER','OWNER')",
              [org],
            )
          : await one(
              tx,
              "SELECT count(*)::int AS n FROM users WHERE organization_id=$1 AND active AND role=$2",
              [org, limit],
            );
    if (count.n >= (policy.limits[limit] ?? policy.limits.staff))
      fail(
        409,
        `You have reached your current ${limit === "member" ? "member" : limit === "staff" ? "staff" : limit.toLowerCase()} limit. Please contact the Super Admin to increase your limit.`,
      );
  }
  return s;
}
