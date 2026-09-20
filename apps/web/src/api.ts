export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  organization_id: string | null;
  permissions: string[];
  features: string[];
  csrf_token: string;
};
let csrf = "";
export type FieldIssue = {path:string;message:string};
export class ApiError extends Error {
  constructor(message:string,public fields:FieldIssue[]=[],public status=400){super(message);this.name='ApiError';}
}
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-CSRF-Token": csrf,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(
      data.fields
        ? `${data.error} ${data.fields.map((f: any) => `${f.path}: ${f.message}`).join(" ")}`
        : (data.error ?? "Request failed."),
      Array.isArray(data.fields) ? data.fields : [],
      r.status,
    );
  return data;
}
export const money = (paise: number | string = 0) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(paise) / 100);
export const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
export const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function membershipStatus(row: {status:string;starts_on?:string;ends_on:string}) {
  if(!['ACTIVE','TRIAL'].includes(row.status))return row.status;
  const current=today(),end=String(row.ends_on).slice(0,10);
  if(end<current)return 'EXPIRED';
  if(row.starts_on&&String(row.starts_on).slice(0,10)>current)return 'UPCOMING';
  if((Date.parse(end)-Date.parse(current))/86400000<=7)return 'EXPIRING_SOON';
  return row.status;
}
