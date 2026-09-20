import {
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  X,
  LoaderCircle,
  AlertCircle,
  Inbox,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api,ApiError } from "./api";
export function useData(path: string | null) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    if (!path) { setLoading(false); setData(null); setError(""); return; }
    setLoading(true);
    setError("");
    api(path)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, version]);
  return { data, error, loading, reload: () => setVersion((v) => v + 1) };
}
export function State({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className="loading" role="status">
        <LoaderCircle className="spin" /> Loading your workspace…
      </div>
    );
  if (error)
    return (
      <div className="error-panel" role="alert">
        <AlertCircle />
        <h3>We couldn’t load this information</h3>
        <p>{error}</p>
        <button onClick={retry}>Try again</button>
      </div>
    );
  return <>{children}</>;
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title = "Nothing here yet",
  text = "New records will appear here.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: string;
  defaultValue?: string | number;
  hint?: string;
  placeholder?:string;
  normalize?:(value:string)=>string;
  validate?:(value:string)=>string|undefined;
};
export function Form({
  fields,
  onSubmit,
  submit = "Save",
  initial = {},
}: {
  fields: Field[];
  onSubmit: (value: any) => Promise<void>;
  submit?: string;
  initial?: any;
}) {
  const formId=useId();
  const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFieldErrors({});
    const form=e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const invalid:Record<string,string>={};
    for(const f of fields) {
      if(f.normalize && typeof values[f.name]==='string'){
        values[f.name]=f.normalize(String(values[f.name]));
        const input=form.elements.namedItem(f.name) as HTMLInputElement|null;
        if(input)input.value=String(values[f.name]);
      }
      const message=f.validate?.(String(values[f.name]??''));
      if(message)invalid[f.name]=message;
    }
    if(Object.keys(invalid).length){setFieldErrors(invalid);setError('Please correct the highlighted fields.');setBusy(false);(form.elements.namedItem(Object.keys(invalid)[0]) as HTMLElement|null)?.focus();return;}
    for (const f of fields)
      if (f.type === "number" && values[f.name] !== '') values[f.name] = Number(values[f.name]) as any;
    try {
      await onSubmit(values);
    } catch (e) {
      if(e instanceof ApiError && e.fields.length){
        const errors:Record<string,string>={};
        for(const issue of e.fields)if(fields.some(f=>f.name===issue.path))errors[issue.path]=issue.message;
        setFieldErrors(errors);
        setError(Object.keys(errors).length?'Please correct the highlighted fields.':e.message);
        (form.elements.namedItem(Object.keys(errors)[0]??'') as HTMLElement|null)?.focus();
      }else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="form" onChange={e=>{const target=e.target;if(!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement))return;const name=target.name;if(name)setFieldErrors(current=>{const next={...current};delete next[name];return next;});}}>
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.type === "select" ? (
            <select
              name={f.name}
              aria-invalid={!!fieldErrors[f.name]}
              aria-describedby={fieldErrors[f.name]?`${formId}-${f.name}-error`:undefined}
              required={f.required ?? true}
              defaultValue={initial[f.name] ?? f.defaultValue ?? ""}
            >
              <option value="" disabled>
                Select…
              </option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              name={f.name}
              aria-invalid={!!fieldErrors[f.name]}
              aria-describedby={fieldErrors[f.name]?`${formId}-${f.name}-error`:undefined}
              defaultValue={initial[f.name] ?? f.defaultValue ?? ""}
              required={f.required ?? false}
              rows={3}
            />
          ) : (
            <input
              name={f.name}
              aria-invalid={!!fieldErrors[f.name]}
              aria-describedby={fieldErrors[f.name]?`${formId}-${f.name}-error`:undefined}
              placeholder={f.placeholder}
              onBlur={e=>{if(f.normalize)e.currentTarget.value=f.normalize(e.currentTarget.value);const message=f.validate?.(e.currentTarget.value);setFieldErrors(current=>{const next={...current};if(message)next[f.name]=message;else delete next[f.name];return next;});}}
              type={f.type ?? "text"}
              required={f.required ?? true}
              defaultValue={initial[f.name] ?? f.defaultValue ?? ""}
              min={f.min}
              max={f.max}
              step={f.step}
            />
          )}{" "}
          {f.hint && <small>{f.hint}</small>}
          {fieldErrors[f.name]&&<small className="field-error" id={`${formId}-${f.name}-error`} role="alert">{fieldErrors[f.name]}</small>}
        </label>
      ))}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle size={16} className="spin" /> Saving…
          </>
        ) : (
          submit
        )}
      </button>
    </form>
  );
}
export function Table({
  columns,
  rows,
  rowKey = "id",
}: {
  columns: { label: string; render: (r: any) => ReactNode }[];
  rows: any[];
  rowKey?: string;
}) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i}>
              {columns.map((c) => (
                <td key={c.label}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total} records · Page {page} of {Math.max(1, Math.ceil(total / 25))}
      </span>
      <div>
        <button
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label="Next page"
          disabled={page * 25 >= total}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function PageHeader({
  eyebrow = "WORKSPACE",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
