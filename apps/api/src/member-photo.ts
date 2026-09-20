import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "./app.js";
import { one, audit } from "./db.js";
import { fail } from "./security.js";
export async function registerMemberPhoto(
  app: FastifyInstance,
  { run }: Services,
) {
  app.put("/api/members/:id/photo", (req) =>
    run(req, "members:edit", async (tx, a) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        { photo } = z
          .object({
            photo: z
              .string()
              .max(220000)
              .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/)
              .nullable(),
          })
          .strict()
          .parse(req.body);
      if (photo) {
        const bytes = Buffer.from(photo.split(",")[1], "base64");
        if (
          photo.startsWith("data:image/png")
            ? bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
            : bytes.subarray(0, 3).toString("hex") !== "ffd8ff"
        )
          fail(400, "Upload a valid PNG or JPEG image.");
      }
      const row = await one(
        tx,
        "UPDATE members SET photo=$3 WHERE id=$1 AND organization_id=$2 RETURNING id",
        [id, a.organization_id, photo],
      );
      if (!row) fail(404, "Member not found.");
      await audit(tx, a.organization_id, a.id, "member.photo_updated", id);
      return { ok: true };
    }),
  );
}
