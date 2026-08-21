import PflegeOutboundOS from "./ui/PflegeOutboundOS";
import InboxWidget from "./ui/InboxWidget";
import IntegrationVaultWidget from "./ui/IntegrationVaultWidget";
import PflegeLeadFinderWidget from "./ui/PflegeLeadFinderWidget";
import CampaignLabWidget from "./ui/CampaignLabWidget";
import WebsiteAuditWidget from "./ui/WebsiteAuditWidget";
import NoShowRescueWidget from "./ui/NoShowRescueWidget";
import VideoStudioWidget from "./ui/VideoStudioWidget";
import SalesOSWidget from "./ui/SalesOSWidget";

export default function Page() {
  return (
    <>
      <PflegeOutboundOS />
      <InboxWidget />
      <PflegeLeadFinderWidget />
      <CampaignLabWidget />
      <WebsiteAuditWidget />
      <NoShowRescueWidget />
      <VideoStudioWidget />
      <IntegrationVaultWidget />
      <SalesOSWidget />
    </>
  );
}
