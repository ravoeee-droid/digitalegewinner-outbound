import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import TerritoryView from "@/app/ui/TerritoryView";

export const dynamic = "force-dynamic";

export default async function LandkreisePage() {
  const jar = await cookies();
  const role = sessionRole(jar.get(adminCookieName())?.value);
  if (!role) redirect("/login");
  return <TerritoryView canEdit={role === "admin"} />;
}
