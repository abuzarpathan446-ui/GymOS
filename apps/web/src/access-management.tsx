import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, date, time, money } from "./api";
import { ownerPasswordField } from './account-setup';
import {
  useData,
  State,
  PageHeader,
  Table,
  Form,
  Modal,
  Badge,
} from "./components";
import {
  featureNames,
  limitNames,
  ownerPermissionNames,
} from "../../shared/policy";
const label = (s: string) =>
  s === "MANAGER" ? "Admin staff" : s.replaceAll("_", " ").replaceAll(":", " ");
export function GymControls() {
  const { id } = useParams(),
    [section, setSection] = useState("overview"),
    [page, setPage] = useState(1),
    [owner, setOwner] = useState<any>(null);
  const d = useData(
    `/admin/gyms/${id}/details?section=${section}&page=${page}`,
  );
  return (
    <>
      <Link to="/admin/gyms">← Customer gyms</Link>
      <PageHeader
        title={d.data?.gym.name ?? "Gym access"}
        description="Control access, resource limits, and owner permissions."
      />
      <State {...d} retry={d.reload}>
        {d.data && (
          <>
            <div className="tabs">
              {[
                "overview",
                "users",
                "members",
                "payments",
                "activity",
                "logins",
              ].map((s) => (
                <button
                  key={s}
                  className={section === s ? "active" : ""}
                  onClick={() => {
                    setSection(s);
                    setPage(1);
                  }}
                >
                  {label(s)}
                </button>
              ))}
            </div>
            {section === "overview" ? (
              <>
                <section className="card profile-details">
                  <h2>Usage and subscription</h2>
                  <p>
                    {d.data.subscription?.plan_id} ·{" "}
                    {d.data.subscription?.status} · Renewal{" "}
                    {date(d.data.subscription?.renews_at)}
                  </p>
                  <div className="stat-grid">
                    {limitNames.map((k) => (
                      <article key={k} className="stat-card">
                        <span>{label(k)}</span>
                        <strong className="stat-number">
                          {d.data.usage[k]} /{" "}
                          {d.data.policy.limits[k] ??
                            d.data.policy.limits.staff}
                        </strong>
                      </article>
                    ))}
                  </div>
                  <h3>Financial activity</h3>
                  <Table
                    rows={d.data.financial?.periods ?? []}
                    columns={[
                      { label: "Period", render: (r) => r.period },
                      {
                        label: "Collected",
                        render: (r) => money(r.revenue_paise),
                      },
                      {
                        label: "Expenses",
                        render: (r) => money(r.expenses_paise),
                      },
                      {
                        label: "Profit / loss",
                        render: (r) => money(r.profit_paise),
                      },
                    ]}
                  />
                </section>
                <AccessEditor id={id!} data={d.data} onSaved={d.reload} />
              </>
            ) : (
              <section className="card">
                <Table
                  rows={d.data.items.slice(0, 25)}
                  columns={
                    section === "users"
                      ? [
                          {
                            label: "User",
                            render: (r) => (
                              <>
                                {r.name}
                                <small className="block">{r.email}</small>
                              </>
                            ),
                          },
                          { label: "Role", render: (r) => label(r.role) },
                          {
                            label: "Status",
                            render: (r) => (
                              <Badge>
                                {r.suspended
                                  ? "SUSPENDED"
                                  : r.active
                                    ? "ACTIVE"
                                    : "DEACTIVATED"}
                              </Badge>
                            ),
                          },
                          {
                            label: "Access",
                            render: (r) =>
                              r.role === "OWNER" ? (
                                <button onClick={() => setOwner(r)}>
                                  Edit owner
                                </button>
                              ) : null,
                          },
                        ]
                      : section === "members"
                        ? [
                            { label: "Member", render: (r) => r.name },
                            { label: "Phone", render: (r) => r.phone },
                            {
                              label: "Status",
                              render: (r) => (r.active ? "Active" : "Inactive"),
                            },
                          ]
                        : section === "payments"
                          ? [
                              { label: "Member", render: (r) => r.name },
                              {
                                label: "Amount",
                                render: (r) => money(r.amount_paise),
                              },
                              { label: "Method", render: (r) => r.method },
                              {
                                label: "Date",
                                render: (r) => date(r.created_at),
                              },
                            ]
                          : section === "activity"
                            ? [
                                { label: "Action", render: (r) => r.action },
                                {
                                  label: "Date",
                                  render: (r) =>
                                    `${date(r.created_at)} ${time(r.created_at)}`,
                                },
                                {
                                  label: "Details",
                                  render: (r) => JSON.stringify(r.metadata),
                                },
                              ]
                            : [
                                { label: "User", render: (r) => r.name },
                                { label: "Role", render: (r) => label(r.role) },
                                {
                                  label: "Login",
                                  render: (r) =>
                                    `${date(r.logged_in_at)} ${time(r.logged_in_at)}`,
                                },
                                {
                                  label: "Logout",
                                  render: (r) =>
                                    r.logged_out_at
                                      ? `${date(r.logged_out_at)} ${time(r.logged_out_at)}`
                                      : new Date(r.expires_at) < new Date()
                                        ? "Session expired"
                                        : "Signed in",
                                },
                              ]
                  }
                />
                <Pager
                  page={page}
                  more={d.data.items.length > 25}
                  setPage={setPage}
                />
              </section>
            )}
          </>
        )}
      </State>
      {owner && (
        <Modal
          title="Owner account & permissions"
          onClose={() => setOwner(null)}
        >
          <OwnerPasswordControl id={owner.id} />
          <RevokeOwnerAccess owner={owner} onRevoked={()=>{setOwner(null);d.reload();}} />
          <Form
            initial={{
              ...owner,
              status: owner.suspended
                ? "SUSPENDED"
                : owner.active
                  ? "ACTIVE"
                  : "DEACTIVATED",
              ...Object.fromEntries(
                ownerPermissionNames.map((k) => [
                  k,
                  String(
                    owner.permission_overrides[k] ??
                      ["members:read", "members:account"].includes(k),
                  ),
                ]),
              ),
            }}
            fields={[
              { name: "name", label: "Name" },
              { name: "email", label: "Email", type: "email" },
              {
                name: "status",
                label: "Account status",
                type: "select",
                options: ["ACTIVE", "DEACTIVATED", "SUSPENDED"].map((v) => ({
                  value: v,
                  label: v,
                })),
              },
              ...ownerPermissionNames.map((k) => ({
                name: k,
                label: label(k),
                type: "select",
                options: [
                  { value: "true", label: "Allowed" },
                  { value: "false", label: "Blocked" },
                ],
              })),
            ]}
            onSubmit={async (p) => {
              await api(`/admin/owners/${owner.id}`, "PATCH", {
                name: p.name,
                email: p.email,
                status: p.status,
                permissions: Object.fromEntries(
                  ownerPermissionNames.map((k) => [k, p[k] === "true"]),
                ),
              });
              setOwner(null);
              d.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
function RevokeOwnerAccess({owner,onRevoked}:{owner:any;onRevoked:()=>void}){
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!owner.active)return <p role="status">Owner login access is revoked. Gym records and payment history are retained.</p>;
  return <section className="notice">
    {!confirm?<button type="button" onClick={()=>setConfirm(true)}>Revoke Owner Access</button>:<>
      <p>Revoke login access for {owner.name}? This signs the owner out and disables login. Gym data and payment records will be kept.</p>
      <button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api(`/admin/owners/${owner.id}`,'PATCH',{name:owner.name,email:owner.email,status:'DEACTIVATED',permissions:owner.permission_overrides});onRevoked();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'Revoking…':'Confirm revoke access'}</button>
      <button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button>
    </>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </section>;
}
function OwnerPasswordControl({id}:{id:string}){
  const [open,setOpen]=useState(false),[message,setMessage]=useState('');
  return <section className="notice">
    <button type="button" onClick={()=>{setOpen(!open);setMessage('');}}>{open?'Cancel password change':'Set / reset owner password'}</button>
    {open&&<><p>Saving replaces the owner password and signs them out on all devices. Share the new password privately.</p><Form
      fields={[{...ownerPasswordField,label:'New owner password',required:true,hint:'Use 12–128 characters.'},{name:'confirm_password',label:'Confirm new password',type:'password'}]}
      submit="Confirm password change"
      onSubmit={async p=>{if(p.password!==p.confirm_password)throw new Error('Passwords do not match.');const result=await api(`/admin/owners/${id}/password`,'PUT',{password:p.password});setOpen(false);setMessage(result.message);}}
    /></>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
function AccessEditor({
  id,
  data,
  onSaved,
}: {
  id: string;
  data: any;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <section className="card profile-details">
      <h2>Manual feature and limit controls</h2>
      <p>
        Inherit uses the subscription default. Locks also block API access.
        Lowering a limit preserves existing records.
      </p>
      <Form
        initial={{
          ...Object.fromEntries(
            featureNames.map((k) => [
              k,
              data.gym.access_overrides.features?.[k] === undefined
                ? "inherit"
                : String(data.gym.access_overrides.features[k]),
            ]),
          ),
          ...Object.fromEntries(
            limitNames.map((k) => [
              `limit_${k}`,
              data.gym.access_overrides.limits?.[k] ?? "",
            ]),
          ),
        }}
        fields={[
          ...limitNames.map((k) => ({
            name: `limit_${k}`,
            label: `Maximum ${label(k)}`,
            type: "number",
            min: 0,
            max: 1000000,
            required: false,
            hint: `Current effective limit: ${data.policy.limits[k] ?? data.policy.limits.staff}. Leave blank to inherit.`,
          })),
          ...featureNames.map((k) => ({
            name: k,
            label: label(k),
            type: "select",
            options: [
              {
                value: "inherit",
                label: `Inherit (${data.policy.features.includes(k) ? "currently on" : "currently off"})`,
              },
              { value: "true", label: "Unlocked" },
              { value: "false", label: "Locked" },
            ],
          })),
        ]}
        onSubmit={async (p) => {
          const limits: Record<string, number> = {};
          for (const k of limitNames)
            if (p[`limit_${k}`] !== "" && p[`limit_${k}`] !== null)
              limits[k] = Number(p[`limit_${k}`]);
          await api(`/admin/gyms/${id}/access`, "PUT", {
            features: Object.fromEntries(
              featureNames
                .filter((k) => p[k] !== "inherit")
                .map((k) => [k, p[k] === "true"]),
            ),
            limits,
          });
          setMessage("Access controls saved.");
          onSaved();
        }}
      />
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function Pager({
  page,
  more,
  setPage,
}: {
  page: number;
  more: boolean;
  setPage: (p: number) => void;
}) {
  return (
    <div className="button-row">
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>
        Previous
      </button>
      <span>Page {page}</span>
      <button disabled={!more} onClick={() => setPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
export function AccessUsage() {
  const d = useData("/access"),
    [open, setOpen] = useState(false),
    [message, setMessage] = useState("");
  return (
    <>
      <section className="card profile-details">
        <h2>Your assigned limits</h2>
        <State {...d} retry={d.reload}>
          {d.data && (
            <>
              <div className="stat-grid">
                {limitNames.map((k) => (
                  <article className="stat-card" key={k}>
                    <span>{label(k)}</span>
                    <strong className="stat-number">
                      {d.data.usage[k]} /{" "}
                      {d.data.policy.limits[k] ?? d.data.policy.limits.staff}
                    </strong>
                  </article>
                ))}
              </div>
              <p>
                Only the Super Admin can change these limits and your
                subscription.
              </p>
              <button onClick={() => setOpen(true)}>Request more access</button>
              <Table
                rows={d.data.requests}
                columns={[
                  { label: "Resource", render: (r) => label(r.resource) },
                  {
                    label: "Requested limit",
                    render: (r) => r.requested_limit ?? "Feature access",
                  },
                  { label: "Status", render: (r) => <Badge>{r.status}</Badge> },
                ]}
              />
              <details>
                <summary>Feature availability</summary>
                {featureNames.map((k) => (
                  <p key={k}>
                    {label(k)}:{" "}
                    {d.data.policy.features.includes(k)
                      ? "Available"
                      : "Locked — contact Super Admin"}
                  </p>
                ))}
              </details>
            </>
          )}
        </State>
        {message && <p role="status">{message}</p>}
      </section>
      {open && (
        <Modal
          title="Request access from Super Admin"
          onClose={() => setOpen(false)}
        >
          <Form
            fields={[
              {
                name: "resource",
                label: "Resource or feature",
                type: "select",
                options: [...new Set([...limitNames, ...featureNames])].map(
                  (k) => ({ value: k, label: label(k) }),
                ),
              },
              {
                name: "requested_limit",
                label: "Requested limit (for resources)",
                type: "number",
                required: false,
                min: 0,
              },
              {
                name: "notes",
                label: "Reason",
                type: "textarea",
                required: true,
              },
            ]}
            onSubmit={async (p) => {
              await api("/access/requests", "POST", {
                ...p,
                requested_limit:
                  p.requested_limit === "" ? null : Number(p.requested_limit),
              });
              setOpen(false);
              setMessage("Request submitted to the Super Admin.");
              d.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function AccessRequests() {
  const d = useData("/admin/access-requests"),
    [selected, setSelected] = useState<any>(null);
  return (
    <>
      <PageHeader
        title="Access requests"
        description="Review customer requests. Apply changes through Gym controls before marking them resolved."
      />
      <State {...d} retry={d.reload}>
        {d.data && (
          <Table
            rows={d.data.items}
            columns={[
              {
                label: "Gym",
                render: (r) => (
                  <Link to={`/admin/gyms/${r.organization_id}`}>{r.gym}</Link>
                ),
              },
              {
                label: "Request",
                render: (r) => (
                  <>
                    {label(r.resource)} {r.requested_limit}
                    <small className="block">{r.notes}</small>
                  </>
                ),
              },
              { label: "Status", render: (r) => <Badge>{r.status}</Badge> },
              {
                label: "Action",
                render: (r) =>
                  r.status === "OPEN" ? (
                    <button onClick={() => setSelected(r)}>Resolve</button>
                  ) : null,
              },
            ]}
          />
        )}
      </State>
      {selected && (
        <Modal title="Close request" onClose={() => setSelected(null)}>
          <Form
            fields={[
              {
                name: "status",
                label: "Outcome",
                type: "select",
                options: [
                  { value: "RESOLVED", label: "Resolved — controls updated" },
                  { value: "DECLINED", label: "Declined" },
                ],
              },
            ]}
            onSubmit={async (p) => {
              await api(`/admin/access-requests/${selected.id}`, "PATCH", p);
              setSelected(null);
              d.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function StaffActivity() {
  const [page, setPage] = useState(1),
    d = useData(`/staff/activity?page=${page}`);
  return (
    <>
      <PageHeader
        title="Staff attendance & activity"
        description="Session-based working duration. Signing in again closes the previous session; expired sessions are offline."
        action={<button onClick={d.reload}>Refresh status</button>}
      />
      <State {...d} retry={d.reload}>
        {d.data && (
          <section className="card">
            <Table
              rows={d.data.items.slice(0, 25)}
              columns={[
                {
                  label: "Staff",
                  render: (r) => (
                    <>
                      {r.name}
                      <small className="block">{label(r.role)}</small>
                    </>
                  ),
                },
                { label: "Date", render: (r) => date(r.logged_in_at) },
                { label: "Login", render: (r) => time(r.logged_in_at) },
                {
                  label: "Logout",
                  render: (r) =>
                    r.logged_out_at
                      ? time(r.logged_out_at)
                      : r.online
                        ? "—"
                        : "Session expired",
                },
                {
                  label: "Duration",
                  render: (r) =>
                    `${Math.floor(r.seconds / 3600)}h ${Math.floor((r.seconds % 3600) / 60)}m`,
                },
                {
                  label: "Status",
                  render: (r) => (
                    <Badge tone={r.online ? "green" : ""}>
                      {r.online ? "ACTIVE" : "OFFLINE"}
                    </Badge>
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
