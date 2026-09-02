import type { Metadata } from "next";
import type { ReactNode } from "react";
import { sans, display, mono } from "@/app/fonts";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Keel",
  description: "ITSM platform",
};

// Set data-theme from the keel-theme cookie before first paint so an explicit
// light/dark choice doesn't flash the other theme. No cookie → attribute stays
// unset and `@media (prefers-color-scheme)` decides. Kept to a tiny IIFE.
const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)keel-theme=(light|dark)/);if(m){document.documentElement.dataset.theme=m[1];}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    // themeScript sets documentElement.dataset.theme before hydration; without
    // this, React logs a mismatch on every load when a keel-theme cookie is set.
    // Scoped to the <html> element's own attributes only (one level deep).
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} ${display.variable} ${mono.variable}`}>
        {children}
      </body>
    </html>
  );
}
