import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareSkeleton, CompareView } from "@/components/compare/compare-view";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return (
    <Suspense fallback={<CompareSkeleton />}>
      <CompareView />
    </Suspense>
  );
}
