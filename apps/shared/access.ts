export const portals = {
  admin: {
    title: "Super Admin",
    description: "Manage the GymOS platform and customer gyms.",
    login: "/admin/login",
    endpoint: "/admin/auth/login",
    roles: ["SUPER_ADMIN"],
  },
  owner: {
    title: "Gym Owner",
    description: "Manage your gym, team, memberships and finances.",
    login: "/owner/login",
    endpoint: "/owner/auth/login",
    roles: ["OWNER"],
  },
  staff: {
    title: "Staff & Trainers",
    description: "Front desk, managers and trainers: open your workday.",
    login: "/staff/login",
    endpoint: "/staff/auth/login",
    roles: ["MANAGER", "RECEPTIONIST", "TRAINER"],
  },
  member: {
    title: "Member",
    description: "Your membership, visits, workouts and progress.",
    login: "/member/login",
    endpoint: "/member/auth/login",
    roles: ["MEMBER"],
  },
} as const;
export type Portal = keyof typeof portals;
export function portalForRole(role: string): Portal {
  if (role === "SUPER_ADMIN") return "admin";
  if (role === "OWNER") return "owner";
  if (role === "MEMBER") return "member";
  return "staff";
}
export function homeForRole(role: string) {
  if (role === "SUPER_ADMIN") return "/admin/dashboard";
  if (role === "MEMBER") return "/member/dashboard";
  if (role === "TRAINER") return "/workouts";
  return "/dashboard";
}
