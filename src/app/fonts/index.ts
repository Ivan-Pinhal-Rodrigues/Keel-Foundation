import localFont from "next/font/local";

/*
 * Self-hosted fonts — no runtime request to fonts.googleapis.com / fonts.gstatic.com.
 * The prototype loads Archivo, IBM Plex Sans and IBM Plex Mono from Google Fonts;
 * the .woff2 files here were copied from the @fontsource packages (v5.3.0) into
 * ./files/. Weights match the ones the prototype actually uses.
 *
 * `variable` names match the CSS custom properties the ported base CSS expects
 * (src/styles/tokens.css intentionally omits --sans / --display / --mono):
 *   --sans     IBM Plex Sans   400 500 600 700
 *   --display  Archivo         500 600 700 800
 *   --mono     IBM Plex Mono   400 500 600
 */

export const sans = localFont({
  variable: "--sans",
  display: "swap",
  fallback: [
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica",
    "Arial",
    "sans-serif",
  ],
  src: [
    { path: "./files/ibm-plex-sans-latin-400-normal.woff2", weight: "400" },
    { path: "./files/ibm-plex-sans-latin-500-normal.woff2", weight: "500" },
    { path: "./files/ibm-plex-sans-latin-600-normal.woff2", weight: "600" },
    { path: "./files/ibm-plex-sans-latin-700-normal.woff2", weight: "700" },
  ],
});

export const display = localFont({
  variable: "--display",
  display: "swap",
  fallback: [
    "IBM Plex Sans",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "sans-serif",
  ],
  src: [
    { path: "./files/archivo-latin-500-normal.woff2", weight: "500" },
    { path: "./files/archivo-latin-600-normal.woff2", weight: "600" },
    { path: "./files/archivo-latin-700-normal.woff2", weight: "700" },
    { path: "./files/archivo-latin-800-normal.woff2", weight: "800" },
  ],
});

export const mono = localFont({
  variable: "--mono",
  display: "swap",
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Consolas",
    "monospace",
  ],
  src: [
    { path: "./files/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./files/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
    { path: "./files/ibm-plex-mono-latin-600-normal.woff2", weight: "600" },
  ],
});
