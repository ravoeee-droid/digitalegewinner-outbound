import type { Metadata } from "next";
import { Suspense } from "react";
import SeoRadarWorkspace from "../ui/SeoRadarWorkspace";

export const metadata: Metadata = {
  title: "SEO Radar · Digitale Gewinner",
  description: "Keyword-, Website-, Search- und Kundenreport-Intelligence im Digitale Gewinner Sales OS.",
};

export default function SeoRadarPage() {
  return <Suspense fallback={null}><SeoRadarWorkspace /></Suspense>;
}
