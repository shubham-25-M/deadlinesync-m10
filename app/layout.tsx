import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeadlineSync — every deadline, in sync",
  description: "One calm space for every college assignment deadline.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
