import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripSync — Better together",
  description:
    "Plan trips together, without the group chat chaos. A home for your next adventure and the people coming along.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
