import EnergyRadarLive from "./ui/EnergyRadarLive";
import InboxWidget from "./ui/InboxWidget";
import IntegrationVaultWidget from "./ui/IntegrationVaultWidget";
import LeadFinderWidget from "./ui/LeadFinderWidget";

export default function Page() {
  return (
    <>
      <EnergyRadarLive />
      <InboxWidget />
      <LeadFinderWidget />
      <IntegrationVaultWidget />
    </>
  );
}
