import CallConsole from "@/app/ui/CallConsole";
import CloudTalkPhone from "@/app/ui/CloudTalkPhone";

export const dynamic = "force-dynamic";

export default function CallPage() {
  return (
    <>
      <CallConsole />
      <CloudTalkPhone />
    </>
  );
}
