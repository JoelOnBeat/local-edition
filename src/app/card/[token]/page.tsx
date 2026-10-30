import type { Metadata } from "next";
import { CardView } from "./_parts/card-view";

export const metadata: Metadata = { title: "Staff card", robots: { index: false, follow: false } };

export default async function StaffCardPage({ params }: PageProps<"/card/[token]">) {
  const { token } = await params;
  return <CardView token={token} />;
}
