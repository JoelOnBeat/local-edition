import type { ReactNode } from "react";
import { Pill } from "@/components/ui";
import { Container, Rule } from "@/components/site/section";

/** Inner-page hero frame for the public proof and limits pages (ByDefault report hero): pill, H1, lede, actions, centred. */
export function PublicHero({ pill, pillIcon, title, lede, actions, meta }: { pill: string; pillIcon: ReactNode; title: ReactNode; lede: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <>
      <Rule />
      <Container className="p-2 sm:p-3">
        <div className="ring-after relative flex flex-col items-center rounded-xl bg-white px-6 pb-14 pt-14 text-center md:px-10 md:pb-16 md:pt-20">
          <Pill icon={pillIcon}>{pill}</Pill>
          <h1 className="mt-8 max-w-[760px] text-[32px] font-medium leading-[35.2px] tracking-[-0.02em] text-ink sm:text-[44px] sm:leading-[48.4px]">{title}</h1>
          <p className="mt-[26px] max-w-[560px] text-[16px] leading-6 text-ink-2 sm:text-[18px] sm:leading-7">{lede}</p>
          {meta ? <p className="mt-3 text-[13px] text-muted">{meta}</p> : null}
          {actions ? <div className="mt-8 flex flex-wrap justify-center gap-2.5">{actions}</div> : null}
        </div>
      </Container>
      <Rule />
    </>
  );
}

/** The body band under the hero: the cards sit on the grey ground between the rails. */
export function PublicBody({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="h-12" aria-hidden />
      <Rule />
      <Container className="px-2 py-6 sm:px-3 md:px-7 md:py-7">{children}</Container>
      <Rule />
      <div className="h-16" aria-hidden />
    </>
  );
}
