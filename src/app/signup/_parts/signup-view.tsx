"use client";

import Link from "next/link";
import { useMe } from "@/components/account/use-me";
import { useSignupForm } from "@/components/account/use-auth-forms";
import { ErrorLine, Field } from "@/components/account/plain";

/** Plain test screen: email + password sign-up. Free to use: nothing here asks for payment. */
export function SignupView() {
  const { me } = useMe();
  const form = useSignupForm();
  const { values, set } = form;
  return (
    <main style={{ padding: 16, maxWidth: 480 }}>
      <h1>Create your account</h1>
      <p data-testid="signup-free">Local Edition is free to use.</p>
      <form
        data-testid="signup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit();
        }}
      >
        <Field label="Your name">
          <input data-testid="signup-name" autoComplete="name" required value={values.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Email">
          <input data-testid="signup-email" type="email" autoComplete="email" required value={values.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Chain name">
          <input data-testid="signup-chain" required value={values.chainName} onChange={(e) => set("chainName", e.target.value)} />
        </Field>
        <Field label="Password (10 characters or more)">
          <input data-testid="signup-password" type="password" autoComplete="new-password" required minLength={10} value={values.password} onChange={(e) => set("password", e.target.value)} />
        </Field>
        {me?.canKeepWorkspace ? (
          <label data-testid="signup-keep-label">
            <input data-testid="signup-keep" type="checkbox" checked={values.keepWorkspace} onChange={(e) => set("keepWorkspace", e.target.checked)} /> Keep the sample chain I was
            looking at
          </label>
        ) : null}
        <ErrorLine error={form.error} testId="signup-error" />
        <button data-testid="signup-submit" type="submit" disabled={form.busy}>
          {form.busy ? "Creating..." : "Create account"}
        </button>
      </form>
      <p>
        Already have an account? <Link data-testid="signup-to-signin" href="/signin">Sign in</Link>
      </p>
    </main>
  );
}
