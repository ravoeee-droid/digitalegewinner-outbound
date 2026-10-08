import { cookies } from "next/headers";
import HeuteCockpit from "@/app/ui/HeuteCockpit";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function HeutePage() {
  const store = await cookies();
  const role = sessionRole(store.get(adminCookieName())?.value) === "sales" ? "sales" : "admin";
  return <HeuteCockpit role={role} />;
}
