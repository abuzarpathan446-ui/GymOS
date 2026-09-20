import { useState, type ReactNode } from "react";
import {normalizeGymSlug,validateGymSlug,gymSlugMessage} from '../../shared/gym-slug';
import {initialOwnerPaymentFields,withInitialOwnerPayment,paymentRequestId} from './owner-payments';
import { Link, useParams } from "react-router-dom";
import {
  Plus,
  ArrowUpRight,
  ArrowRight,
  Users,
  ScanLine,
  IndianRupee,
  Clock3,
  Search,
  Download,
  Check,
  RefreshCw,
  Activity,
  CalendarDays,
  ChevronRight,
  UserPlus,
} from "lucide-react";
import { api, money, date, time, today,membershipStatus } from "./api";
import {
  Badge,
  Empty,
  Form,
  Modal,
  PageHeader,
  Pagination,
  State,
  Table,
  useData,
  type Field,
} from "./components";
import { useAuth } from "./main";
import {
  accountDeliveryField,
  ownerPasswordField,
  AccountSetupResult,
  type AccountSetup,
} from "./account-setup";
import { AccessUsage } from "./access-management";
import { BusinessSummary, Balances, WhatsAppButton } from "./business-controls";
import { WorkoutEditor, TrainerMembers } from "./workout-editor";
import { MemberPhoto } from "./member-photo";
import { StaffAccess } from "./staff-controls";
const memberFields: Field[] = [
  { name: "name", label: "Full name" },
  { name: "phone", label: "Mobile number", type: "tel" },
  { name: "email", label: "Email address", type: "email", required: false },
  { name: "address", label: "Address", required: false },
  { name: "emergency_contact", label: "Emergency contact", required: false },
  { name: "source", label: "Source", defaultValue: "Walk-in" },
  { name: "notes", label: "Notes", type: "textarea" },
];
const memberCode = (n: number) => `GYM-${String(n).padStart(6, "0")}`;
function Person({ name, sub }: { name: string; sub?: string }) {
  return (
    <div className="person">
      <span className="avatar">
        {name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      <span>
        <strong>{name}</strong>
        {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}
function useAction(reload: () => void) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    perform: async (path: string, body?: any, method = "POST") => {
      setBusy(true);
      setError("");
      try {
        await api(path, method, body);
        reload();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
  };
}
export function Dashboard() {
  const d = useData("/dashboard");
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        eyebrow="YOUR GYM, AT A GLANCE"
        title={`Let’s make today count, ${user?.name.split(" ")[0]}.`}
        description="A clear view of your members, movement and momentum."
        action={
          user?.permissions.includes("members:create") && (
            <Link className="primary button" to="/members?new=1">
              <Plus size={17} /> Add member
            </Link>
          )
        }
      />
      <State {...d} retry={d.reload}>
        {d.data && (
          <>
            <section className="welcome-strip">
              <div>
                <Badge tone="green">
                  <span className="status-dot" /> YOUR WORKSPACE
                </Badge>
                <h2>{d.data.organization.name}</h2>
                <p>Every check-in is a little progress. Keep it going.</p>
                <Link to="/attendance">
                  Open reception <ArrowRight size={16} />
                </Link>
              </div>
              <div className="welcome-art" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="orbit orbit-three" />
                <Activity size={74} />
                <span>
                  STRONGER
                  <br />
                  EVERY DAY.
                </span>
              </div>
            </section>
            <div className="stat-grid">
              {[
                [
                  Users,
                  "Active members",
                  d.data.metrics.active_members,
                  d.data.metrics.total_members === undefined
                    ? "Contact the Super Admin"
                    : `${d.data.metrics.total_members} total registered`,
                ],
                [
                  ScanLine,
                  "Today’s check-ins",
                  d.data.metrics.today_checkins,
                  d.data.metrics.currently_inside === undefined
                    ? "Contact the Super Admin"
                    : `${d.data.metrics.currently_inside} members currently inside`,
                ],
                [
                  IndianRupee,
                  "Monthly revenue",
                  d.data.metrics.monthly_revenue === undefined
                    ? "Locked"
                    : money(d.data.metrics.monthly_revenue),
                  d.data.metrics.today_revenue === undefined
                    ? "Contact the Super Admin"
                    : `${money(d.data.metrics.today_revenue)} received today`,
                ],
                [
                  Clock3,
                  "Expiring this week",
                  d.data.metrics.expiring_members,
                  "A good time to reach out",
                ],
              ].map(([Icon, label, value, sub]: any) => (
                <article className="stat-card" key={label}>
                  <div className="stat-label">
                    {label}
                    <span>
                      <Icon size={18} />
                    </span>
                  </div>
                  <strong className="stat-number">{value ?? "Locked"}</strong>
                  <small>{sub}</small>
                </article>
              ))}
            </div>
            <div className="dashboard-grid">
              <div className="notice" style={{gridColumn:'1 / -1'}}>
                {d.data.metrics.expired_members!==undefined&&<>Expired memberships: <strong>{d.data.metrics.expired_members}</strong> · </>}
                {d.data.metrics.inactive_members!==undefined&&<>Inactive members: <strong>{d.data.metrics.inactive_members}</strong> · </>}
                {d.data.metrics.new_leads!==undefined&&<>New leads: <strong>{d.data.metrics.new_leads}</strong></>}
              </div>
              {d.data.metrics.monthly_revenue !== undefined ? (
                <section className="card revenue-card">
                  <div className="card-heading">
                    <div>
                      <h2>Revenue overview</h2>
                      <p>Payments received over the last 30 days</p>
                    </div>
                    <Badge>Last 30 days</Badge>
                  </div>
                  <div className="revenue-value">
                    {money(
                      d.data.revenue.reduce(
                        (sum: number, r: any) => sum + Number(r.revenue),
                        0,
                      ),
                    )}
                    <span>total collected</span>
                  </div>
                  {d.data.revenue.length ? (
                    <div
                      className="bar-chart"
                      role="img"
                      aria-label="Revenue by day"
                    >
                      {d.data.revenue.map((r: any) => (
                        <div
                          className="bar-column"
                          key={r.day}
                          title={`${date(r.day)}: ${money(r.revenue)}`}
                        >
                          <span>{money(r.revenue)}</span>
                          <div
                            style={{
                              height: `${Math.max(4, (Number(r.revenue) / Math.max(...d.data.revenue.map((x: any) => Number(x.revenue)))) * 150)}px`,
                            }}
                          />
                          <small>{r.day.slice(8)}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Your revenue story starts here"
                      text="Record your first payment to see your revenue trend."
                    />
                  )}
                  <Link className="card-bottom-link" to="/reports">
                    View financial reports <ArrowUpRight size={15} />
                  </Link>
                </section>
              ) : (
                <section className="card profile-details">
                  <h2>Revenue reports locked</h2>
                  <p>Please contact the Super Admin for access.</p>
                </section>
              )}
              <section className="card quick-actions">
                <div className="card-heading">
                  <div>
                    <h2>Keep things moving</h2>
                    <p>Your everyday essentials, one click away</p>
                  </div>
                </div>
                {[
                  [
                    ScanLine,
                    "Check in a member",
                    "Ready. Scan. Go.",
                    "/attendance",
                  ],
                  [
                    UserPlus,
                    "Register a member",
                    "Welcome someone new",
                    "/members?new=1",
                  ],
                  [
                    IndianRupee,
                    "Record a payment",
                    "Keep your books in order",
                    "/payments?new=1",
                  ],
                  [
                    CalendarDays,
                    "Manage appointments",
                    "Make time for progress",
                    "/appointments",
                  ],
                ]
                  .filter(
                    (x: any) =>
                      (x[3] !== "/appointments" ||
                        user?.permissions.includes("appointments")) &&
                      (x[3] !== "/members?new=1" ||
                        user?.permissions.includes("members:create")),
                  )
                  .map(([Icon, title, sub, path]: any) => (
                    <Link key={title} to={path}>
                      <span className="quick-icon">
                        <Icon size={20} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{sub}</small>
                      </span>
                      <ChevronRight size={16} />
                    </Link>
                  ))}
              </section>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>A little nudge goes a long way</h2>
                    <p>Memberships expiring in the next 7 days</p>
                  </div>
                  <Link to="/members">
                    View all <ArrowUpRight size={14} />
                  </Link>
                </div>
                <Table
                  rows={d.data.expiring}
                  columns={[
                    {
                      label: "Member",
                      render: (r) => (
                        <Link to={`/members/${r.id}`}>
                          <Person name={r.name} sub={memberCode(r.number)} />
                        </Link>
                      ),
                    },
                    { label: "Plan", render: (r) => r.plan },
                    {
                      label: "Expires",
                      render: (r) => (
                        <Badge tone="amber">{date(r.ends_on)}</Badge>
                      ),
                    },
                  ]}
                />
              </section>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>Latest activity</h2>
                    <p>What’s happening in your gym</p>
                  </div>
                  <span className="status-dot" />
                </div>
                <div className="activity-list">
                  {d.data.activity.length ? (
                    d.data.activity.map((r: any, i: number) => (
                      <div key={i}>
                        <span className="activity-point" />
                        <div>
                          <strong>
                            {r.action.replaceAll(".", " ").replaceAll("_", " ")}
                          </strong>
                          <small>
                            {date(r.created_at)} · {time(r.created_at)}
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty title="Ready for your first action" />
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </State>
      <BusinessSummary />
    </>
  );
}
export function Members() {
  const { user } = useAuth();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("ALL"),
    [adding, setAdding] = useState(
      new URLSearchParams(location.search).has("new"),
    );
  const d = useData(
    `/members?page=${page}&search=${encodeURIComponent(search)}&status=${status}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="THE PEOPLE BEHIND YOUR GYM"
        title="Members"
        description="Know your members. Support their next milestone."
        action={
          user?.permissions.includes("members:create") && (
            <button className="primary" onClick={() => setAdding(true)}>
              <Plus size={17} /> Add member
            </button>
          )
        }
      />
      <section className="card">
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Search members"
              placeholder="Search name, phone or member ID…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Filter members"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {[
              "ALL",
              "ACTIVE",
              "EXPIRED",
              "EXPIRING",
              "TRIAL",
              "FROZEN",
              "INACTIVE",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <State {...d} retry={d.reload}>
          {d.data && (
            <>
              <Table
                rows={d.data.items}
                columns={[
                  {
                    label: "Member",
                    render: (r) => (
                      <Link to={`/members/${r.id}`}>
                        <Person name={r.name} sub={memberCode(r.number)} />
                      </Link>
                    ),
                  },
                  {
                    label: "Contact",
                    render: (r) => (
                      <span>
                        {r.phone}
                        <small className="block">{r.email}</small>
                      </span>
                    ),
                  },
                  {
                    label: "Status",
                    render: (r) => (
                      <Badge
                        tone={
                          !r.active
                            ? ""
                            : r.expires_on &&
                                r.expires_on.slice(0, 10) >= today()
                              ? "green"
                              : "amber"
                        }
                      >
                        {!r.active
                          ? "Inactive"
                          : r.expires_on
                            ? r.expires_on.slice(0, 10) >= today()
                              ? "Active"
                              : "Expired"
                            : "No membership"}
                      </Badge>
                    ),
                  },
                  { label: "Expires", render: (r) => date(r.expires_on) },
                  { label: "Joined", render: (r) => date(r.created_at) },
                  {
                    label: "",
                    render: (r) => (
                      <Link
                        aria-label={`View ${r.name}`}
                        to={`/members/${r.id}`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    ),
                  },
                ]}
              />
              <Pagination page={page} total={d.data.total} onChange={setPage} />
            </>
          )}
        </State>
      </section>
      {adding && user?.permissions.includes("members:create") && (
        <Modal title="Welcome a new member" onClose={() => setAdding(false)}>
          <Form
            fields={memberFields}
            submit="Create member"
            onSubmit={async (p) => {
              await api("/members", "POST", p);
              setAdding(false);
              d.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
function PaymentForm({
  memberId,
  onDone,
}: {
  memberId?: string;
  onDone: () => void;
}) {
  const plans = useData("/membership-plans");
  const [search, setSearch] = useState("");
  const members = useData(`/members?search=${encodeURIComponent(search)}`);
  const [selected, setSelected] = useState(""),
    [discount, setDiscount] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key] = useState(crypto.randomUUID());
  const plan = plans.data?.items.find((r: any) => r.id === selected);
  const amount = plan
    ? plan.price_paise -
      discount +
      Math.round(((plan.price_paise - discount) * plan.tax_bps) / 10000)
    : 0;
  return (
    <State {...plans} retry={plans.reload}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const p = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await api("/payments", "POST", {
              ...p,
              member_id: memberId ?? p.member_id,
              discount_paise: discount,
              amount_paise:
                p.initial_amount === ""
                  ? amount
                  : Math.round(Number(p.initial_amount) * 100),
              initial_amount: undefined,
              payment_deadline: p.payment_deadline || null,
              idempotency_key: key,
              transaction_id: p.transaction_id || undefined,
            });
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!memberId && (
          <>
            <label>
              Find member
              <input
                value={search}
                placeholder="Search name or phone"
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Member
              <select name="member_id" required defaultValue="">
                <option value="" disabled>
                  Select member…
                </option>
                {members.data?.items.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {memberCode(m.number)}
                  </option>
                ))}
              </select>
            </label>
            {members.error && <p role="alert">{members.error}</p>}
          </>
        )}
        <label>
          Membership plan
          <select
            name="plan_id"
            required
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="" disabled>
              Select plan…
            </option>
            {plans.data?.items
              .filter((p: any) => p.active)
              .map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price_paise)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Membership start
          <input type="date" name="starts_on" defaultValue={today()} required />
        </label>
        <label>
          Discount (₹)
          <input
            type="number"
            min="0"
            step="0.01"
            value={discount / 100}
            onChange={(e) =>
              setDiscount(Math.round(Number(e.target.value) * 100))
            }
          />
        </label>
        <label>
          Payment method
          <select name="method">
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="BANK">Bank transfer</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label>
          Transaction reference
          <input name="transaction_id" />
          <small>Required for non-cash payments.</small>
        </label>
        <label>
          Initial amount received (₹)
          <input
            name="initial_amount"
            type="number"
            min="0"
            max={amount / 100}
            step="0.01"
            placeholder={`Full amount: ${amount / 100}`}
          />
          <small>
            Leave blank for full payment. Enter 0 to register an unpaid
            membership.
          </small>
        </label>
        <label>
          Payment deadline
          <input name="payment_deadline" type="date" />
          <small>Required when any balance remains.</small>
        </label>
        <div className="payment-total">
          <span>Total membership fee, including tax</span>
          <strong>{money(amount)}</strong>
        </div>
        <div className="notice">
          Confirm only after your gym has received payment. This records a
          payment; it does not charge a card or verify a UPI transfer.
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !plan}>
          {busy ? "Recording…" : "Record payment & create membership"}
        </button>
      </form>
    </State>
  );
}
export function MemberDetail() {
  const [accountSetup, setAccountSetup] = useState<AccountSetup | null>(null);
  const { user } = useAuth();
  const [portalMessage, setPortalMessage] = useState("");
  const { id } = useParams(),
    d = useData(`/members/${id}`),
    [tab, setTab] = useState("Overview"),
    [modal, setModal] = useState(""),
    [qr, setQr] = useState<any>(null);
  const action = useAction(d.reload);
  const m = d.data?.member;
  return (
    <State {...d} retry={d.reload}>
      {m && (
        <>
          <Link className="back-link" to="/members">
            ← All members
          </Link>
          <PageHeader
            eyebrow={memberCode(m.number)}
            title={m.name}
            description={`Member since ${date(m.created_at)} · ${m.phone}`}
            action={
              <div className="button-row">
                {user?.permissions.includes("members:account") &&
                  (m.user_id ? (
                    <Badge tone="green">Portal account linked</Badge>
                  ) : (
                    <button onClick={() => setModal("portal")}>
                      Create member login
                    </button>
                  ))}
                <button
                  onClick={async () => {
                    try {
                      setQr(await api(`/members/${id}/qr`));
                      setModal("qr");
                    } catch (e) {
                      alert((e as Error).message);
                    }
                  }}
                >
                  <ScanLine size={16} /> Member QR
                </button>
                {user?.permissions.includes("payments") &&
                  user.features.includes("payments") && (
                    <button
                      className="primary"
                      onClick={() => setModal("payment")}
                    >
                      <Plus size={16} /> Renew membership
                    </button>
                  )}
              </div>
            }
          />
          {portalMessage && (
            <div className="notice" role="status">
              {portalMessage}
            </div>
          )}
          {modal === "portal" && (
            <Modal title="Create member login" onClose={() => setModal("")}>
              <p>
                Login email:{" "}
                {m.email || "Add an email address to this profile first."} The
                member chooses their own password and can only see their own
                records.
              </p>
              <Form
                fields={[accountDeliveryField]}
                submit="Create member login"
                onSubmit={async (p) => {
                  const result = await api(
                    `/members/${id}/portal-invitation`,
                    "POST",
                    p,
                  );
                  setPortalMessage(result.message);
                  setAccountSetup(result);
                  setModal("");
                  d.reload();
                }}
              />
            </Modal>
          )}
          {accountSetup && (
            <AccountSetupResult
              result={accountSetup}
              onClose={() => setAccountSetup(null)}
            />
          )}
          <div className="tabs">
            {["Overview", "Membership", "Payments", "Attendance"].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {action.error && (
            <p role="alert" className="form-error">
              {action.error}
            </p>
          )}
          <section className="card">
            {tab === "Overview" ? (
              <div className="profile-details">
                <MemberPhoto
                  id={id!}
                  photo={m.photo}
                  editable={!!user?.permissions.includes("members:edit")}
                  onSaved={d.reload}
                />
                <div className="card-heading">
                  <h2>Member information</h2>
                  {user?.permissions.includes("members:edit") && (
                    <button onClick={() => setModal("edit")}>
                      Edit profile
                    </button>
                  )}
                </div>
                <dl>
                  {[
                    ["Email", m.email || "Not provided"],
                    ["Phone", m.phone],
                    ["Address", m.address || "Not provided"],
                    [
                      "Emergency contact",
                      m.emergency_contact || "Not provided",
                    ],
                    ["Source", m.source],
                    ["Notes", m.notes || "No notes"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="button-row">
                  <WhatsAppButton memberId={id!} />

                  {m.active &&
                    user?.permissions.includes("members:deactivate") && (
                      <button
                        className="danger"
                        onClick={() => setModal("deactivate")}
                      >
                        Deactivate member
                      </button>
                    )}
                </div>
              </div>
            ) : tab === "Membership" ? (
              <Table
                rows={d.data.memberships}
                columns={[
                  { label: "Plan", render: (r) => r.plan },
                  {
                    label: "Period",
                    render: (r) => `${date(r.starts_on)} — ${date(r.ends_on)}`,
                  },
                  {
                    label: "Status",
                    render: (r) => (
                      <Badge>
                        {membershipStatus(r)}
                      </Badge>
                    ),
                  },
                  {
                    label: "Action",
                    render: (r) =>
                      ["ACTIVE", "FROZEN"].includes(r.status) && (
                        <button
                          disabled={action.busy}
                          onClick={() =>
                            void action.perform(
                              `/memberships/${r.id}/${r.status === "FROZEN" ? "unfreeze" : "freeze"}`,
                            )
                          }
                        >
                          {r.status === "FROZEN" ? "Unfreeze" : "Freeze"}
                        </button>
                      ),
                  },
                ]}
              />
            ) : tab === "Payments" ? (
              <Table rows={d.data.payments} columns={paymentColumns} />
            ) : (
              <Table
                rows={d.data.attendance}
                columns={[
                  { label: "Date", render: (r) => date(r.checked_in_at) },
                  { label: "Entry", render: (r) => time(r.checked_in_at) },
                  {
                    label: "Exit",
                    render: (r) =>
                      r.checked_out_at ? (
                        time(r.checked_out_at)
                      ) : (
                        <Badge tone="green">Inside</Badge>
                      ),
                  },
                ]}
              />
            )}
          </section>
          {modal === "edit" && (
            <Modal title="Edit member" onClose={() => setModal("")}>
              <Form
                fields={memberFields}
                initial={m}
                onSubmit={async (p) => {
                  await api(`/members/${id}`, "PATCH", p);
                  setModal("");
                  d.reload();
                }}
              />
            </Modal>
          )}
          {modal === "payment" && (
            <Modal title="Membership & payment" onClose={() => setModal("")}>
              <PaymentForm
                memberId={id}
                onDone={() => {
                  setModal("");
                  d.reload();
                }}
              />
            </Modal>
          )}
          {modal === "qr" && qr && (
            <Modal title="Member access card" onClose={() => setModal("")}>
              <div className="qr-card">
                <img src={qr.qr} alt={`QR code for ${m.name}`} />
                <h2>{m.name}</h2>
                <p>{qr.identifier}</p>
                <button onClick={() => window.print()}>Print card</button>
                <button
                  disabled={
                    action.busy || !user?.permissions.includes("members:edit")
                  }
                  onClick={async () => {
                    await action.perform(`/members/${id}/qr`);
                    setQr(await api(`/members/${id}/qr`));
                  }}
                >
                  Regenerate QR
                </button>
                <small>Regenerating invalidates the previous code.</small>
              </div>
            </Modal>
          )}
          {modal === "deactivate" && (
            <Modal title="Deactivate this member?" onClose={() => setModal("")}>
              <p>
                Attendance, payment and membership history will be retained. New
                check-ins will be blocked.
              </p>
              <button
                className="danger"
                onClick={async () => {
                  await action.perform(`/members/${id}/deactivate`);
                  setModal("");
                }}
              >
                Deactivate member
              </button>
            </Modal>
          )}
        </>
      )}
      <Balances memberId={id} onChanged={d.reload}/>
    </State>
  );
}
const paymentColumns = [
  {
    label: "Receipt",
    render: (r: any) => (
      <strong>INV-{String(r.invoice_number).padStart(6, "0")}</strong>
    ),
  },
  { label: "Amount", render: (r: any) => money(r.amount_paise) },
  { label: "Method", render: (r: any) => <Badge>{r.method}</Badge> },
  { label: "Date", render: (r: any) => date(r.created_at) },
  {
    label: "Receipt PDF",
    render: (r: any) => (
      <a
        className="button icon-button"
        aria-label="Download receipt"
        href={`/api/invoices/${r.invoice_id}/pdf`}
      >
        <Download size={17} />
      </a>
    ),
  },
];
export function MembershipPlans() {
  const d = useData("/membership-plans"),
    [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="Membership plans"
        description="Flexible plans for different goals. Membership history stays intact."
        action={
          <button className="primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Create plan
          </button>
        }
      />
      <State {...d} retry={d.reload}>
        <div className="plan-grid">
          {d.data?.items.length ? (
            d.data.items.map((p: any) => (
              <article className="card plan-card" key={p.id}>
                <Badge>{p.trial ? "TRIAL" : "MEMBERSHIP"}</Badge>
                <h2>{p.name}</h2>
                <div className="plan-price">
                  {money(p.price_paise)}
                  <small> / {p.duration_days} days</small>
                </div>
                <p>{p.benefits || "Gym membership"}</p>
                <div className="plan-line">
                  <Check size={16} /> {p.freeze_days} freeze days
                </div>
                <div className="plan-line">
                  <Check size={16} /> {(p.tax_bps / 100).toFixed(2)}% tax
                </div>
                <Badge tone="green">
                  {p.active ? "Available" : "Inactive"}
                </Badge>
              </article>
            ))
          ) : (
            <Empty title="Create your first membership plan" />
          )}
        </div>
      </State>
      {open && (
        <Modal title="Create a membership plan" onClose={() => setOpen(false)}>
          <Form
            fields={[
              { name: "name", label: "Plan name" },
              {
                name: "duration_days",
                label: "Duration (days)",
                type: "number",
                min: 1,
                max: 3660,
              },
              {
                name: "price",
                label: "Price (₹)",
                type: "number",
                min: 0,
                step: "0.01",
              },
              {
                name: "tax",
                label: "Tax (%)",
                type: "number",
                min: 0,
                max: 100,
                step: "0.01",
                defaultValue: 0,
              },
              {
                name: "freeze_days",
                label: "Freeze allowance (days)",
                type: "number",
                min: 0,
                defaultValue: 0,
              },
              { name: "benefits", label: "Benefits", type: "textarea" },
            ]}
            onSubmit={async (p) => {
              const { price, tax, ...rest } = p;
              await api("/membership-plans", "POST", {
                ...rest,
                price_paise: Math.round(price * 100),
                tax_bps: Math.round(tax * 100),
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
export function Payments({ invoices = false }: { invoices?: boolean }) {
  const [page, setPage] = useState(1),
    [open, setOpen] = useState(new URLSearchParams(location.search).has("new")),
    d = useData(`/payments?page=${page}`);
  return (
    <>
      <PageHeader
        title={invoices ? "Invoices & receipts" : "Payments"}
        description={
          invoices
            ? "Every payment, a permanent record. Download and share your receipts."
            : "A reliable record of money received by your gym."
        }
        action={
          !invoices && (
            <button className="primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Record payment
            </button>
          )
        }
      />
      <section className="card">
        <State {...d} retry={d.reload}>
          {d.data && (
            <>
              <Table
                rows={d.data.items}
                columns={[
                  {
                    label: "Member",
                    render: (r) => (
                      <Link to={`/members/${r.member_id}`}>
                        {r.member_name}
                      </Link>
                    ),
                  },
                  ...paymentColumns,
                ]}
              />
              <Pagination page={page} total={d.data.total} onChange={setPage} />
            </>
          )}
        </State>
      </section>
      {open && (
        <Modal title="Record a payment" onClose={() => setOpen(false)}>
          <PaymentForm
            onDone={() => {
              setOpen(false);
              d.reload();
            }}
          />
        </Modal>
      )}
      {!invoices && <Balances key={d.data?.items?.[0]?.id??'balances'} onChanged={d.reload}/>}
    </>
  );
}
export function Attendance() {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [qr, setQr] = useState("");
  const d = useData(`/attendance?page=${page}`),
    members = useData(`/members?search=${encodeURIComponent(search)}`),
    action = useAction(d.reload);
  return (
    <>
      <PageHeader
        eyebrow="RECEPTION"
        title="Every visit counts."
        description="Find a member or scan their GymOS QR code to check them in."
      />
      <div className="reception-grid">
        <section className="card reception-search">
          <ScanLine size={27} />
          <h2>Ready for a great session?</h2>
          <p>Search by name, phone or member ID.</p>
          <div className="search-input">
            <Search size={18} />
            <input
              aria-label="Find member to check in"
              value={search}
              placeholder="Find a member…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {search && (
            <State {...members} retry={members.reload}>
              <div className="search-results">
                {members.data?.items.length ? (
                  members.data.items.slice(0, 5).map((m: any) => (
                    <div key={m.id}>
                      <Person name={m.name} sub={memberCode(m.number)} />
                      <button
                        disabled={action.busy}
                        onClick={() =>
                          void action.perform("/attendance/check-in", {
                            member_id: m.id,
                          })
                        }
                      >
                        Check in
                      </button>
                    </div>
                  ))
                ) : (
                  <Empty title="No matching members" />
                )}
              </div>
            </State>
          )}
        </section>
        <section className="card scanner-panel">
          <div className="scan-frame">
            <ScanLine size={48} />
          </div>
          <h3>QR scanner check-in</h3>
          <p>
            Use a USB QR scanner or paste the identifier from a GymOS member
            card.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await action.perform("/attendance/check-in", { qr });
              setQr("");
            }}
          >
            <input
              aria-label="QR identifier"
              value={qr}
              onChange={(e) => setQr(e.target.value)}
              placeholder="gymos:…"
              required
            />
            <button className="primary" disabled={action.busy}>
              Check in
            </button>
          </form>
        </section>
      </div>
      {action.error && (
        <div className="form-error" role="alert">
          {action.error}
        </div>
      )}
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Attendance log</h2>
            <p>Entry and exit, recorded in real time</p>
          </div>
          <button aria-label="Refresh attendance" onClick={d.reload}>
            <RefreshCw size={16} />
          </button>
        </div>
        <State {...d} retry={d.reload}>
          {d.data && (
            <>
              <Table
                rows={d.data.items}
                columns={[
                  {
                    label: "Member",
                    render: (r) => (
                      <Person name={r.member_name} sub={memberCode(r.number)} />
                    ),
                  },
                  { label: "Date", render: (r) => date(r.checked_in_at) },
                  { label: "Entry", render: (r) => time(r.checked_in_at) },
                  { label: "Exit", render: (r) => time(r.checked_out_at) },
                  {
                    label: "Status",
                    render: (r) => (
                      <Badge tone={r.checked_out_at ? "" : "green"}>
                        {r.checked_out_at ? "Completed" : "Inside"}
                      </Badge>
                    ),
                  },
                  {
                    label: "Action",
                    render: (r) =>
                      !r.checked_out_at && (
                        <button
                          disabled={action.busy}
                          onClick={() =>
                            void action.perform(`/attendance/${r.id}/check-out`)
                          }
                        >
                          Check out
                        </button>
                      ),
                  },
                ]}
              />
              <Pagination page={page} total={d.data.total} onChange={setPage} />
            </>
          )}
        </State>
      </section>
    </>
  );
}

const operationCopy: Record<string, [string, string]> = {
  trainers: ["Trainers", "The people helping your members become stronger."],
  workouts: ["Workout plans", "Purposeful training, tailored to each member."],
  progress: ["Body progress", "Record measurements. Make progress visible."],
  leads: ["Leads & CRM", "Turn first conversations into lasting memberships."],
  appointments: ["Appointments", "Make space for one-to-one progress."],
  inventory: ["Inventory", "Know what’s in stock and what needs a refill."],
  notifications: [
    "Notifications",
    "Stay close to the things that need your attention.",
  ],
};
export function OperationalPage({ kind }: { kind: string }) {
  const [editingWorkout, setEditingWorkout] = useState<any>(null);
  const d = useData(`/${kind}`),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [search, setSearch] = useState("");
  const { user } = useAuth();
  const members = useData(
    user?.role === "TRAINER"
      ? "/assigned-members"
      : `/members?search=${encodeURIComponent(search)}`,
  );
  const trainers = useData(kind === "appointments" ? "/trainers" : null);
  const action = useAction(d.reload);
  const memberOptions =
    members.data?.items.map((m: any) => ({ value: m.id, label: m.name })) ?? [];
  const mf: Field = {
    name: "member_id",
    label: "Member",
    type: "select",
    options: memberOptions,
  };
  let fields: Field[] = [];
  if (kind === "leads")
    fields = [
      { name: "name", label: "Name" },
      { name: "phone", label: "Phone" },
      { name: "source", label: "Source", defaultValue: "Walk-in" },
      { name: "notes", label: "Notes", type: "textarea" },
    ];
  if (kind === "progress")
    fields = [
      mf,
      {
        name: "weight_kg",
        label: "Weight (kg)",
        type: "number",
        step: "0.01",
        min: 1,
      },
      {
        name: "height_cm",
        label: "Height (cm)",
        type: "number",
        step: "0.01",
        min: 1,
      },
      {
        name: "body_fat",
        label: "Body fat (%)",
        type: "number",
        step: "0.01",
        min: 0,
        max: 100,
      },
      {
        name: "measured_on",
        label: "Measurement date",
        type: "date",
        defaultValue: today(),
      },
    ];
  if (kind === "inventory")
    fields = [
      { name: "name", label: "Product name" },
      { name: "sku", label: "SKU" },
      { name: "category", label: "Category", required: false },
      {
        name: "minimum_stock",
        label: "Minimum stock",
        type: "number",
        min: 0,
        defaultValue: 5,
      },
      {
        name: "purchase",
        label: "Purchase price (₹)",
        type: "number",
        min: 0,
        step: "0.01",
      },
      {
        name: "selling",
        label: "Selling price (₹)",
        type: "number",
        min: 0,
        step: "0.01",
      },
      { name: "supplier", label: "Supplier", required: false },
    ];
  if (kind === "appointments")
    fields = [
      mf,
      {
        name: "trainer_id",
        label: "Trainer",
        type: "select",
        options:
          trainers.data?.items.map((t: any) => ({
            value: t.id,
            label: t.name,
          })) ?? [],
      },
      { name: "starts_at", label: "Start time", type: "datetime-local" },
      { name: "ends_at", label: "End time", type: "datetime-local" },
      { name: "notes", label: "Notes", type: "textarea" },
    ];
  if (kind === "workouts")
    fields = [
      mf,
      { name: "name", label: "Workout name" },
      { name: "day", label: "Training day", defaultValue: "Day 1" },
      { name: "exercise", label: "Exercise" },
      {
        name: "sets",
        label: "Sets",
        type: "number",
        min: 1,
        max: 50,
        defaultValue: 3,
      },
      { name: "reps", label: "Repetitions", defaultValue: "8–12" },
      { name: "weight", label: "Weight", required: false },
      {
        name: "rest_seconds",
        label: "Rest (seconds)",
        type: "number",
        min: 0,
        defaultValue: 60,
      },
    ];
  const columns: Record<string, any[]> = {
    leads: [
      {
        label: "Lead",
        render: (r: any) => <Person name={r.name} sub={r.phone} />,
      },
      { label: "Source", render: (r: any) => r.source },
      {
        label: "Stage",
        render: (r: any) => (
          <select
            aria-label={`Stage for ${r.name}`}
            value={r.status}
            onChange={(e) =>
              e.target.value === "CONVERTED"
                ? setSelected(r)
                : void action.perform(
                    `/leads/${r.id}`,
                    { status: e.target.value },
                    "PATCH",
                  )
            }
          >
            {["NEW", "CONTACTED", "VISITED", "TRIAL", "CONVERTED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        ),
      },
      { label: "Follow-up", render: (r: any) => date(r.follow_up_on) },
    ],
    trainers: [
      {
        label: "Trainer",
        render: (r: any) => (
          <Link to={`/admin/gyms/${r.id}`}>
            <Person name={r.name} sub={r.email} />
          </Link>
        ),
      },
      { label: "Specialization", render: (r: any) => r.specialization || "—" },
      { label: "Assigned members", render: (r: any) => r.assigned_members },
      {
        label: "Action",
        render: (r: any) => (
          <button onClick={() => setSelected(r)}>Assign member</button>
        ),
      },
    ],
    workouts: [
      { label: "Workout", render: (r: any) => <strong>{r.name}</strong> },
      { label: "Member", render: (r: any) => r.member_name },
      {
        label: "Exercises",
        render: (r: any) =>
          r.exercises
            .map((e: any) => `${e.day}: ${e.name} · ${e.sets} × ${e.reps}`)
            .join("; "),
      },
      { label: "Created", render: (r: any) => date(r.created_at) },
      {
        label: "Edit",
        render: (r: any) => (
          <button onClick={() => setEditingWorkout(r)}>Edit plan</button>
        ),
      },
    ],
    progress: [
      { label: "Member", render: (r: any) => r.member_name },
      { label: "Date", render: (r: any) => date(r.measured_on) },
      { label: "Weight", render: (r: any) => `${r.weight_kg} kg` },
      { label: "Height", render: (r: any) => `${r.height_cm} cm` },
      {
        label: "BMI",
        render: (r: any) =>
          (Number(r.weight_kg) / (Number(r.height_cm) / 100) ** 2).toFixed(1),
      },
      {
        label: "Body fat",
        render: (r: any) => (r.body_fat === null ? "—" : `${r.body_fat}%`),
      },
    ],
    appointments: [
      { label: "Member", render: (r: any) => r.member_name },
      { label: "Trainer", render: (r: any) => r.trainer_name },
      {
        label: "Session",
        render: (r: any) =>
          `${date(r.starts_at)} · ${time(r.starts_at)}–${time(r.ends_at)}`,
      },
      { label: "Status", render: (r: any) => <Badge>{r.status}</Badge> },
      {
        label: "Action",
        render: (r: any) =>
          r.status === "SCHEDULED" && (
            <div className="button-row">
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.perform(
                    `/appointments/${r.id}`,
                    { status: "COMPLETED" },
                    "PATCH",
                  )
                }
              >
                Complete
              </button>
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.perform(
                    `/appointments/${r.id}`,
                    { status: "CANCELLED" },
                    "PATCH",
                  )
                }
              >
                Cancel
              </button>
            </div>
          ),
      },
    ],
    inventory: [
      {
        label: "Product",
        render: (r: any) => (
          <span>
            <strong>{r.name}</strong>
            <small className="block">{r.sku}</small>
          </span>
        ),
      },
      {
        label: "Stock",
        render: (r: any) => (
          <Badge tone={r.quantity <= r.minimum_stock ? "amber" : "green"}>
            {r.quantity} units
          </Badge>
        ),
      },
      { label: "Selling price", render: (r: any) => money(r.selling_paise) },
      { label: "Supplier", render: (r: any) => r.supplier },
      {
        label: "Action",
        render: (r: any) => (
          <button onClick={() => setSelected(r)}>Adjust stock</button>
        ),
      },
    ],
    notifications: [
      {
        label: "Notification",
        render: (r: any) => (
          <span>
            <strong>{r.title}</strong>
            <small className="block">{r.body}</small>
          </span>
        ),
      },
      { label: "Received", render: (r: any) => date(r.created_at) },
      {
        label: "Status",
        render: (r: any) =>
          r.read_at ? (
            <Badge>Read</Badge>
          ) : (
            <button
              disabled={action.busy}
              onClick={() => void action.perform(`/notifications/${r.id}/read`)}
            >
              Mark read
            </button>
          ),
      },
    ],
  };
  return (
    <>
      <PageHeader
        title={operationCopy[kind][0]}
        description={operationCopy[kind][1]}
        action={
          kind === "trainers" ? (
            <Link className="button primary" to="/settings?tab=staff">
              Add trainer account
            </Link>
          ) : (
            kind !== "notifications" && (
              <button className="primary" onClick={() => setOpen(true)}>
                <Plus size={16} /> Add{" "}
                {kind === "progress"
                  ? "measurement"
                  : kind === "inventory"
                    ? "product"
                    : kind === "workouts"
                      ? "workout"
                      : kind === "leads"
                        ? "lead"
                        : "appointment"}
              </button>
            )
          )
        }
      />
      {action.error && (
        <div className="form-error" role="alert">
          {action.error}
        </div>
      )}
      <section className="card">
        <State {...d} retry={d.reload}>
          {d.data && <Table rows={d.data.items} columns={columns[kind]} />}
        </State>
      </section>
      {open && (
        <Modal
          title={`Add ${operationCopy[kind][0].toLowerCase()}`}
          onClose={() => setOpen(false)}
        >
          {["progress", "appointments", "workouts"].includes(kind) && (
            <label className="member-search-label">
              Search members
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or phone"
              />
            </label>
          )}
          {kind === "workouts" ? (
            <WorkoutEditor
              onDone={() => {
                setOpen(false);
                d.reload();
              }}
            />
          ) : (
            <Form
              fields={fields}
              onSubmit={async (p) => {
                let body = p;
                if (kind === "inventory") {
                  const { purchase, selling, ...rest } = p;
                  body = {
                    ...rest,
                    purchase_paise: Math.round(purchase * 100),
                    selling_paise: Math.round(selling * 100),
                  };
                }
                if (kind === "appointments")
                  body = {
                    ...p,
                    starts_at: new Date(p.starts_at).toISOString(),
                    ends_at: new Date(p.ends_at).toISOString(),
                  };
                if (kind === "workouts")
                  body = {
                    member_id: p.member_id,
                    name: p.name,
                    exercises: [
                      {
                        day: p.day,
                        name: p.exercise,
                        sets: p.sets,
                        reps: p.reps,
                        weight: p.weight,
                        rest_seconds: p.rest_seconds,
                      },
                    ],
                  };
                await api(`/${kind}`, "POST", body);
                setOpen(false);
                d.reload();
              }}
            />
          )}
        </Modal>
      )}
      {selected && (
        <Modal
          title={
            kind === "inventory"
              ? `Adjust ${selected.name}`
              : kind === "leads"
                ? "Link converted member"
                : `Assign to ${selected.name}`
          }
          onClose={() => setSelected(null)}
        >
          {kind !== "inventory" && (
            <label className="member-search-label">
              Search members
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}
          <Form
            fields={
              kind === "inventory"
                ? [
                    {
                      name: "delta",
                      label: "Quantity change (+ stock in, − stock out)",
                      type: "number",
                    },
                    { name: "reason", label: "Reason" },
                  ]
                : [mf]
            }
            onSubmit={async (p) => {
              if (kind === "inventory")
                await api(`/inventory/${selected.id}/stock`, "POST", p);
              else if (kind === "leads")
                await api(`/leads/${selected.id}`, "PATCH", {
                  ...p,
                  status: "CONVERTED",
                });
              else await api(`/trainers/${selected.id}/assign`, "POST", p);
              setSelected(null);
              d.reload();
            }}
          />
        </Modal>
      )}
      {editingWorkout && (
        <Modal
          title="Edit workout plan"
          onClose={() => setEditingWorkout(null)}
        >
          <WorkoutEditor
            initial={editingWorkout}
            onDone={() => {
              setEditingWorkout(null);
              d.reload();
            }}
          />
        </Modal>
      )}
      {kind === "workouts" && user?.role === "TRAINER" && <TrainerMembers />}
    </>
  );
}
export function Reports() {
  const [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today()),
    d = useData(`/reports?from=${from}&to=${to}`);
  return (
    <>
      <PageHeader
        title="Reports"
        description="Useful answers from your actual business records."
      />
      <section className="card">
        <div className="table-toolbar">
          <label>
            From{" "}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To{" "}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <div className="button-row">
            {["members", "payments", "attendance"].map((k) => (
              <a key={k} className="button" href={`/api/reports/${k}/csv`}>
                <Download size={15} />
                {k} CSV
              </a>
            ))}
          </div>
        </div>
        <State {...d} retry={d.reload}>
          {d.data && (
            <>
              <div className="card-heading">
                <h2>Revenue by payment method</h2>
              </div>
              <Table
                rows={d.data.revenue}
                columns={[
                  { label: "Method", render: (r) => r.method },
                  { label: "Payments", render: (r) => r.payments },
                  { label: "Revenue", render: (r) => money(r.revenue) },
                ]}
              />
              <div className="card-heading">
                <h2>Daily attendance</h2>
              </div>
              <Table
                rows={d.data.attendance}
                columns={[
                  { label: "Day", render: (r) => date(r.day) },
                  { label: "Visits", render: (r) => r.visits },
                ]}
              />
            </>
          )}
        </State>
      </section>
    </>
  );
}
export function SettingsPage() {
  const [accountSetup, setAccountSetup] = useState<AccountSetup | null>(null);
  const d = useData("/settings"),
    staff = useData("/staff"),
    [tab, setTab] = useState(
      new URLSearchParams(location.search).get("tab") === "staff"
        ? "Staff & access"
        : "Gym profile",
    ),
    [invite, setInvite] = useState(false),
    [saved, setSaved] = useState(false);
  const action = useAction(staff.reload);
  return (
    <>
      <PageHeader
        title="Make GymOS yours"
        description="Your gym details, preferences and team, in one place."
      />
      <div className="tabs">
        {["Gym profile", "Staff & access"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Gym profile" ? (
        <section className="card settings-card">
          <State {...d} retry={d.reload}>
            {d.data && (
              <>
                <h2>Gym information</h2>
                {saved && (
                  <div className="notice" role="status">
                    Settings saved.
                  </div>
                )}
                <Form
                  fields={[
                    { name: "name", label: "Gym name" },
                    { name: "email", label: "Contact email", type: "email" },
                    { name: "phone", label: "Phone", required: false },
                    { name: "address", label: "Address", type: "textarea" },
                    {
                      name: "inactive_days",
                      label: "Inactive after (days)",
                      type: "number",
                      min: 1,
                      max: 365,
                      defaultValue: 14,
                    },
                  ]}
                  initial={{
                    ...d.data.organization,
                    ...d.data.organization.settings,
                  }}
                  onSubmit={async (p) => {
                    await api("/settings", "PATCH", p);
                    setSaved(true);
                    d.reload();
                  }}
                />
              </>
            )}
          </State>
        </section>
      ) : (
        <section className="card">
          <div className="card-heading">
            <h2>Your team</h2>
            <button className="primary" onClick={() => setInvite(true)}>
              <Plus size={16} /> Add staff account
            </button>
          </div>
          {action.error && <p role="alert">{action.error}</p>}
          <State {...staff} retry={staff.reload}>
            {staff.data && (
              <Table
                rows={staff.data.items}
                columns={[
                  {
                    label: "Name",
                    render: (r) => <Person name={r.name} sub={r.email} />,
                  },
                  { label: "Role", render: (r) => <Badge>{r.role}</Badge> },
                  {
                    label: "Access",
                    render: (r) =>
                      !r.active
                        ? "Deactivated"
                        : r.setup_pending
                          ? "Awaiting password setup"
                          : "Active",
                  },
                  {
                    label: "Action",
                    render: (r) =>
                      r.role !== "OWNER" && (
                        <button
                          disabled={action.busy}
                          onClick={() =>
                            void action.perform(
                              `/staff/${r.id}`,
                              { active: !r.active },
                              "PATCH",
                            )
                          }
                        >
                          {r.active ? "Deactivate" : "Activate"}
                        </button>
                      ),
                  },
                  {
                    label: "Permissions",
                    render: (r) => (
                      <StaffAccess staff={r} onSaved={staff.reload} />
                    ),
                  },
                ]}
              />
            )}
          </State>
        </section>
      )}
      {invite && (
        <Modal title="Add staff account" onClose={() => setInvite(false)}>
          <Form
            fields={[
              { name: "name", label: "Full name" },
              { name: "email", label: "Email address", type: "email" },
              {
                name: "role",
                label: "Role",
                type: "select",
                options: ["MANAGER", "RECEPTIONIST", "TRAINER"].map((v) => ({
                  value: v,
                  label: v,
                })),
              },
              accountDeliveryField,
            ]}
            submit="Create staff account"
            onSubmit={async (p) => {
              const result = await api("/staff", "POST", p);
              setInvite(false);
              setAccountSetup(result);
              staff.reload();
            }}
          />
        </Modal>
      )}
      {accountSetup && (
        <AccountSetupResult
          result={accountSetup}
          onClose={() => setAccountSetup(null)}
        />
      )}
    </>
  );
}
export function Subscription() {
  const d = useData("/subscription");
  return (
    <>
      <PageHeader
        title="Your GymOS subscription"
        description="Room to grow, with clear limits and no surprises."
      />
      <State {...d} retry={d.reload}>
        {d.data && (
          <>
            <section className="card subscription-current">
              <div>
                <Badge tone="green">{d.data.subscription.status}</Badge>
                <h2>{d.data.subscription.name}</h2>
                <p>Renewal: {date(d.data.subscription.renews_at)}</p>
              </div>
              <div>
                <strong>{money(d.data.subscription.price_paise)}</strong>
                <span> / month</span>
              </div>
              <div>
                <p>
                  {d.data.usage.members} / {d.data.subscription.member_limit}{" "}
                  active members
                </p>
                <p>
                  {d.data.usage.staff} / {d.data.subscription.staff_limit} staff
                  accounts
                </p>
              </div>
            </section>
            <div className="notice">
              Plan changes are managed by your GymOS administrator. Online
              subscription checkout is not configured. Third-party messaging
              charges are separate.
            </div>
            <div className="plan-grid">
              {d.data.plans.map((p: any) => (
                <article key={p.id} className="card plan-card">
                  <h2>{p.name}</h2>
                  <div className="plan-price">
                    {p.id === "ENTERPRISE" ? "Custom" : money(p.price_paise)}
                  </div>
                  <p>{p.member_limit.toLocaleString()} active members</p>
                  {p.features.map((f: string) => (
                    <div className="plan-line" key={f}>
                      <Check size={14} />
                      {f.replaceAll("_", " ")}
                    </div>
                  ))}
                </article>
              ))}
            </div>
          </>
        )}
      </State>
      <AccessUsage />
    </>
  );
}
export function AdminPage({ kind }: { kind: string }) {
  const [accountSetup, setAccountSetup] = useState<AccountSetup | null>(null);
  const [ownerGym, setOwnerGym] = useState<any>(null);
  const d = useData(`/admin/${kind}`),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [mode, setMode] = useState("subscription");
  const action = useAction(d.reload);
  const titles: Record<string, string> = {
    dashboard: "Platform overview",
    gyms: "Customer gyms",
    plans: "Plans & entitlements",
    users: "Platform users",
    "system-health": "System health",
    "audit-logs": "Audit logs",
  };
  return (
    <>
      <PageHeader
        eyebrow="GYMOS PLATFORM"
        title={titles[kind]}
        description="Manage the platform with a clear view of every organization."
        action={
          kind === "gyms" && (
            <button className="primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Add gym & owner
            </button>
          )
        }
      />
      {action.error && (
        <p role="alert" className="form-error">
          {action.error}
        </p>
      )}
      <State {...d} retry={d.reload}>
        {d.data &&
          (kind === "dashboard" ? (
            <>
              <div className="stat-grid">
                {Object.entries(d.data.metrics).map(([k, v]) => (
                  <article className="stat-card" key={k}>
                    <div className="stat-label">{k.replaceAll("_", " ")}</div>
                    <strong className="stat-number">
                      {k === "mrr" ? money(Number(v)) : String(v)}
                    </strong>
                  </article>
                ))}
              </div>
              <section className="card">
                <div className="card-heading">
                  <h2>Platform activity</h2>
                </div>
                <Table
                  rows={d.data.activity}
                  columns={[
                    { label: "Action", render: (r) => r.action },
                    {
                      label: "Time",
                      render: (r) =>
                        `${date(r.created_at)} ${time(r.created_at)}`,
                    },
                  ]}
                />
              </section>
            </>
          ) : kind === "system-health" ? (
            <div className="stat-grid">
              {["database", "email", "whatsapp"].map((k) => (
                <article className="stat-card" key={k}>
                  <h2>{k}</h2>
                  <Badge>{d.data[k]}</Badge>
                </article>
              ))}
              <section className="card">
                <div className="card-heading">
                  <h2>Background jobs</h2>
                </div>
                <Table
                  rows={d.data.jobs}
                  columns={[
                    { label: "Status", render: (r) => r.status },
                    { label: "Count", render: (r) => r.count },
                  ]}
                />
              </section>
              <section className="card">
                <div className="card-heading">
                  <h2>Backup history</h2>
                </div>
                <Table
                  rows={d.data.backups}
                  columns={[
                    { label: "Status", render: (r) => r.status },
                    { label: "Date", render: (r) => date(r.created_at) },
                  ]}
                />
              </section>
            </div>
          ) : (
            <section className="card">
              <Table
                rows={d.data.items}
                columns={
                  kind === "gyms"
                    ? [
                        {
                          label: "Gym",
                          render: (r) => <Person name={r.name} sub={r.email} />,
                        },
                        {
                          label: "Plan",
                          render: (r) => <Badge>{r.plan_id}</Badge>,
                        },
                        { label: "Members", render: (r) => r.member_count },
                        {
                          label: "Status",
                          render: (r) => (
                            <Badge
                              tone={r.status === "ACTIVE" ? "green" : "amber"}
                            >
                              {r.status}
                            </Badge>
                          ),
                        },
                        {
                          label: "Action",
                          render: (r) => (
                            <div className="button-row">
                              <button onClick={() => setOwnerGym(r)}>
                                Add owner account
                              </button>
                              <Link
                                className="button"
                                to={`/admin/gyms/${r.id}`}
                              >
                                Details & access
                              </Link>
                              <button
                                onClick={() => {
                                  setSelected(r);
                                  setMode("subscription");
                                }}
                              >
                                Subscription
                              </button>
                              <button
                                onClick={() => {
                                  setSelected(r);
                                  setMode("status");
                                }}
                              >
                                Change status
                              </button>
                            </div>
                          ),
                        },
                      ]
                    : kind === "plans"
                      ? [
                          { label: "Plan", render: (r) => r.name },
                          {
                            label: "Monthly price",
                            render: (r) => money(r.price_paise),
                          },
                          {
                            label: "Member limit",
                            render: (r) => r.member_limit,
                          },
                          {
                            label: "Staff limit",
                            render: (r) => r.staff_limit,
                          },
                          {
                            label: "Features",
                            render: (r) => r.features.join(", "),
                          },
                        ]
                      : kind === "users"
                        ? [
                            {
                              label: "User",
                              render: (r) => (
                                <Person name={r.name} sub={r.email} />
                              ),
                            },
                            {
                              label: "Role",
                              render: (r) => <Badge>{r.role}</Badge>,
                            },
                            {
                              label: "Access",
                              render: (r) =>
                                !r.active
                                  ? "Inactive"
                                  : r.setup_pending
                                    ? "Awaiting password setup"
                                    : "Active",
                            },
                          ]
                        : [
                            { label: "Action", render: (r) => r.action },
                            {
                              label: "Organization",
                              render: (r) => r.organization_id ?? "Platform",
                            },
                            {
                              label: "Timestamp",
                              render: (r) =>
                                `${date(r.created_at)} ${time(r.created_at)}`,
                            },
                          ]
                }
              />
            </section>
          ))}
      </State>
      {open && (
        <Modal title="Add gym & owner account" onClose={() => setOpen(false)}>
          <Form
            fields={[
              { name: "name", label: "Gym name" },
              {
                name: "slug",
                label: "Gym ID (slug)",
                hint: `${gymSlugMessage} Spaces become hyphens automatically.`,
                placeholder:'iron-fitness',
                normalize:normalizeGymSlug,
                validate:validateGymSlug,
              },
              { name: "owner_name", label: "Owner name" },
              { name: "email", label: "Owner email", type: "email" },
              ownerPasswordField,
              { name: "phone", label: "Phone", required: false },
              {
                name: "plan_id",
                label: "Trial plan",
                type: "select",
                options: ["BASIC", "PRO", "BUSINESS", "ENTERPRISE"].map(
                  (v) => ({ value: v, label: v }),
                ),
                defaultValue: "BUSINESS",
                hint: "Business and Enterprise include member logins. New gyms start with a 14-day trial.",
              },
              accountDeliveryField,
              ...initialOwnerPaymentFields,
            ]}
            submit="Create gym & owner"
            onSubmit={async (p) => {
              const result = await api("/admin/gyms", "POST", withInitialOwnerPayment(p,paymentRequestId()));
              setOpen(false);
              setAccountSetup(result);
              d.reload();
            }}
          />
        </Modal>
      )}
      {ownerGym && (
        <Modal
          title={`Add owner to ${ownerGym.name}`}
          onClose={() => setOwnerGym(null)}
        >
          <Form
            fields={[
              { name: "name", label: "Owner name" },
              { name: "email", label: "Owner email", type: "email" },
              ownerPasswordField,
              accountDeliveryField,
              ...initialOwnerPaymentFields,
            ]}
            submit="Create owner account"
            onSubmit={async (p) => {
              const result = await api(
                `/admin/gyms/${ownerGym.id}/owners`,
                "POST",
                withInitialOwnerPayment(p,paymentRequestId()),
              );
              setOwnerGym(null);
              setAccountSetup(result);
              d.reload();
            }}
          />
        </Modal>
      )}
      {accountSetup && (
        <AccountSetupResult
          result={accountSetup}
          onClose={() => setAccountSetup(null)}
        />
      )}
      {selected && (
        <Modal
          title={`${selected.name} · ${mode}`}
          onClose={() => setSelected(null)}
        >
          <Form
            fields={
              mode === "status"
                ? [
                    {
                      name: "status",
                      label: "Gym status",
                      type: "select",
                      defaultValue: selected.status,
                      options: ["ACTIVE", "SUSPENDED", "DEACTIVATED"].map(
                        (v) => ({ value: v, label: v }),
                      ),
                    },
                  ]
                : [
                    {
                      name: "plan_id",
                      label: "Plan",
                      type: "select",
                      defaultValue: selected.plan_id,
                      options: ["BASIC", "PRO", "BUSINESS", "ENTERPRISE"].map(
                        (v) => ({ value: v, label: v }),
                      ),
                    },
                    {
                      name: "status",
                      label: "Subscription status",
                      type: "select",
                      defaultValue: selected.subscription_status,
                      options: [
                        "TRIAL",
                        "ACTIVE",
                        "PAST_DUE",
                        "SUSPENDED",
                        "CANCELLED",
                      ].map((v) => ({ value: v, label: v })),
                    },
                    {
                      name: "renews_at",
                      label: "Renewal date",
                      type: "date",
                      defaultValue: String(selected.renews_at).slice(0, 10),
                    },
                  ]
            }
            onSubmit={async (p) => {
              await api(
                `/admin/gyms/${selected.id}${mode === "subscription" ? "/subscription" : ""}`,
                mode === "subscription" ? "PUT" : "PATCH",
                mode === "subscription"
                  ? { ...p, renews_at: new Date(p.renews_at).toISOString() }
                  : p,
              );
              setSelected(null);
              d.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
