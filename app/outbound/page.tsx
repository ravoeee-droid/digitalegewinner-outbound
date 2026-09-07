import RevenueOutboundOS from "@/app/ui/RevenueOutboundOS";
import CloudTalkPhone from "@/app/ui/CloudTalkPhone";
import DomainMailCenter from "@/app/ui/DomainMailCenter";
import DomainMailBridge from "@/app/ui/DomainMailBridge";

export const dynamic = "force-dynamic";

export default function OutboundPage() {
  return (
    <>
      <RevenueOutboundOS />
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}
