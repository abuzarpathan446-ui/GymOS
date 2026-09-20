import { useState } from "react";
import { api, money, date, today } from "./api";
import {
  useData,
  State,
  Table,
  PageHeader,
  Form,
  Modal,
  Badge,
  Pagination,
} from "./components";
import { useAuth } from "./main";
import { Pager } from "./access-management";
export function BusinessSummary() {
  const { user } = useAuth(),
    enabled =
      user?.permissions.includes("reports") &&
      user.features.includes("reports") &&
      user.features.includes("payments"),
    d = useData(enabled ? "/financial-summary" : null);
  if (!enabled) return null;
  return (
    <section className="card profile-details">
      <h2>Business finances</h2>
      <State {...d} retry={d.reload}>
        {d.data && (
          <>
            <Table
              rows={d.data.periods}
              columns={[
                {
                  label: "Period",
                  render: (r) =>
                    ({
                      all: "All time",
                      day: "Today",
                      month: "This month",
                      year: "This year",
                    })[r.period as string] ?? r.period,
                },
                {
                  label: "Collected revenue",
                  render: (r) => money(r.revenue_paise),
                },
                ...(user?.features.includes("expenses")
                  ? [
                      {
                        label: "Expenses",
                        render: (r: any) => money(r.expenses_paise),
                      },
                      {
                        label: "Profit / loss",
                        render: (r: any) => (
                          <Badge tone={r.profit_paise < 0 ? "amber" : "green"}>
                            {r.profit_paise < 0 ? "Loss" : "Profit"}{" "}
                            {money(Math.abs(r.profit_paise))}
                          </Badge>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            <p>
              Pending: <strong>{money(d.data.balances.pending_paise)}</strong> ·
              Partially paid: {d.data.balances.partial} · Overdue:{" "}
              {d.data.balances.overdue} · Fully paid: {d.data.balances.paid}
            </p>
            <small>{d.data.basis}</small>
          </>
        )}
      </State>
    </section>
  );
}
export function Balances({ memberId,onChanged }: { memberId?: string;onChanged?:()=>void }) {
  const { user } = useAuth(),
    enabled =
      user?.permissions.includes("payments") &&
      user.features.includes("payments");
  const [page, setPage] = useState(1),
    [status, setStatus] = useState("ALL"),
    [selected, setSelected] = useState<any>(null),
    [mode, setMode] = useState("payment"),
    [key, setKey] = useState("");
  const d = useData(
    enabled
      ? `/balances?page=${page}&status=${status}${memberId ? `&member_id=${memberId}` : ""}`
      : null,
  );
  if (!enabled) return null;
  return (
    <>
      <section className="card profile-details">
        <h2>Membership fees & balances</h2>
        <select
          aria-label="Payment status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {["ALL", "PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <State {...d} retry={d.reload}>
          {d.data && (
            <>
              <Table
                rows={d.data.items}
                columns={[
                  {
                    label: "Member / plan",
                    render: (r) => (
                      <>
                        {r.member_name}
                        <small className="block">
                          {r.plan} · {date(r.starts_on)} – {date(r.ends_on)}
                        </small>
                      </>
                    ),
                  },
                  { label: "Total fee", render: (r) => money(r.fee_paise) },
                  { label: "Paid", render: (r) => money(r.paid_paise) },
                  { label: "Pending", render: (r) => money(r.pending_paise) },
                  {
                    label: "Deadline",
                    render: (r) => date(r.payment_deadline),
                  },
                  {
                    label: "Status",
                    render: (r) => (
                      <Badge
                        tone={
                          r.payment_status === "OVERDUE"
                            ? "amber"
                            : r.payment_status === "PAID"
                              ? "green"
                              : ""
                        }
                      >
                        {r.payment_status.replaceAll("_", " ")}
                      </Badge>
                    ),
                  },
                  {
                    label: "Action",
                    render: (r) =>
                      Number(r.pending_paise) > 0 ? (
                        <div className="button-row">
                          <button
                            onClick={() => {
                              setSelected(r);
                              setMode("payment");
                              setKey(crypto.randomUUID());
                            }}
                          >
                            Record installment
                          </button>
                          <button
                            onClick={() => {
                              setSelected(r);
                              setMode("deadline");
                            }}
                          >
                            Set deadline
                          </button>
                        </div>
                      ) : null,
                  },
                ]}
              />
              <Pagination page={page} total={d.data.total} onChange={setPage} />
            </>
          )}
        </State>
      </section>
      {selected && (
        <Modal
          title={
            mode === "payment"
              ? `Record payment — ${selected.member_name}`
              : "Change payment deadline"
          }
          onClose={() => setSelected(null)}
        >
          <p>
            Pending: {money(selected.pending_paise)}. Record only money actually
            received.
          </p>
          <Form
            fields={
              mode === "payment"
                ? [
                    {
                      name: "amount",
                      label: "Amount received (₹)",
                      type: "number",
                      min: 0.01,
                      max: Number(selected.pending_paise) / 100,
                      step: "0.01",
                    },
                    {
                      name: "method",
                      label: "Method",
                      type: "select",
                      options: ["CASH", "UPI", "CARD", "BANK", "OTHER"].map(
                        (v) => ({ value: v, label: v }),
                      ),
                    },
                    {
                      name: "transaction_id",
                      label: "Transaction reference (required for non-cash)",
                      required: false,
                    },
                    { name: "notes", label: "Notes", type: "textarea" },
                  ]
                : [
                    {
                      name: "payment_deadline",
                      label: "Payment deadline",
                      type: "date",
                      defaultValue: String(
                        selected.payment_deadline ?? today(),
                      ).slice(0, 10),
                    },
                  ]
            }
            onSubmit={async (p) => {
              if (mode === "payment")
                await api(`/memberships/${selected.id}/payments`, "POST", {
                  amount_paise: Math.round(p.amount * 100),
                  method: p.method,
                  transaction_id: p.transaction_id || undefined,
                  notes: p.notes,
                  idempotency_key: key,
                });
              else
                await api(
                  `/memberships/${selected.id}/payment-deadline`,
                  "PATCH",
                  p,
                );
              setSelected(null);
              d.reload();
              onChanged?.();
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function Expenses() {
  const [page, setPage] = useState(1),
    [open, setOpen] = useState(false),
    d = useData(`/expenses?page=${page}`);
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Record gym operating costs for cash-basis profit and loss."
        action={
          <button className="primary" onClick={() => setOpen(true)}>
            Record expense
          </button>
        }
      />
      <State {...d} retry={d.reload}>
        {d.data && (
          <section className="card">
            <Table
              rows={d.data.items.slice(0, 25)}
              columns={[
                { label: "Description", render: (r) => r.description },
                { label: "Category", render: (r) => r.category },
                { label: "Amount", render: (r) => money(r.amount_paise) },
                { label: "Date", render: (r) => date(r.spent_on) },
              ]}
            />
            <Pager
              page={page}
              more={d.data.items.length > 25}
              setPage={setPage}
            />
          </section>
        )}
      </State>
      {open && (
        <Modal title="Record expense" onClose={() => setOpen(false)}>
          <Form
            fields={[
              { name: "description", label: "Description" },
              { name: "category", label: "Category" },
              {
                name: "amount",
                label: "Amount (₹)",
                type: "number",
                min: 0.01,
                step: "0.01",
              },
              {
                name: "spent_on",
                label: "Date",
                type: "date",
                defaultValue: today(),
              },
            ]}
            onSubmit={async ({ amount, ...p }) => {
              await api("/expenses", "POST", {
                ...p,
                amount_paise: Math.round(amount * 100),
              });
              setOpen(false);
              d.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function WhatsAppButton({
  memberId,
  initialType = "EXPIRING",
}: {
  memberId: string;
  initialType?: string;
}) {
  const { user } = useAuth(),
    [open, setOpen] = useState(false),
    [prepared, setPrepared] = useState<any>(null);
  if (!user?.features.includes("whatsapp_chat"))
    return <Badge>WhatsApp locked — contact Super Admin</Badge>;
  return (
    <>
      <button
        onClick={() => {
          setPrepared(null);
          setOpen(true);
        }}
      >
        Prepare WhatsApp
      </button>
      {open && (
        <Modal title="Review WhatsApp message" onClose={() => setOpen(false)}>
          <p>
            Send using your gym's own WhatsApp number. Before opening the
            message, sign in to WhatsApp or WhatsApp Web with the gym's account.
            GymOS prepares the text; you review it and press Send there.
          </p>
          <p className="notice">
            The sender is the WhatsApp account signed in on this device. GymOS
            cannot select or verify that number. Staff should use the gym's
            linked WhatsApp account. Automated sending is not enabled; it
            requires the gym's own WhatsApp Business connection and separate
            provider charges.
          </p>
          <Form
            fields={[
              {
                name: "type",
                label: "Message type",
                type: "select",
                defaultValue: initialType,
                options: ["WELCOME", "EXPIRING", "EXPIRED", "PENDING"].map(
                  (v) => ({ value: v, label: v }),
                ),
              },
            ]}
            submit="Prepare message"
            onSubmit={async (p) =>
              setPrepared(await api(`/members/${memberId}/whatsapp`, "POST", p))
            }
          />
          {prepared && (
            <>
              <p className="notice" style={{ whiteSpace: "pre-wrap" }}>
                {prepared.message}
              </p>
              <a
                className="button primary"
                href={prepared.url}
                target="_blank"
                rel="noreferrer"
              >
                Open WhatsApp to review and send
              </a>
              <p>Prepared only. GymOS has not sent this message.</p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
export function WhatsAppReminders() {
  const [page, setPage] = useState(1),
    d = useData(`/whatsapp/reminders?page=${page}`);
  return (
    <>
      <PageHeader
        title="WhatsApp reminders"
        description="Reminders are selected automatically. Review and send manually from your gym's own WhatsApp account."
      />
      <State {...d} retry={d.reload}>
        {d.data && (
          <section className="card">
            <Table
              rows={d.data.items.slice(0, 25)}
              columns={[
                { label: "Member", render: (r) => r.name },
                { label: "Expiry", render: (r) => date(r.ends_on) },
                { label: "Reminder", render: (r) => r.type },
                {
                  label: "Action",
                  render: (r) => (
                    <WhatsAppButton
                      memberId={r.member_id}
                      initialType={r.type}
                    />
                  ),
                },
              ]}
            />
            <Pager
              page={page}
              more={d.data.items.length > 25}
              setPage={setPage}
            />
          </section>
        )}
      </State>
    </>
  );
}
