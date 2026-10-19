import PflegeUnifiedRuntime from "../ui/PflegeUnifiedRuntime";
import CloudTalkPhone from "../ui/CloudTalkPhone";
import DomainMailCenter from "../ui/DomainMailCenter";
import DomainMailBridge from "../ui/DomainMailBridge";
import "./build-stream-theme.css";
import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function PflegePage() {
  const jar=await cookies();
  const isSales=sessionRole(jar.get(adminCookieName())?.value)==="sales";
  return (
    <>
      <a className="wcag-skip-link" href="#pflege-sales-os">Zum Hauptinhalt springen</a>
      <div id="pflege-sales-os">
        <PflegeUnifiedRuntime />
      </div>
      <CloudTalkPhone />
      {!isSales && <DomainMailCenter />}
      {!isSales && <DomainMailBridge />}
    </>
  );
}
