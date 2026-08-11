import EnergyRadarLive from "./ui/EnergyRadarLive";
import InboxWidget from "./ui/InboxWidget";
import IntegrationVaultWidget from "./ui/IntegrationVaultWidget";
import LeadFinderWidget from "./ui/LeadFinderWidget";
import CampaignLabWidget from "./ui/CampaignLabWidget";
import WebsiteAuditWidget from "./ui/WebsiteAuditWidget";
import NoShowRescueWidget from "./ui/NoShowRescueWidget";

export default function Page() {
  return (
    <>
      <EnergyRadarLive />
      <InboxWidget />
      <LeadFinderWidget />
      <CampaignLabWidget />
      <WebsiteAuditWidget />
      <NoShowRescueWidget />
      <IntegrationVaultWidget />
    </>
  );
}
