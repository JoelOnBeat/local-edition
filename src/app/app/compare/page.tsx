import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareView } from "@/components/compare/compare-view";
import { SkeletonText } from "@/components/ui";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return (
    <Suspense fallback={<SkeletonText lines={8} />}>
      <CompareView />
    </Suspense>
  );
}
