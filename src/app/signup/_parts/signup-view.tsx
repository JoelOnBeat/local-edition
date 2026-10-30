"use client";

import Link from "next/link";
import { useMe } from "@/components/account/use-me";
import { useSignupForm } from "@/components/account/use-auth-forms";
import { ErrorLine } from "@/components/account/plain";
import { AuthLayout, TermsLine } from "@/components/site/auth-layout";
import { Button, Checkbox, FormField, Input } from "@/components/ui";

/** Email + password sign-up. Free to use: nothing here asks for payment. */
export function SignupView() {
  const { me } = useMe();
  const form = useSignupForm();
  const { values, set } = form;
  return (
    <AuthLayout
      title="Create your account"
      lede={<span data-testid="signup-free">Local Edition is free to use. Set up your chain in a few minutes.</span>}
      below={
        <>
          <TermsLine />
          <p className="text-[14px]">
            Already have an account?{" "}
            <Link data-testid="signup-to-signin" href="/signin" className="font-medium text-ink-2 underline decoration-stone-300 underline-offset-[3px] hover:text-ink">Sign in</Link>
          </p>
        </>
      }
    >
      <form
        data-testid="signup-form"
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit();
        }}
      >
        <FormField label="Your name" htmlFor="signup-name">
          <Input id="signup-name" data-testid="signup-name" autoComplete="name" required placeholder="Maya Okafor" value={values.name} onChange={(e) => set("name", e.target.value)} />
        </FormField>
        <FormField label="Work email" htmlFor="signup-email">
          <Input id="signup-email" data-testid="signup-email" type="email" autoComplete="email" required placeholder="you@yourchain.com" value={values.email} onChange={(e) => set("email", e.target.value)} />
        </FormField>
        <FormField label="Chain name" htmlFor="signup-chain">
          <Input id="signup-chain" data-testid="signup-chain" required placeholder="Birch Coffee" value={values.chainName} onChange={(e) => set("chainName", e.target.value)} />
        </FormField>
        <FormField label="Password" htmlFor="signup-password" help="10 characters or more.">
          <Input id="signup-password" data-testid="signup-password" type="password" autoComplete="new-password" required minLength={10} value={values.password} onChange={(e) => set("password", e.target.value)} />
        </FormField>
        {me?.canKeepWorkspace ? (
          <span data-testid="signup-keep-label">
            <Checkbox data-testid="signup-keep" checked={values.keepWorkspace} onCheckedChange={(v) => set("keepWorkspace", v)}>
              Keep the sample chain I was looking at
            </Checkbox>
          </span>
        ) : null}
        <ErrorLine error={form.error} testId="signup-error" />
        <Button data-testid="signup-submit" type="submit" variant="primary" size="sm" className="mt-1 h-10 w-full gap-2 px-6" loading={form.busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
