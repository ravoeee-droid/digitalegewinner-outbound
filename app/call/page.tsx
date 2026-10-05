import { cookies } from "next/headers";
import RevenueCommandDeck from "@/app/ui/RevenueCommandDeck";
import CallConsole from "@/app/ui/CallConsole";
import CloudTalkPhone from "@/app/ui/CloudTalkPhone";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function CallPage() {
  const store = await cookies();
  const role = sessionRole(store.get(adminCookieName())?.value);
  const isSales = role === "sales";

  return (
    <>
      {!isSales && <RevenueCommandDeck />}
      <CallConsole />
      <CloudTalkPhone />
    </>
  );
}
