import PflegeSalesOS from "./ui/PflegeSalesOS";
import CloudTalkPhone from "./ui/CloudTalkPhone";
import DomainMailCenter from "./ui/DomainMailCenter";
import DomainMailBridge from "./ui/DomainMailBridge";

export default function Page() {
  return (
    <>
      <a className="wcag-skip-link" href="#main-sales-os">Zum Hauptinhalt springen</a>
      <PflegeSalesOS />
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}
