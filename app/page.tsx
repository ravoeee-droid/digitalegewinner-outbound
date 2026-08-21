import PflegeProOS from "./ui/PflegeProOS";
import CloudTalkPhone from "./ui/CloudTalkPhone";
import DomainMailCenter from "./ui/DomainMailCenter";
import DomainMailBridge from "./ui/DomainMailBridge";

export default function Page() {
  return (
    <>
      <a className="wcag-skip-link" href="#main-sales-os">Zum Hauptinhalt springen</a>
      <PflegeProOS />
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}
