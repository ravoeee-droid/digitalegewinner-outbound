import RevenueOutboundOS from "@/app/ui/RevenueOutboundOS";
import WebsitePipelineShortcuts from "@/app/ui/WebsitePipelineShortcuts";
import CloudTalkPhone from "@/app/ui/CloudTalkPhone";
import DomainMailCenter from "@/app/ui/DomainMailCenter";
import DomainMailBridge from "@/app/ui/DomainMailBridge";

export const dynamic = "force-dynamic";

export default function OutboundPage() {
  return (
    <>
      <RevenueOutboundOS />
      <WebsitePipelineShortcuts />
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}