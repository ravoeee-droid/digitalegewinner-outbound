import PflegeCloserRuntime from "./ui/PflegeCloserRuntime";
import CloudTalkPhone from "./ui/CloudTalkPhone";
import DomainMailCenter from "./ui/DomainMailCenter";
import DomainMailBridge from "./ui/DomainMailBridge";

export default function Page() {
  return (
    <>
      <a className="wcag-skip-link" href="#pflege-closing-os">Zum Hauptinhalt springen</a>
      <div id="pflege-closing-os">
        <PflegeCloserRuntime />
      </div>
      <CloudTalkPhone />
      <DomainMailCenter />
      <DomainMailBridge />
    </>
  );
}
