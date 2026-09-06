import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "NST Room Board",
  description: "Classroom and exam allocation for the NST campus.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Fonts are linked rather than pulled in with next/font on purpose.
          next/font downloads the files during `next build`, so a machine
          without access to fonts.googleapis.com cannot build the project
          at all. A plain stylesheet link keeps the build offline-safe, and
          the fallback stack in globals.css means the app still looks right
          if the fonts never arrive.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="font-sans text-[15px] leading-normal">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
