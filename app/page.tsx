import DigitaleGewinnerOutboundOS from "./ui/DigitaleGewinnerOutboundOS";
import InboxWidget from "./ui/InboxWidget";
import IntegrationVaultWidget from "./ui/IntegrationVaultWidget";
import LeadFinderWidget from "./ui/LeadFinderWidget";
import CampaignLabWidget from "./ui/CampaignLabWidget";
import WebsiteAuditWidget from "./ui/WebsiteAuditWidget";
import NoShowRescueWidget from "./ui/NoShowRescueWidget";

export default function Page() {
  return (
    <>
      <DigitaleGewinnerOutboundOS />
      <InboxWidget />
      <LeadFinderWidget />
      <CampaignLabWidget />
      <WebsiteAuditWidget />
      <NoShowRescueWidget />
      <IntegrationVaultWidget />
    </>
  );
}
