import OpenOutreachSyncButton from "@/app/ui/OpenOutreachSyncButton";
import OutboundEngineRuntime from "@/app/ui/OutboundEngineRuntime";

export const dynamic = "force-dynamic";

export default function OutboundPage() {
  return (
    <>
      <OpenOutreachSyncButton />
      <OutboundEngineRuntime />
    </>
  );
}
