import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/site/legal";
import { CONTACT_EMAIL } from "@/components/site/site-chrome";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Local Edition, a hackathon build.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      intro="Local Edition was built for a hackathon in October 2026. You can use it to try the idea, with the sample chain or your own test accounts. These terms are short because the promise is small."
    >
      <LegalSection title="What this is">
        <p>
          A working demonstration, offered free and as is. It is not a commercial service: there is no pricing, no payment and no
          service level. It may change, slow down or stop without notice.
        </p>
      </LegalSection>

      <LegalSection title="The sample chain">
        <p>
          Kettle &amp; Kiln is a sample chain made up for this demo. Its stores sit at real New York street corners, but it is not a
          real business and none of its partners or events are endorsements. Partner shops in the sample are invented.
        </p>
      </LegalSection>

      <LegalSection title="Your content and connected tools">
        <ul>
          <li>You keep what you bring: your menu, store list, brand voice and anything you edit.</li>
          <li>
            Connect only accounts you are allowed to connect. When you approve a special or a staff card, Local Edition delivers it
            to the tools you connected, in your name: Square, Slack, Gmail, Outlook or the calendar feed.
          </li>
          <li>Disconnect any tool at any time from the connections page.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Editions are suggestions">
        <p>
          Editions are drafted by AI models and checked by guardrails, but they can still be wrong: a partner may have closed, an
          event may have moved. Head office approves every line before it reaches a store, and that approval is yours. Do not rely
          on an edition for anything about health, diet or allergens; it is designed never to say anything about them.
        </p>
      </LegalSection>

      <LegalSection title="Fair use">
        <ul>
          <li>Do not try to break, overload or scrape the app, or use it to send messages to people who did not ask for them.</li>
          <li>Each workspace has a spending limit on model calls and a fixed budget of taste and search lookups. When it is used up, the app says so and stops.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Third-party data">
        <p>
          Taste data comes from Qloo and is used under Qloo&apos;s hackathon terms, inside this app only. It is not for resale or
          export. Models run on Nebius Token Factory, and event listings come from Tavily, each under their own terms.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          To the extent the law allows, the builders of Local Edition are not liable for losses that come from using it. Your
          privacy is covered on <Link href="/privacy">the privacy page</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
