import React, { useState, useEffect, createContext, useContext } from "react";
import {OwnerPayments} from './owner-payments';
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  Link,
} from "react-router-dom";
import {
  Activity,
  LayoutDashboard,
  Users,
  ScanLine,
  CreditCard,
  FileText,
  Dumbbell,
  ClipboardList,
  TrendingUp,
  UserRoundPlus,
  CalendarDays,
  Package,
  ChartNoAxesCombined,
  Bell,
  Settings,
  Layers,
  Sun,
  Moon,
  LogOut,
  Menu,
  ArrowUpRight,
  ShieldCheck,
  Building2,
  HeartPulse,
  ScrollText,
  Search,
  ChevronRight,
} from "lucide-react";
import { api, setCsrf, type User } from "./api";
import { Form, PageHeader, State, useData } from "./components";
import {
  Dashboard,
  Members,
  MemberDetail,
  MembershipPlans,
  Payments,
  Attendance,
  OperationalPage,
  Reports,
  SettingsPage,
  Subscription,
  AdminPage,
} from "./pages";
import "./styles.css";
import { portals, portalForRole, homeForRole } from "../../shared/access";
import { MemberPortal } from "./member-portal";
import {
  GymControls,
  AccessRequests,
  StaffActivity,
} from "./access-management";
import { Expenses, WhatsAppReminders } from "./business-controls";
import { permissionFeature } from "../../shared/policy";
const Auth = createContext<{ user: User | null; refresh: () => Promise<void> }>(
  { user: null, refresh: async () => {} },
);
export const useAuth = () => useContext(Auth);
function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Activity size={24} strokeWidth={2.5} />
      </span>
      gym<span className="brand-os">os</span>
      <span className="brand-dot">®</span>
    </span>
  );
}
const nav = [
  ["Overview", "/dashboard", "Dashboard", LayoutDashboard, "dashboard"],
  ["OPERATIONS", "/members", "Members", Users, "members:read"],
  ["", "/memberships", "Membership plans", Layers, "memberships"],
  ["", "/attendance", "Attendance", ScanLine, "attendance"],
  ["", "/payments", "Payments", CreditCard, "payments"],
  ["", "/invoices", "Invoices", FileText, "payments"],
  ["", "/expenses", "Expenses", CreditCard, "expenses"],
  ["", "/staff-activity", "Staff attendance", Activity, "staff"],
  ["", "/whatsapp", "WhatsApp reminders", Bell, "whatsapp"],
  ["COACHING & GROWTH", "/trainers", "Trainers", Dumbbell, "trainers"],
  ["", "/workouts", "Workouts", ClipboardList, "workouts"],
  ["", "/progress", "Body progress", TrendingUp, "progress"],
  ["", "/leads", "Leads & CRM", UserRoundPlus, "leads"],
  ["", "/appointments", "Appointments", CalendarDays, "appointments"],
  ["", "/inventory", "Inventory", Package, "inventory"],
  ["INSIGHTS", "/reports", "Reports", ChartNoAxesCombined, "reports"],
  ["", "/notifications", "Notifications", Bell, "notifications"],
  ["WORKSPACE", "/settings", "Settings", Settings, "settings"],
  ["", "/subscription", "Subscription", Layers, "subscription"],
] as const;
const adminNav = [
  ["PLATFORM", "/admin/dashboard", "Overview", LayoutDashboard, "platform"],
  ["", "/admin/gyms", "Gyms", Building2, "platform"],
  ["", "/admin/owner-payments", "Owner Payments", CreditCard, "platform"],
  ["", "/admin/plans", "Plans & entitlements", Layers, "platform"],
  ["", "/admin/users", "Platform users", Users, "platform"],
  ["", "/admin/access-requests", "Access requests", Users, "platform"],
  ["SYSTEM", "/admin/system-health", "System health", HeartPulse, "platform"],
  ["", "/admin/audit-logs", "Audit logs", ScrollText, "platform"],
] as const;
const memberNav = [
  ["MY GYM", "/member/dashboard", "My dashboard", LayoutDashboard, "self:read"],
  ["", "/member/membership", "My membership", Layers, "self:read"],
  ["", "/member/attendance", "My attendance", ScanLine, "self:read"],
  ["", "/member/workouts", "My workouts", Dumbbell, "self:read"],
  ["", "/member/progress", "My progress", TrendingUp, "self:read"],
  ["", "/member/payments", "My payments", CreditCard, "self:read"],
  ["", "/member/appointments", "My appointments", CalendarDays, "self:read"],
] as const;
function Shell() {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const { user, refresh } = useAuth(),
    [open, setOpen] = useState(false),
    [dark, setDark] = useState(localStorage.getItem("gymos-theme") === "dark");
  const location = useLocation(),
    navigate = useNavigate();
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("gymos-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => setOpen(false), [location.pathname]);
  if (!user)
    return (
      <Navigate
        to={
          location.pathname.startsWith("/admin/")
            ? "/admin/login"
            : location.pathname.startsWith("/member/")
              ? "/member/login"
              : "/login"
        }
        replace
      />
    );
  if ((user.role === "MEMBER") !== location.pathname.startsWith("/member/")) {
    if (user.role === "MEMBER" || location.pathname.startsWith("/member/"))
      return <Navigate to={homeForRole(user.role)} replace />;
  }
  if (
    (user.role === "SUPER_ADMIN") !==
    location.pathname.startsWith("/admin/")
  ) {
    if (user.role === "SUPER_ADMIN" || location.pathname.startsWith("/admin/"))
      return <Navigate to={homeForRole(user.role)} replace />;
  }
  const links = (
    user.role === "SUPER_ADMIN"
      ? adminNav
      : user.role === "MEMBER"
        ? memberNav
        : nav
  ).filter((n) => user.permissions.includes(n[4]));
  const currentNav = [...nav, ...adminNav, ...memberNav].find(
    (n) =>
      location.pathname === n[1] || location.pathname.startsWith(n[1] + "/"),
  );
  const currentFeature =
    user.role === "MEMBER"
      ? location.pathname === "/member/dashboard"
        ? "member_portal"
        : location.pathname.split("/")[2] === "membership"
          ? "member_portal"
          : location.pathname.split("/")[2]
      : currentNav
        ? permissionFeature[currentNav[4]]
        : undefined;
  const blocked =
    (currentNav && !user.permissions.includes(currentNav[4])) ||
    (currentFeature && !user.features.includes(currentFeature));
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link to={homeForRole(user.role)} className="brand-link">
          <Brand />
        </Link>
        <div className="workspace-label">
          <span className="workspace-icon">
            {user.role === "SUPER_ADMIN" ? (
              <ShieldCheck size={18} />
            ) : (
              <Dumbbell size={18} />
            )}
          </span>
          <div>
            <strong>
              {user.role === "SUPER_ADMIN"
                ? "Platform console"
                : user.role === "MEMBER"
                  ? "Member portal"
                  : user.role === "OWNER"
                    ? "Owner workspace"
                    : "Staff workspace"}
            </strong>
            <small>{user.role.replace("_", " ").toLowerCase()}</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <nav>
          {links.map(([section, path, label, Icon, permission]) => (
            <React.Fragment key={path}>
              {section && <div className="nav-section">{section}</div>}
              <NavLink to={path}>
                <Icon size={18} />
                <span>{label}</span>
                {permissionFeature[permission] &&
                  !user.features.includes(permissionFeature[permission]) && (
                    <small aria-label="Locked">Locked</small>
                  )}
              </NavLink>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">
            {user.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role.replace("_", " ").toLowerCase()}</small>
          </div>
          <button
            className="icon-button"
            title={loggingOut ? "Signing out…" : "Sign out"}
            aria-label={loggingOut ? "Signing out…" : "Sign out"}
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              setLogoutError("");
              try {
                await api("/auth/logout", "POST");
                await refresh();
                navigate(portals[portalForRole(user.role)].login, {
                  replace: true,
                });
              } catch (error) {
                setLogoutError(
                  `Could not sign out: ${(error as Error).message} Please try again.`,
                );
              } finally {
                setLoggingOut(false);
              }
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {open && (
        <button
          className="overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {links.find((n) => location.pathname.startsWith(n[1]))?.[2] ??
                "Member profile"}
            </strong>
          </div>
          <div className="top-actions">
            <span className="today">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <button
              className="icon-button"
              aria-label="Switch color theme"
              onClick={() => setDark((v) => !v)}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            {user.permissions.includes("notifications") && (
              <Link
                className="icon-button"
                aria-label="Notifications"
                to="/notifications"
              >
                <Bell size={19} />
              </Link>
            )}
            <div className="avatar small">{user.name[0]}</div>
          </div>
        </header>
        <main>
          {logoutError && (
            <div className="form-error" role="alert">
              {logoutError}
            </div>
          )}
          {blocked ? (
            <PageHeader
              title="Feature unavailable"
              description="Your account does not currently have access. Please contact the Super Admin or your gym owner."
            />
          ) : (
            <Outlet />
          )}
        </main>
        <footer className="page-footer">
          <span>GymOS · A stronger way to run your gym</span>
          <span>Made for your everyday.</span>
        </footer>
      </div>
    </div>
  );
}
function LoginChooser() {
  const { user } = useAuth();
  if (user) return <Navigate to={homeForRole(user.role)} replace />;
  return (
    <div className="portal-selection">
      <Brand />
      <div className="portal-selection-heading">
        <div className="eyebrow">WELCOME TO GYMOS</div>
        <h1>Your space. Your sign-in.</h1>
        <p>Choose how you use GymOS to open the right workspace.</p>
      </div>
      <div className="portal-options">
        {Object.entries(portals).map(([key, portal]) => (
          <Link key={key} to={portal.login} className="portal-option">
            <span className="quick-icon">
              {key === "admin" ? (
                <ShieldCheck />
              ) : key === "owner" ? (
                <Building2 />
              ) : key === "staff" ? (
                <Dumbbell />
              ) : (
                <Users />
              )}
            </span>
            <h2>{portal.title}</h2>
            <p>{portal.description}</p>
            <span className="portal-option-link">
              Sign in <ArrowUpRight size={17} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
function Login() {
  const { user, refresh } = useAuth(),
    location = useLocation(),
    navigate = useNavigate(),
    reset = location.pathname === "/reset-password",
    forgot = location.pathname === "/forgot-password";
  const portal =
    Object.values(portals).find((p) => p.login === location.pathname) ??
    portals.owner;
  const [message, setMessage] = useState("");
  useEffect(() => setMessage(""), [location.pathname]);
  if (user) return <Navigate to={homeForRole(user.role)} replace />;
  return (
    <div className="login">
      <section className="login-story">
        <Brand />
        <div>
          <div className="eyebrow">LESS ADMIN. MORE PROGRESS.</div>
          <h1>
            Your gym.
            <br />
            Running stronger.
          </h1>
          <p>
            Bring your members, memberships and daily operations together. Make
            room for what you do best.
          </p>
          <div className="login-pills">
            <span>Members in sync</span>
            <span>Every visit counted</span>
            <span>Growth in focus</span>
          </div>
        </div>
        <small>THE OPERATING SYSTEM FOR AMBITIOUS GYMS</small>
      </section>
      <section className="login-form">
        <div className="login-box">
          <div className="eyebrow">
            {reset || forgot
              ? "ACCOUNT RECOVERY"
              : `${portal.title.toUpperCase()} SIGN IN`}
          </div>
          <h2>
            {reset
              ? "Set your password"
              : forgot
                ? "Forgot your password?"
                : `Welcome, ${portal.title.toLowerCase()}.`}
          </h2>
          <p>
            {reset
              ? "Choose a password with at least 12 characters."
              : forgot
                ? "We’ll email you a secure recovery link."
                : portal.description}
          </p>
          {message ? (
            <div className="notice">
              {message}
              <Link to="/login">
                Back to sign in <ArrowUpRight size={15} />
              </Link>
            </div>
          ) : (
            <Form
              key={location.pathname}
              fields={
                reset
                  ? [
                      {
                        name: "password",
                        label: "New password",
                        type: "password",
                      },
                    ]
                  : forgot
                    ? [{ name: "email", label: "Email address", type: "email" }]
                    : [
                        {
                          name: "email",
                          label: "Email address",
                          type: "email",
                        },
                        {
                          name: "password",
                          label: "Password",
                          type: "password",
                        },
                      ]
              }
              submit={
                reset
                  ? "Set password"
                  : forgot
                    ? "Send recovery link"
                    : "Sign in to GymOS"
              }
              onSubmit={async (p) => {
                if (reset) {
                  await api("/auth/reset-password", "POST", {
                    ...p,
                    token: location.hash.slice(1),
                  });
                  history.replaceState(null, "", "/reset-password");
                  setMessage("Password saved. You can now sign in.");
                } else if (forgot) {
                  const d = await api("/auth/forgot-password", "POST", p);
                  setMessage(d.message);
                } else {
                  const signedIn = await api(portal.endpoint, "POST", p);
                  await refresh();
                  navigate(homeForRole(signedIn.user.role));
                }
              }}
            />
          )}
          <div className="login-links">
            <Link to="/forgot-password">Forgot password?</Link>
            <Link to="/login">Choose another login</Link>
          </div>
          <div className="login-security">
            <ShieldCheck size={17} /> Secure access. Your gym’s data stays
            yours.
          </div>
        </div>
      </section>
    </div>
  );
}
function Application() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const r = await api("/auth/me");
      setUser(r.user);
      setCsrf(r.user.csrf_token);
    } catch {
      setUser(null);
      setCsrf("");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  if (loading)
    return (
      <div className="boot">
        <Brand />
        <p>Opening your workspace…</p>
      </div>
    );
  return (
    <Auth.Provider value={{ user, refresh }}>
      <Routes>
        <Route path="/login" element={<LoginChooser />} />
        {[
          ...Object.values(portals).map((p) => p.login),
          "/forgot-password",
          "/reset-password",
        ].map((p) => (
          <Route key={p} path={p} element={<Login />} />
        ))}
        <Route element={<Shell />}>
          <Route
            path="/"
            element={<Navigate to={user ? homeForRole(user.role) : "/login"} />}
          />
          {[
            "dashboard",
            "membership",
            "attendance",
            "workouts",
            "progress",
            "payments",
            "appointments",
          ].map((section) => (
            <Route
              key={section}
              path={`/member/${section}`}
              element={<MemberPortal key={section} section={section} />}
            />
          ))}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/staff-activity" element={<StaffActivity />} />
          <Route path="/whatsapp" element={<WhatsAppReminders />} />
          <Route path="/admin/gyms/:id" element={<GymControls />} />
          <Route path="/admin/owner-payments" element={<OwnerPayments />} />
          <Route path="/admin/access-requests" element={<AccessRequests />} />
          <Route path="/members" element={<Members />} />
          <Route path="/members/:id" element={<MemberDetail />} />
          <Route path="/memberships" element={<MembershipPlans />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/invoices" element={<Payments invoices />} />
          <Route path="/attendance" element={<Attendance />} />
          {[
            "trainers",
            "workouts",
            "progress",
            "leads",
            "appointments",
            "inventory",
            "notifications",
          ].map((p) => (
            <Route
              key={p}
              path={`/${p}`}
              element={<OperationalPage kind={p} />}
            />
          ))}
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/subscription" element={<Subscription />} />
          {[
            "dashboard",
            "gyms",
            "plans",
            "users",
            "system-health",
            "audit-logs",
          ].map((p) => (
            <Route
              key={p}
              path={`/admin/${p}`}
              element={<AdminPage kind={p} />}
            />
          ))}
          <Route
            path="*"
            element={
              <PageHeader
                title="Page not found"
                description="Use the navigation to return to your workspace."
              />
            }
          />
        </Route>
      </Routes>
    </Auth.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Application />
  </BrowserRouter>,
);
