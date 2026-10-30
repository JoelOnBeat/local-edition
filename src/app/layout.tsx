import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "@/components/account/session-context";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const DESCRIPTION =
  "A weekly, taste-built edition for every store of a chain: a special, a sound brief, a local partner and an event night, each with its evidence.";

export const metadata: Metadata = {
  metadataBase: new URL("https://localedition.pages.dev"),
  title: { default: "Local Edition", template: "%s · Local Edition" },
  description: DESCRIPTION,
  applicationName: "Local Edition",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Local Edition",
    title: "Local Edition",
    description: DESCRIPTION,
    images: [{ url: "/brand/logo-light-1600.png", alt: "Local Edition" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#F7F7F7",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
