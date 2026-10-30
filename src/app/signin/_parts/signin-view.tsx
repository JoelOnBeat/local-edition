"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSigninForm } from "@/components/account/use-auth-forms";
import { ErrorLine, Field } from "@/components/account/plain";

function Form() {
  const form = useSigninForm();
  const deleted = useSearchParams().get("deleted") === "1";
  const { values, set } = form;
  return (
    <main style={{ padding: 16, maxWidth: 480 }}>
      <h1>Sign in</h1>
      {deleted ? <p data-testid="signin-deleted">Your account and its data were deleted.</p> : null}
      <form
        data-testid="signin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit();
        }}
      >
        <Field label="Email">
          <input data-testid="signin-email" type="email" autoComplete="email" required value={values.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Password">
          <input data-testid="signin-password" type="password" autoComplete="current-password" required value={values.password} onChange={(e) => set("password", e.target.value)} />
        </Field>
        <ErrorLine error={form.error} testId="signin-error" />
        <button data-testid="signin-submit" type="submit" disabled={form.busy}>
          {form.busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p>
        New here? <Link data-testid="signin-to-signup" href="/signup">Create an account</Link> or <Link data-testid="signin-try-sample" href="/app">try the sample chain</Link>.
      </p>
    </main>
  );
}

export function SigninView() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}
