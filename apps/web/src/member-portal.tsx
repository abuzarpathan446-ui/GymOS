import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, ScanLine } from "lucide-react";
import { useData, State, PageHeader, Table, Badge, Modal } from "./components";
import { date, time, money, today,membershipStatus } from "./api";
import { useAuth } from "./main";
import { WorkoutEditor } from "./workout-editor";

const names: Record<string, string> = {
  membership: "My membership",
  attendance: "My attendance",
  workouts: "My workouts",
  progress: "My progress",
  payments: "My payments",
  appointments: "My appointments",
};
export function MemberPortal({ section }: { section: string }) {
  const { user } = useAuth(),
    [workout, setWorkout] = useState<any>(null);
  const [page, setPage] = useState(1),
    [showQr, setShowQr] = useState(false);
  const d = useData(`/member/${section}?page=${page}`),
    qr = useData(showQr ? "/member/qr" : null);
  const columns: Record<
    string,
    { label: string; render: (r: any) => React.ReactNode }[]
  > = {
    membership: [
      { label: "Plan", render: (r) => r.plan },
      { label: "Starts", render: (r) => date(r.starts_on) },
      { label: "Ends", render: (r) => date(r.ends_on) },
      {
        label: "Status",
        render: (r) => (
          <Badge>
            {membershipStatus(r)}
          </Badge>
        ),
      },
    ],
    attendance: [
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
    ],
    workouts: [
      {
        label: "Edit",
        render: (r) =>
          user?.features.includes("member_workouts") &&
          r.created_by === user.id ? (
            <button onClick={() => setWorkout(r)}>Edit my plan</button>
          ) : null,
      },
      { label: "Workout", render: (r) => <strong>{r.name}</strong> },
      {
        label: "Exercises",
        render: (r) => (
          <div>
            {r.exercises.map((e: any, i: number) => (
              <p key={i}>
                {e.day}: {e.name} · {e.sets} × {e.reps}
                {e.weight ? ` · ${e.weight}` : ""} · Rest {e.rest_seconds}s
                {e.notes ? ` · ${e.notes}` : ""}
              </p>
            ))}
          </div>
        ),
      },
    ],
    progress: [
      { label: "Date", render: (r) => date(r.measured_on) },
      { label: "Weight", render: (r) => `${r.weight_kg} kg` },
      { label: "Height", render: (r) => `${r.height_cm} cm` },
      {
        label: "Body fat",
        render: (r) => (r.body_fat === null ? "—" : `${r.body_fat}%`),
      },
    ],
    payments: [
      {
        label: "Receipt",
        render: (r) => `INV-${String(r.invoice_number).padStart(6, "0")}`,
      },
      { label: "Paid", render: (r) => money(r.amount_paise) },
      { label: "Method", render: (r) => r.method },
      { label: "Date", render: (r) => date(r.created_at) },
      { label: "Status", render: (r) => <Badge>{r.status}</Badge> },
    ],
    appointments: [
      { label: "Trainer", render: (r) => r.trainer_name },
      { label: "Date", render: (r) => date(r.starts_at) },
      {
        label: "Time",
        render: (r) => `${time(r.starts_at)} – ${time(r.ends_at)}`,
      },
      { label: "Status", render: (r) => <Badge>{r.status}</Badge> },
    ],
  };
  return (
    <>
      <PageHeader
        eyebrow="YOUR PERSONAL GYM SPACE"
        title={
          section === "dashboard"
            ? "Your next chapter starts here."
            : names[section]
        }
        description="Your records, securely connected to your gym."
        action={
          section === "dashboard" && (
            <button className="primary" onClick={() => setShowQr(true)}>
              <ScanLine size={17} /> My QR card
            </button>
          )
        }
      />
      {section === "workouts" && user?.features.includes("member_workouts") && (
        <button className="primary" onClick={() => setWorkout({})}>
          Create my workout
        </button>
      )}
      <State {...d} retry={d.reload}>
        {d.data &&
          (section === "dashboard" ? (
            <>
              <section className="welcome-strip">
                <div>
                  <Badge tone="green">{d.data.gym.name}</Badge>
                  <h2>Hello, {d.data.member.name.split(" ")[0]}.</h2>
                  {d.data.member.photo && (
                    <img
                      src={d.data.member.photo}
                      width="80"
                      height="80"
                      alt="Your profile"
                    />
                  )}
                  <p>
                    {d.data.member.phone} · {d.data.member.email}
                  </p>
                  <p>
                    GYM-{String(d.data.member.number).padStart(6, "0")} · Member
                    since {date(d.data.member.created_at)}
                  </p>
                  <p>
                    Your gym team manages updates to your profile and
                    membership.
                  </p>
                </div>
              </section>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">Membership</div>
                  <h2>{d.data.membership?.plan ?? "No membership yet"}</h2>
                  {d.data.membership&&<><Badge>{membershipStatus(d.data.membership)}</Badge><p>Starts {date(d.data.membership.starts_on)}</p></>}
                  <p>Expires {date(d.data.membership?.ends_on)}</p>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Recorded visits</div>
                  <strong className="stat-number">
                    {d.data.visits?.total ?? "Unavailable"}
                  </strong>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Check-in status</div>
                  <h2>
                    {d.data.visits
                      ? d.data.visits.inside
                        ? "Currently inside"
                        : "Checked out"
                      : "Unavailable"}
                  </h2>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Contact your gym</div>
                  <h2>{d.data.gym.phone || "Ask at reception"}</h2>
                  <p>{d.data.gym.address}</p>
                </div>
              </div>
              <div className="plan-grid">
                {Object.entries(names).map(([key, title]) => (
                  <Link
                    key={key}
                    to={`/member/${key}`}
                    className="card plan-card"
                  >
                    <h2>{title}</h2>
                    <span>
                      View my records <ArrowRight size={15} />
                    </span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <section className="card">
              {d.data.summary && (
                <div className="notice">
                  This month: {d.data.summary.present_days} present dates /{" "}
                  {d.data.summary.elapsed_days} elapsed calendar days (
                  {d.data.summary.percentage}%).
                </div>
              )}
              {d.data.balances && (
                <Table
                  rows={d.data.balances}
                  columns={[
                    { label: "Membership", render: (r) => r.plan },
                    { label: "Total fee", render: (r) => money(r.fee_paise) },
                    { label: "Paid", render: (r) => money(r.paid_paise) },
                    { label: "Pending", render: (r) => money(r.pending_paise) },
                    {
                      label: "Deadline",
                      render: (r) => date(r.payment_deadline),
                    },
                    {
                      label: "Status",
                      render: (r) => <Badge>{r.payment_status}</Badge>,
                    },
                  ]}
                />
              )}
              <Table rows={d.data.items} columns={columns[section]} />
              <div className="pagination">
                <span>Page {page}</span>
                <div>
                  <button
                    aria-label="Previous page"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    aria-label="Next page"
                    disabled={!d.data.has_more}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </section>
          ))}
      </State>
      {workout && (
        <Modal
          title={workout.id ? "Edit my workout" : "Create my workout"}
          onClose={() => setWorkout(null)}
        >
          <WorkoutEditor
            memberMode
            initial={workout.id ? workout : undefined}
            onDone={() => {
              setWorkout(null);
              d.reload();
            }}
          />
        </Modal>
      )}
      {showQr && (
        <Modal title="My member QR card" onClose={() => setShowQr(false)}>
          <State {...qr} retry={qr.reload}>
            {qr.data && (
              <div className="qr-card">
                <img src={qr.data.qr} alt="My gym check-in QR code" />
                <p>{qr.data.identifier}</p>
                <small>
                  Show this card at reception. A valid membership is required
                  for entry.
                </small>
              </div>
            )}
          </State>
        </Modal>
      )}
    </>
  );
}
