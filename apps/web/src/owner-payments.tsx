import { useState } from "react";
import { api, money, date, today } from "./api";
import {
  Form,
  Modal,
  PageHeader,
  State,
  Table,
  Pagination,
  useData,
  type Field,
} from "./components";
export function paymentRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const initialOwnerPaymentFields: Field[] = [
  {
    name: "amount_rupees",
    label: "Amount received for GymOS (₹)",
    type: "number",
    min: 0,
    step: "0.01",
    required: false,
    hint: "Optional. Enter money already received from this owner. Leave blank if unpaid.",
  },
  {
    name: "paid_on",
    label: "Payment date",
    type: "date",
    defaultValue: today(),
  },
  {
    name: "method",
    label: "Payment method",
    type: "select",
    defaultValue: "UPI",
    options: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"].map((value) => ({
      value,
      label: value.replaceAll("_", " "),
    })),
  },
  { name: "reference", label: "Transaction / reference ID", required: false },
  {
    name: "payment_notes",
    label: "Payment notes / period covered",
    type: "textarea",
    required: false,
  },
];
export function withInitialOwnerPayment(p: any, key: string) {
  const {
    amount_rupees,
    paid_on,
    method,
    reference,
    payment_notes,
    ...account
  } = p;
  return {
    ...account,
    ...(Number(amount_rupees) > 0
      ? {
          initial_payment: {
            amount_paise: Math.round(Number(amount_rupees) * 100),
            paid_on,
            method,
            reference,
            notes: payment_notes,
            idempotency_key: key,
          },
        }
      : {}),
  };
}
export function OwnerPayments() {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [open, setOpen] = useState(false),
    [key, setKey] = useState(""),
    [message, setMessage] = useState("");
  const d = useData(
    `/admin/owner-payments?q=${encodeURIComponent(q)}&page=${page}`,
  );
  const accounts = useData(
    `/admin/owner-payments/accounts?q=${encodeURIComponent(q)}`,
  );
  return (
    <>
      <PageHeader
        title="Owner Payments"
        description="Money received from gyms for GymOS. Manually recorded payments do not charge an account or change a subscription."
        action={
          <button
            className="primary"
            onClick={() => {
              setKey(paymentRequestId());
              setOpen(true);
              setMessage("");
            }}
          >
            Record payment
          </button>
        }
      />
      <input
        aria-label="Search owner payments"
        placeholder="Search gym, owner or email"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <State {...d} retry={d.reload}>
        {d.data && (
          <>
            <div className="notice">
              Total collected:{" "}
              <strong>{money(d.data.summary.collected_paise)}</strong> ·{" "}
              {d.data.summary.count} payment records
              {q ? " matching your search" : ""}
            </div>
            <section className="card">
              <Table
                rows={d.data.items}
                columns={[
                  {
                    label: "Gym / Owner",
                    render: (r) => (
                      <>
                        {r.gym_name}
                        <small className="block">
                          {r.owner_name} · {r.email}
                        </small>
                      </>
                    ),
                  },
                  {
                    label: "Amount received",
                    render: (r) => money(r.amount_paise),
                  },
                  { label: "Payment date", render: (r) => date(r.paid_on) },
                  {
                    label: "Method / Reference",
                    render: (r) => (
                      <>
                        {r.method.replaceAll("_", " ")}
                        <small className="block">{r.reference}</small>
                      </>
                    ),
                  },
                  { label: "Notes", render: (r) => r.notes || "—" },
                  {
                    label: "Recorded by",
                    render: (r) => (
                      <>
                        {r.recorded_by_name}
                        <small className="block">{date(r.created_at)}</small>
                      </>
                    ),
                  },
                ]}
              />
              <Pagination
                page={page}
                total={d.data.summary.count}
                onChange={setPage}
              />
            </section>
          </>
        )}
      </State>
      {open && (
        <Modal title="Record owner payment" onClose={() => setOpen(false)}>
          <State {...accounts} retry={accounts.reload}>
            {accounts.data && (
              <>
                <p>
                  Choose from the first 50 matching owners. Use the page search
                  to find another owner.
                </p>
                <Form
                  fields={[
                    {
                      name: "owner_id",
                      label: "Gym / Owner",
                      type: "select",
                      options: accounts.data.items.map((u: any) => ({
                        value: u.id,
                        label: `${u.gym_name} — ${u.name} (${u.email})`,
                      })),
                    },
                    ...initialOwnerPaymentFields.map((f) =>
                      f.name === "amount_rupees"
                        ? {
                            ...f,
                            required: true,
                            min: 0.01,
                            hint: "Amount already received. Each payment is saved separately.",
                          }
                        : f,
                    ),
                  ]}
                  submit="Save payment record"
                  onSubmit={async (p) => {
                    const payload = withInitialOwnerPayment(p, key);
                    await api("/admin/owner-payments", "POST", {
                      owner_id: p.owner_id,
                      ...payload.initial_payment,
                    });
                    setOpen(false);
                    setMessage("Owner payment recorded.");
                    d.reload();
                  }}
                />
              </>
            )}
          </State>
        </Modal>
      )}
    </>
  );
}
