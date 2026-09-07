import Link from "next/link";
import OpenOutreachSyncButton from "@/app/ui/OpenOutreachSyncButton";
import OutboundEngineRuntime from "@/app/ui/OutboundEngineRuntime";

export const dynamic = "force-dynamic";

export default function ChannelEnginePage() {
  return (
    <>
      <OpenOutreachSyncButton />
      <Link
        href="/outbound"
        style={{
          position: "fixed",
          right: 18,
          top: 18,
          zIndex: 90,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 15px",
          borderRadius: 999,
          border: "1px solid rgba(213,255,89,.32)",
          background: "rgba(13,18,10,.94)",
          color: "#d5ff59",
          textDecoration: "none",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: ".08em",
          boxShadow: "0 14px 44px rgba(0,0,0,.35)",
        }}
      >
        ← REVENUE OS
      </Link>
      <OutboundEngineRuntime />
    </>
  );
}
