import { useState } from "react";
import { api, date, time } from "./api";
import { useData, State, Table, Modal } from "./components";
import { useAuth } from "./main";
const blank = () => ({
  day: "Monday",
  muscle_group: "",
  name: "",
  sets: 3,
  reps: "10",
  weight: "",
  rest_seconds: 60,
  notes: "",
});
export function WorkoutEditor({
  initial,
  memberMode = false,
  onDone,
}: {
  initial?: any;
  memberMode?: boolean;
  onDone: () => void;
}) {
  const { user } = useAuth(),
    [search, setSearch] = useState(""),
    [member, setMember] = useState(initial?.member_id ?? ""),
    [name, setName] = useState(initial?.name ?? ""),
    [exercises, setExercises] = useState<any[]>(
      initial?.exercises ?? [blank()],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const d = useData(
    memberMode || initial
      ? null
      : user?.role === "TRAINER"
        ? "/assigned-members"
        : `/members?search=${encodeURIComponent(search)}`,
  );
  const update = (i: number, k: string, v: unknown) =>
    setExercises(exercises.map((e, n) => (n === i ? { ...e, [k]: v } : e)));
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          await api(
            `${memberMode ? "/member" : ""}/workouts${initial ? `/${initial.id}` : ""}`,
            initial ? "PUT" : "POST",
            {
              name,
              exercises,
              ...(!memberMode && !initial ? { member_id: member } : {}),
            },
          );
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!memberMode && !initial && (
        <>
          <label>
            Search members
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <State {...d} retry={d.reload}>
            <label>
              Member
              <select
                required
                value={member}
                onChange={(e) => setMember(e.target.value)}
              >
                <option value="">Select member</option>
                {d.data?.items
                  .filter(
                    (m: any) =>
                      user?.role !== "TRAINER" ||
                      m.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
          </State>
        </>
      )}
      <label>
        Plan name
        <input
          required
          minLength={2}
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {exercises.map((ex, i) => (
        <fieldset key={i}>
          <legend>Exercise {i + 1}</legend>
          <div className="exercise-grid">
            {[
              ["day", "Day"],
              ["muscle_group", "Muscle group"],
              ["name", "Exercise"],
              ["sets", "Sets"],
              ["reps", "Repetitions"],
              ["weight", "Weight"],
              ["rest_seconds", "Rest (seconds)"],
              ["notes", "Notes"],
            ].map(([k, l]) => (
              <label key={k}>
                {l}
                <input
                  aria-label={`${l} ${i + 1}`}
                  required={["day", "name", "sets", "reps"].includes(k)}
                  type={
                    ["sets", "rest_seconds"].includes(k) ? "number" : "text"
                  }
                  min={k === "sets" ? 1 : 0}
                  max={
                    k === "sets" ? 50 : k === "rest_seconds" ? 3600 : undefined
                  }
                  maxLength={k === "notes" ? 500 : 100}
                  value={ex[k] ?? ""}
                  onChange={(e) =>
                    update(
                      i,
                      k,
                      ["sets", "rest_seconds"].includes(k)
                        ? Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={exercises.length === 1}
            onClick={() => setExercises(exercises.filter((_, n) => n !== i))}
          >
            Remove exercise
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={exercises.length >= 100}
        onClick={() => setExercises([...exercises, blank()])}
      >
        Add exercise / training day
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save workout plan"}
      </button>
    </form>
  );
}
export function TrainerMembers() {
  const [selected, setSelected] = useState(""),
    d = useData("/assigned-members"),
    detail = useData(selected ? `/assigned-members/${selected}` : null);
  return (
    <section className="card profile-details">
      <h2>Your assigned members</h2>
      <State {...d} retry={d.reload}>
        {d.data && (
          <Table
            rows={d.data.items}
            columns={[
              { label: "Member", render: (r) => r.name },
              {
                label: "Information",
                render: (r) => (
                  <button onClick={() => setSelected(r.id)}>
                    Membership & attendance
                  </button>
                ),
              },
            ]}
          />
        )}
      </State>
      {selected && (
        <Modal
          title="Member training information"
          onClose={() => setSelected("")}
        >
          <State {...detail} retry={detail.reload}>
            {detail.data && (
              <>
                <h3>{detail.data.member.name}</h3>
                <Table
                  rows={detail.data.memberships}
                  columns={[
                    { label: "Start", render: (r) => date(r.starts_on) },
                    { label: "Expiry", render: (r) => date(r.ends_on) },
                    { label: "Status", render: (r) => r.status },
                  ]}
                />
                <h3>Recent attendance</h3>
                <Table
                  rows={detail.data.attendance}
                  columns={[
                    { label: "Date", render: (r) => date(r.checked_in_at) },
                    { label: "In", render: (r) => time(r.checked_in_at) },
                    {
                      label: "Out",
                      render: (r) =>
                        r.checked_out_at ? time(r.checked_out_at) : "Inside",
                    },
                  ]}
                />
              </>
            )}
          </State>
        </Modal>
      )}
    </section>
  );
}
