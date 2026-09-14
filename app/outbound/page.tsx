import OutboundCommandCenter from "@/app/ui/OutboundCommandCenter";
import IntegrationVaultWidget from "@/app/ui/IntegrationVaultWidget";
import MailLauncher from "@/app/ui/MailLauncher";
import "./crm-buildstream-theme.css";

export const dynamic = "force-dynamic";

export default function OutboundPage() {
  return <>
    <OutboundCommandCenter />
    <MailLauncher />
    <IntegrationVaultWidget />
  </>;
}
