import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WorkspaceShell } from "../components/workspace-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIVRA Public Preview",
  description: "Explore the AIVRA public preview workspace with fictional M&A example data. Module tools are not yet implemented.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><WorkspaceShell>{children}</WorkspaceShell></body>
    </html>
  );
}
