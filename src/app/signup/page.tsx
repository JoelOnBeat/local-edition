import type { Metadata } from "next";
import { SignupView } from "./_parts/signup-view";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return <SignupView />;
}
