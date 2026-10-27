import CRMWorkspace from "@/app/ui/CRMWorkspace";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ segment?: string }> };

export default async function CRMPage({ searchParams }: Props) {
  const { segment } = await searchParams;
  const initialSegment = segment === "pv" || segment === "other" ? segment : "pflege";
  return <CRMWorkspace key={initialSegment} initialSegment={initialSegment} />;
}
