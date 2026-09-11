import OutboundCommandCenter from "@/app/ui/OutboundCommandCenter";
import IntegrationVaultWidget from "@/app/ui/IntegrationVaultWidget";
import "./crm-buildstream-theme.css";

export const dynamic = "force-dynamic";

export default function OutboundPage() {
  return <>
    <OutboundCommandCenter />
    <IntegrationVaultWidget />
  </>;
}
