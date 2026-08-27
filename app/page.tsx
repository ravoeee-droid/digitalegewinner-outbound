import PflegeUnifiedRuntime from "./ui/PflegeUnifiedRuntime";
import CloudTalkPhone from "./ui/CloudTalkPhone";
import DomainMailCenter from "./ui/DomainMailCenter";
import DomainMailBridge from "./ui/DomainMailBridge";

export default function Page() {
  return (
    <>
      <a className="wcag-skip-link" href="#pflege-sales-os">Zum Hauptinhalt springen</a>
      <div id="pflege-sales-os">
        <PflegeUnifiedRuntime />
      </div>
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}
