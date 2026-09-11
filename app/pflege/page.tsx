import Link from "next/link";
import PflegeUnifiedRuntime from "../ui/PflegeUnifiedRuntime";
import CloudTalkPhone from "../ui/CloudTalkPhone";
import DomainMailCenter from "../ui/DomainMailCenter";
import DomainMailBridge from "../ui/DomainMailBridge";
import "./build-stream-theme.css";

export const dynamic = "force-dynamic";

export default function PflegePage() {
  return (
    <>
      <a className="wcag-skip-link" href="#pflege-sales-os">Zum Hauptinhalt springen</a>
      <Link
        className="dg-revenue-launcher"
        href="/outbound"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 80,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderRadius: 999,
          border: "1px solid rgba(200,255,99,.24)",
          background: "rgba(7,9,10,.92)",
          backdropFilter: "blur(18px)",
          color: "#c8ff63",
          textDecoration: "none",
          fontSize: 12,
          fontWeight: 900,
          boxShadow: "0 14px 50px rgba(0,0,0,.38)",
        }}
      >
        ⚡ Revenue Outbound OS
      </Link>
      <div id="pflege-sales-os">
        <PflegeUnifiedRuntime />
      </div>
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}
