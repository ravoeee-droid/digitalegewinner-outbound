import OutboundCommandCenter from "@/app/ui/OutboundCommandCenter";
import IntegrationVaultWidget from "@/app/ui/IntegrationVaultWidget";

export const dynamic = "force-dynamic";

export default function OutboundPage() {
  return <>
    <OutboundCommandCenter />
    <IntegrationVaultWidget />
  </>;
}
