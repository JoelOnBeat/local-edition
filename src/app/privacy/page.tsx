import type { Metadata } from "next";
import { CONTACT_EMAIL } from "@/components/site/site-chrome";
import { LegalPage, LegalSection } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Local Edition stores, which providers it uses, and how to have your data deleted.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      intro="Local Edition is a hackathon build. It stores as little as it needs to write a weekly edition for each store, and it never sends anything about your customers to anyone."
    >
      <LegalSection title="What we store">
        <p>
          If you create an account we keep your name, your email address and a salted hash of your password (never the password
          itself); sign-in codes are stored only as hashes and expire after ten minutes. Each account, and each visitor who opens the
          sample chain, gets a private workspace identified by a session cookie. In it we keep:
        </p>
        <ul>
          <li>The chain&apos;s name, brand voice lines and up to three brands it resembles.</li>
          <li>Store names, street corners and coordinates.</li>
          <li>Menu items: names, categories, prices and descriptions.</li>
          <li>The editions we write, the evidence behind them, and who approved, edited or rejected each line.</li>
          <li>A log of what moved between Local Edition and your connected tools: which store, when, and whether it worked.</li>
          <li>Menu photos you upload, if you use the photo route instead of Square.</li>
        </ul>
        <p>
          We do not collect customer names, emails, orders or payment details. We do not use advertising or analytics trackers.
        </p>
      </LegalSection>

      <LegalSection title="Where it is kept">
        <p>
          Everything is stored on <strong>Cloudflare</strong> (D1 for records, KV for cached provider answers, R2 for menu photos),
          and the app runs on Cloudflare Workers.
        </p>
      </LegalSection>

      <LegalSection title="Connected tools">
        <p>
          When you connect Square, Slack, Gmail or Outlook, its access token is stored encrypted, for that workspace only, and is
          never shown in the app. We use it only for the actions listed on the connections page: reading the menu and locations,
          adding an approved special, posting a staff card, sending card emails and reading the replies. Google and Microsoft
          connections are made through <strong>Composio</strong>. Disconnecting a tool removes its token from Local Edition.
        </p>
      </LegalSection>

      <LegalSection title="Providers we send data to">
        <ul>
          <li>
            <strong>Qloo</strong> receives store coordinates and taste identifiers (brands, tags). Never a person&apos;s data.
          </li>
          <li>
            <strong>Nebius Token Factory</strong> runs the NVIDIA Nemotron models. It receives menu items, brand voice, taste results
            and menu photos to draft and check each edition.
          </li>
          <li>
            <strong>Tavily</strong> receives search queries such as a neighbourhood and a week, and the address of the chain&apos;s own
            website when you ask it to read your brand voice.
          </li>
          <li>
            <strong>Square, Slack, Google and Microsoft</strong> receive what you ask us to deliver to them: the approved special, the
            staff card, the card email.
          </li>
          <li>
            <strong>Google (Gmail)</strong> delivers sign-in codes, so it receives your email address and the code.
          </li>
          <li>
            <strong>Composio</strong> carries the Google and Microsoft requests (mail and calendar).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Qloo data">
        <p>
          Taste data from Qloo is used under Qloo&apos;s hackathon terms, only to write editions inside the workspace that asked for
          them. We cache it to avoid repeat calls. We do not resell it or offer it outside the app.
        </p>
      </LegalSection>

      <LegalSection title="Deletion">
        <p>
          You can disconnect any tool at any time from the connections page, and delete your account and its workspace yourself
          from the account menu inside the app. To have anything else deleted, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address you connected, or tell us the workspace&apos;s
          chain name. We delete it within seven days and confirm by reply. Visitor workspaces also expire on
          their own and are deleted with everything in them.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this page: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
