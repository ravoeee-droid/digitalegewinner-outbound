import PflegeUnifiedRuntime from "./ui/PflegeUnifiedRuntime";
import CloudTalkPhone from "./ui/CloudTalkPhone";
import DomainMailCenter from "./ui/DomainMailCenter";
import DomainMailBridge from "./ui/DomainMailBridge";

export default function Page() {
  return (
    <>
      <a className="wcag-skip-link" href="#pflege-sales-os">Zum Hauptinhalt springen</a>
      <a
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
          border: "1px solid rgba(213,255,89,.24)",
          background: "rgba(12,15,20,.9)",
          backdropFilter: "blur(18px)",
          color: "#d5ff59",
          textDecoration: "none",
          fontSize: 12,
          fontWeight: 800,
          boxShadow: "0 14px 50px rgba(0,0,0,.3)",
        }}
      >
        ⚡ Daily Outbound
      </a>
      <div id="pflege-sales-os">
        <PflegeUnifiedRuntime />
      </div>
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}
