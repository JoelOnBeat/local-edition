"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CODE_LENGTH } from "@/contract";
import { ErrorLine, Field } from "@/components/account/plain";
import { CodeBoxes } from "@/components/account/code-boxes";
import { useSession } from "@/components/account/session-context";
import { useSigninForm } from "@/components/account/use-auth-forms";
import { useCodeSignin } from "@/components/account/use-code-signin";
import { safeNext } from "@/lib/session-paths";

/** The primary way in: email, then the emailed code (sign-in and sign-up are one step). */
function CodeForm({ next, onPassword }: { next: string | null; onPassword: () => void }) {
  const f = useCodeSignin(next);
  return (
    <div data-testid="signin-code-flow" data-step={f.step}>
      {f.step === "email" ? (
        <form data-testid="signin-email-form" onSubmit={(e) => { e.preventDefault(); void f.send(); }}>
          <Field label="Email">
            <input data-testid="signin-email" type="email" autoComplete="email" required value={f.email} onChange={(e) => f.setEmail(e.target.value)} />
          </Field>
          {f.canKeep ? (
            <label>
              <input data-testid="signin-keep" type="checkbox" checked={f.keepWorkspace} onChange={(e) => f.setKeepWorkspace(e.target.checked)} /> Keep the sample chain I was looking at
            </label>
          ) : null}
          <ErrorLine error={f.error} testId="signin-error" />
          <button data-testid="signin-send-code" type="submit" disabled={f.busy}>{f.busy ? "Sending..." : "Email me a code"}</button>
        </form>
      ) : (
        <form data-testid="signin-code-form" onSubmit={(e) => { e.preventDefault(); void f.verify(); }}>
          <p data-testid="signin-sent-to">We sent a {CODE_LENGTH}-digit code to {f.email}.</p>
          <CodeBoxes value={f.code} onChange={f.setCode} onComplete={(c) => void f.verify(c)} disabled={f.busy} />
          <ErrorLine error={f.error} testId="signin-error" />
          <button data-testid="signin-verify" type="submit" disabled={f.busy || f.code.length < CODE_LENGTH}>{f.busy ? "Checking..." : "Sign in"}</button>
          <p>
            <button data-testid="signin-resend" type="button" disabled={f.busy || f.cooldown > 0} onClick={() => void f.resend()}>
              {f.cooldown > 0 ? `Resend code (${f.cooldown})` : "Resend code"}
            </button>{" "}
            <button data-testid="signin-change-email" type="button" onClick={f.changeEmail}>Change email</button>
          </p>
        </form>
      )}
      {f.unavailable ? (
        <p data-testid="signin-code-unavailable">
          Emailed codes are not available right now. <button type="button" data-testid="signin-use-password-fallback" onClick={onPassword}>Use your password</button>
        </p>
      ) : null}
    </div>
  );
}

/** The second way in: email and password (and the only one where no code sender is configured). */
function PasswordForm({ next, onCode }: { next: string | null; onCode: (() => void) | null }) {
  const form = useSigninForm(next);
  const { values, set } = form;
  return (
    <form data-testid="signin-form" onSubmit={(e) => { e.preventDefault(); void form.submit(); }}>
      <Field label="Email">
        <input data-testid="signin-pw-email" type="email" autoComplete="email" required value={values.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field label="Password">
        <input data-testid="signin-password" type="password" autoComplete="current-password" required value={values.password} onChange={(e) => set("password", e.target.value)} />
      </Field>
      <ErrorLine error={form.error} testId="signin-pw-error" />
      <button data-testid="signin-submit" type="submit" disabled={form.busy}>{form.busy ? "Signing in..." : "Sign in with password"}</button>
      {onCode ? <p><button type="button" data-testid="signin-use-code" onClick={onCode}>Email me a code instead</button></p> : null}
    </form>
  );
}

function Screen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const deleted = params.get("deleted") === "1";
  const { me, loading } = useSession();
  const [passwordMode, setPasswordMode] = useState(false);

  // A valid session skips the form: to `next` (only a path under /app), else to /app. A guest still sees the form (this is how a guest signs up).
  useEffect(() => {
    if (me?.session === "user") router.replace(next ?? "/app");
  }, [me?.session, next, router]);

  if (loading || me?.session === "user") return <p data-testid="signin-checking">Checking your session...</p>;
  const codeOn = Boolean(me?.codeSignIn) && !passwordMode;
  return (
    <main style={{ padding: 16, maxWidth: 480 }}>
      <h1>Sign in</h1>
      <p data-testid="signin-free">Local Edition is free to use.</p>
      {deleted ? <p data-testid="signin-deleted">Your account and its data were deleted.</p> : null}
      {codeOn ? <CodeForm next={next} onPassword={() => setPasswordMode(true)} /> : <PasswordForm next={next} onCode={me?.codeSignIn ? () => setPasswordMode(false) : null} />}
      {codeOn ? <p><button type="button" data-testid="signin-use-password" onClick={() => setPasswordMode(true)}>Use a password instead</button></p> : null}
      <p>
        <Link data-testid="signin-to-signup" href="/signup">Create an account with a password</Link>
      </p>
    </main>
  );
}

export function SigninView() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}
