import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Assembly | Assemble Your Campus",
  description:
    "An independent, Avengers-inspired campus ambassador initiative. Discover the program, explore missions and get ready to assemble your campus.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
