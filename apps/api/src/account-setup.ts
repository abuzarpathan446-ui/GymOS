import { z } from "zod";
import type { Executor } from "./db.js";
import { digest, fail, token } from "./security.js";
import { portals, portalForRole } from "../../shared/access.js";
export const deliverySchema = z.enum(["LINK", "EMAIL"]).default("EMAIL");
export async function createAccountSetup(
  tx: Executor,
  user: {
    id: string;
    email: string;
    organization_id: string | null;
    role: string;
  },
  delivery: "LINK" | "EMAIL",
) {
  if (
    delivery === "EMAIL" &&
    (!process.env.SMTP_HOST || !process.env.EMAIL_FROM)
  )
    fail(
      503,
      "Email delivery is not configured. Choose a setup link to create the account without email.",
    );
  const raw = token();
  const setupUrl = `${process.env.APP_ORIGIN ?? "http://localhost:5173"}/reset-password#${raw}`;
  await tx.query(
    "INSERT INTO access_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '48 hours')",
    [digest(raw), user.id, delivery === "LINK" ? "SETUP" : "INVITE"],
  );
  const loginPath = portals[portalForRole(user.role)].login;
  if (delivery === "EMAIL") {
    await tx.query(
      "INSERT INTO outbox(organization_id,kind,payload) VALUES($1,'EMAIL',$2)",
      [
        user.organization_id,
        JSON.stringify({
          to: user.email,
          subject: "Your GymOS account",
          text: `Set your password within 48 hours: ${setupUrl}\nThen sign in at ${process.env.APP_ORIGIN ?? "http://localhost:5173"}${loginPath}`,
        }),
      ],
    );
    return {
      invitation: "QUEUED",
      status: "QUEUED",
      email: user.email,
      login_path: loginPath,
      message: "Account created. Password setup email queued for delivery.",
    };
  }
  return {
    invitation: "LINK_CREATED",
    status: "LINK_CREATED",
    email: user.email,
    login_path: loginPath,
    setup_url: setupUrl,
    expires_in_hours: 48,
    message:
      "Account created. Share this one-time setup link privately so the account holder can choose their password.",
  };
}
