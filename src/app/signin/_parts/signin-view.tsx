"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CODE_LENGTH } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { CodeBoxes } from "@/components/account/code-boxes";
import { useSession } from "@/components/account/session-context";
import { useSigninForm } from "@/components/account/use-auth-forms";
import { useCodeSignin } from "@/components/account/use-code-signin";
import { AuthLayout, TermsLine } from "@/components/site/auth-layout";
import { Button, Checkbox, FormField, Input, NoteBox, Spinner } from "@/components/ui";
import { safeNext } from "@/lib/session-paths";

const quietLink = "text-[14px] font-medium text-ink-2 underline decoration-stone-300 underline-offset-[3px] transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-50";

/** The primary way in: email, then the emailed code (sign-in and sign-up are one step). */
function CodeForm({ next, onPassword, prefill }: { next: string | null; onPassword: () => void; prefill: string }) {
  const f = useCodeSignin(next);
  const { setEmail } = f;
  useEffect(() => { if (prefill) setEmail(prefill); }, [prefill, setEmail]);
  return (
    <div data-testid="signin-code-flow" data-step={f.step}>
      {f.step === "email" ? (
        <form data-testid="signin-email-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void f.send(); }}>
          <FormField label="Work email" htmlFor="signin-email">
            <Input id="signin-email" data-testid="signin-email" type="email" autoComplete="email" required placeholder="you@yourchain.com"
              value={f.email} onChange={(e) => f.setEmail(e.target.value)} aria-invalid={f.error ? true : undefined} />
          </FormField>
          {f.canKeep ? (
            <Checkbox data-testid="signin-keep" checked={f.keepWorkspace} onCheckedChange={f.setKeepWorkspace}>
              Keep the sample chain I was looking at
            </Checkbox>
          ) : null}
          <ErrorLine error={f.error} testId="signin-error" />
          <Button data-testid="signin-send-code" type="submit" variant="primary" size="md" className="mt-1 h-10 w-full" loading={f.busy}>
            Email me a code
          </Button>
        </form>
      ) : (
        <form data-testid="signin-code-form" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void f.verify(); }}>
          <div>
            <p className="text-[16px] font-medium leading-6 text-ink">Check your inbox</p>
            <p data-testid="signin-sent-to" className="mt-1 text-[14px] leading-5 text-ink-2 [overflow-wrap:anywhere]">
              We sent a {CODE_LENGTH}-digit code to <span className="font-medium text-ink">{f.email}</span>.
            </p>
          </div>
          <div className="le-code" data-invalid={f.error ? true : undefined}>
            <CodeBoxes value={f.code} onChange={f.setCode} onComplete={(c) => void f.verify(c)} disabled={f.busy} />
          </div>
          <ErrorLine error={f.error} testId="signin-error" />
          <Button data-testid="signin-verify" type="submit" variant="primary" size="md" className="h-10 w-full" loading={f.busy} disabled={f.code.length < CODE_LENGTH}>
            Sign in
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule-subtle pt-4">
            <button data-testid="signin-resend" type="button" className={quietLink} disabled={f.busy || f.cooldown > 0} onClick={() => void f.resend()}>
              {f.cooldown > 0 ? `Resend code (${f.cooldown})` : "Resend code"}
            </button>
            <button data-testid="signin-change-email" type="button" className={quietLink} onClick={f.changeEmail}>Change email</button>
          </div>
        </form>
      )}
      {f.unavailable ? (
        <NoteBox className="mt-4">
          <p data-testid="signin-code-unavailable" className="text-[14px] leading-5">
            Emailed codes are not available right now.{" "}
            <button type="button" data-testid="signin-use-password-fallback" className={quietLink} onClick={onPassword}>Use your password</button>
          </p>
        </NoteBox>
      ) : null}
    </div>
  );
}

/** The second way in: email and password (and the only one where no code sender is configured). */
function PasswordForm({ next, onCode, prefill }: { next: string | null; onCode: (() => void) | null; prefill: string }) {
  const form = useSigninForm(next);
  const { values, set } = form;
  useEffect(() => { if (prefill) set("email", prefill); }, [prefill, set]);
  return (
    <form data-testid="signin-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void form.submit(); }}>
      <FormField label="Work email" htmlFor="signin-pw-email">
        <Input id="signin-pw-email" data-testid="signin-pw-email" type="email" autoComplete="email" required placeholder="you@yourchain.com"
          value={values.email} onChange={(e) => set("email", e.target.value)} />
      </FormField>
      <FormField label="Password" htmlFor="signin-password">
        <Input id="signin-password" data-testid="signin-password" type="password" autoComplete="current-password" required
          value={values.password} onChange={(e) => set("password", e.target.value)} aria-invalid={form.error ? true : undefined} />
      </FormField>
      <ErrorLine error={form.error} testId="signin-pw-error" />
      <Button data-testid="signin-submit" type="submit" variant="primary" size="md" className="mt-1 h-10 w-full" loading={form.busy}>
        Sign in
      </Button>
      {onCode ? (
        <p className="text-center"><button type="button" data-testid="signin-use-code" className={quietLink} onClick={onCode}>Email me a code instead</button></p>
      ) : null}
    </form>
  );
}

function Screen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const deleted = params.get("deleted") === "1";
  const prefill = (params.get("email") ?? "").slice(0, 254);
  const { me, loading } = useSession();
  const [passwordMode, setPasswordMode] = useState(false);

  // A valid session skips the form: to `next` (only a path under /app), else to /app. A guest still sees the form (this is how a guest signs up).
  useEffect(() => {
    if (me?.session === "user") router.replace(next ?? "/app");
  }, [me?.session, next, router]);

  const checking = loading || me?.session === "user";
  const codeOn = Boolean(me?.codeSignIn) && !passwordMode;
  return (
    <AuthLayout
      title="Sign in to Local Edition"
      lede={<span data-testid="signin-free">Local Edition is free to use.{codeOn && !checking ? " New here? Your first code creates your account." : ""}</span>}
      below={
        <>
          <TermsLine />
          {!checking && codeOn ? (
            <button type="button" data-testid="signin-use-password" className="text-[13px] text-muted underline decoration-stone-300 underline-offset-[3px] hover:text-ink" onClick={() => setPasswordMode(true)}>
              Use a password instead
            </button>
          ) : null}
          <Link data-testid="signin-to-signup" href="/signup" className="text-[13px] text-muted underline decoration-stone-300 underline-offset-[3px] hover:text-ink">
            Create an account with a password
          </Link>
        </>
      }
    >
      {deleted ? (
        <NoteBox className="mb-5"><p data-testid="signin-deleted" className="text-[14px] leading-5">Your account and its data were deleted.</p></NoteBox>
      ) : null}
      {checking ? (
        <p data-testid="signin-checking" className="flex items-center justify-center gap-2 py-10 text-[14px] text-muted">
          <Spinner /> Checking your session...
        </p>
      ) : codeOn ? (
        <CodeForm next={next} prefill={prefill} onPassword={() => setPasswordMode(true)} />
      ) : (
        <PasswordForm next={next} prefill={prefill} onCode={me?.codeSignIn ? () => setPasswordMode(false) : null} />
      )}
    </AuthLayout>
  );
}

export function SigninView() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}
