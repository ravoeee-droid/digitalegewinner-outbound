import WebsiteBuildCockpit from "@/app/ui/WebsiteBuildCockpit";
import CloudTalkPhone from "@/app/ui/CloudTalkPhone";

export const dynamic = "force-dynamic";

export default function WebsitesPage() {
  return (
    <>
      <WebsiteBuildCockpit />
      <CloudTalkPhone />
    </>
  );
}
