import type { Metadata } from "next";
import { SigninView } from "./_parts/signin-view";

export const metadata: Metadata = { title: "Sign in" };

export default function SigninPage() {
  return <SigninView />;
}
