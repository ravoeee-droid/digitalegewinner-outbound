import Link from "next/link";
import PVWhatsAppSprint from "@/app/ui/PVWhatsAppSprint";

export const dynamic = "force-dynamic";

export default function WhatsAppPage() {
  return (
    <main style={{ maxWidth: 1100, margin: "25px auto", padding: "0 22px 70px", color: "#e8efe9" }}>
      <Link href="/crm?segment=pv" style={{ color: "#80dfa5", textDecoration: "none" }}>← Zur PV-Trust-Pipeline</Link>
      <PVWhatsAppSprint />
    </main>
  );
}
