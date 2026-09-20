import { useState } from "react";
import { api } from "./api";
import { Form, Modal } from "./components";
export function StaffAccess({
  staff,
  onSaved,
}: {
  staff: any;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (staff.role === "OWNER") return null;
  const permissions = (staff.allowed_permissions ?? []) as string[];
  return (
    <>
      <button onClick={() => setOpen(true)}>Edit access</button>
      {open && (
        <Modal
          title={`Staff access — ${staff.name}`}
          onClose={() => setOpen(false)}
        >
          <Form
            initial={{
              name: staff.name,
              email: staff.email,
              ...Object.fromEntries(
                permissions.map((k) => [
                  k,
                  String(staff.permission_overrides?.[k] !== false),
                ]),
              ),
              all_members: String(
                !!staff.permission_overrides?.["trainer:all"],
              ),
            }}
            fields={[
              { name: "name", label: "Name" },
              { name: "email", label: "Email", type: "email" },
              ...permissions.map((k) => ({
                name: k,
                label: k.replaceAll(":", " "),
                type: "select",
                options: [
                  { value: "true", label: "Allowed" },
                  { value: "false", label: "Blocked" },
                ],
              })),
              ...(staff.role === "TRAINER"
                ? [
                    {
                      name: "all_members",
                      label: "Trainer member scope",
                      type: "select",
                      options: [
                        { value: "false", label: "Assigned members only" },
                        { value: "true", label: "All members in this gym" },
                      ],
                    },
                  ]
                : []),
            ]}
            onSubmit={async (p) => {
              await api(`/staff/${staff.id}/access`, "PUT", {
                name: p.name,
                email: p.email,
                permissions: Object.fromEntries(
                  permissions.map((k) => [k, p[k] === "true"]),
                ),
                all_members: p.all_members === "true",
              });
              setOpen(false);
              onSaved();
            }}
          />
        </Modal>
      )}
    </>
  );
}
