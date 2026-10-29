import CRMWorkspace from "@/app/ui/CRMWorkspace";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ segment?: string; lead?: string }> };

export default async function CRMPage({ searchParams }: Props) {
  const { segment, lead } = await searchParams;
  const initialSegment = segment === "pv" || segment === "other" ? segment : "pflege";
  return <CRMWorkspace key={`${initialSegment}:${lead || ""}`} initialSegment={initialSegment} initialLeadId={lead || null} />;
}
