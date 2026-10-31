"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { navigationGroups } from "../lib/workspace/routes";
import { FutureFeatures } from "./future-features";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }

  return (
    <>
      <a href="#main-content" className="skip-link" onClick={() => setMenuOpen(false)}>Skip to main content</a>
      <header className="workspace-header">
        <Link href="/" className="brand" aria-label="AIVRA home" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>AIVRA<span className="brand-caption">M&A technology workspace</span></span>
        </Link>
        <div className="header-context"><span className="preview-label">Public Preview</span><span className="header-disclosure">Synthetic M&A demo</span></div>
        <button ref={menuButton} className="menu-toggle button button-secondary" type="button" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)} onKeyDown={(event) => { if (event.key === "Escape" && menuOpen) { event.preventDefault(); closeMenu(); } }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={menuOpen ? "m6 6 12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"} /></svg>
          {menuOpen ? "Close menu" : "Open menu"}
        </button>
      </header>
      <div className="workspace-frame">
        <aside id="workspace-navigation" className="workspace-sidebar" data-open={menuOpen} onKeyDown={(event) => { if (event.key === "Escape" && menuOpen) { event.preventDefault(); closeMenu(); } }}>
          <nav aria-label="Main navigation">
            {navigationGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-group-label">{group.label}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="nav-link" aria-current={pathname === item.href ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                        <span className="nav-marker" aria-hidden="true" />{item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <FutureFeatures />
          <div className="sidebar-note"><span className="sidebar-note-title">A workspace taking shape</span><p>Explore the structure. Module tools are not yet implemented.</p></div>
        </aside>
        <div className="workspace-body">
          <main id="main-content" tabIndex={-1}>{children}</main>
          <footer className="workspace-footer">Public preview • Synthetic example data • AI-generated analysis is illustrative, not transaction advice.</footer>
        </div>
      </div>
    </>
  );
}
