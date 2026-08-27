import type { Metadata } from "next";
import SeoRadarWorkspace from "../ui/SeoRadarWorkspace";

export const metadata: Metadata = {
  title: "SEO Radar · Digitale Gewinner",
  description: "Keyword-, Website-, Search- und Kundenreport-Intelligence im Digitale Gewinner Sales OS.",
};

export default function SeoRadarPage() {
  return <SeoRadarWorkspace />;
}
