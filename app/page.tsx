import PflegeLaunchOS from "./ui/PflegeLaunchOS";
import CloudTalkPhone from "./ui/CloudTalkPhone";
import StudioNavPortal from "./ui/StudioNavPortal";

export default function Page() {
  return (
    <>
      <a className="wcag-skip-link" href="#outbound-workspace">Zum Hauptinhalt springen</a>
      <div id="outbound-workspace" tabIndex={-1}>
        <PflegeLaunchOS />
      </div>
      <StudioNavPortal />
      <CloudTalkPhone />
    </>
  );
}
