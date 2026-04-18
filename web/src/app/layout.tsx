import type { Metadata, Viewport } from "next";
import "./globals.css";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  API_BASE_URL,
} from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: "%s｜Residence Risk TW",
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: "Residence Risk TW",
  authors: [{ name: "Residence Risk TW contributors" }],
  generator: "Next.js",
  referrer: "strict-origin-when-cross-origin",
  creator: "Residence Risk TW contributors",
  category: "Public Safety",
  alternates: {
    canonical: "/",
    languages: { "zh-Hant-TW": "/" },
  },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Residence Risk TW — 台灣住址風險評估",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/favicon.ico" }],
  },
  other: {
    "ai-content-declaration": "human-authored-open-source",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

function getApiOrigin(): string | null {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return null;
  }
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const apiOrigin = getApiOrigin();

  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://tile.openstreetmap.org" />
        {apiOrigin && <link rel="preconnect" href={apiOrigin} />}
        <link rel="alternate" type="application/json" href="/openapi.json" />
        <link
          rel="alternate"
          type="text/plain"
          title="LLM-friendly index"
          href="/llms.txt"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-gray-100 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
