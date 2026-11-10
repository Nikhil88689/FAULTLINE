"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, Command, Menu, Radio, X } from "lucide-react";
import { navigationItems } from "@/config/navigation";
import { PageTransition } from "@/components/shell/page-transition";
import { motionDuration, motionEase } from "@/animations/tokens";

export function SiteShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const activePage = navigationItems.find((item) => item.href === pathname);
  const immersivePage = pathname === "/" || pathname === "/observatory";

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  return (
    <PageTransition pathname={pathname}>
      {immersivePage ? (
        children
      ) : (
        <div className="platform-shell">
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>

          <aside
            className={"sidebar " + (menuOpen ? "sidebar-open" : "")}
            aria-label="Primary navigation"
          >
            <div className="brand">
              <Link href="/" className="brand-home" onClick={() => setMenuOpen(false)}>
                <span className="brand-glyph">
                  <Activity size={19} strokeWidth={1.8} />
                </span>
                <span className="brand-wordmark">
                  <strong>FAULTLINE</strong>
                  <small>LIVING SYSTEMS OBSERVATORY</small>
                </span>
              </Link>
              <button
                className="mobile-close icon-button"
                type="button"
                aria-label="Close navigation"
                data-tooltip="Close navigation"
                onClick={() => setMenuOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="environment-card">
              <span className="environment-mark">
                <Radio size={14} />
              </span>
              <span className="environment-copy">
                <strong>Demo environment</strong>
                <small>Fixture telemetry</small>
              </span>
              <span className="environment-menu">
                <Command size={13} />
              </span>
            </div>

            <div className="nav-label">WORKSPACE</div>
            <nav className="primary-nav">
              {navigationItems.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={"nav-item " + (active ? "active" : "")}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon size={17} strokeWidth={1.7} />
                    <span>{label}</span>
                    {active && (
                      <motion.span
                        className="nav-active-mark"
                        layoutId="faultline-active-navigation"
                        transition={{
                          duration: reducedMotion ? 0 : motionDuration.control,
                          ease: motionEase.standard,
                        }}
                      />
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="sidebar-spacer" />

            <div className="sidebar-status degraded">
              <div className="status-heading">
                <span className="status-led" /> ONE DEGRADED SIGNAL
              </div>
              <p>Ledger latency is above its sample objective.</p>
              <div className="status-foot">
                <span>DEMO STREAM</span>
                <span>v0.1.0</span>
              </div>
            </div>

            <a className="sidebar-link" href="https://vercel.com" target="_blank" rel="noreferrer">
              <span>Deployment architecture</span>
              <ArrowUpRight size={14} />
            </a>
            <div className="sidebar-profile">
              <span className="profile-avatar">FL</span>
              <span className="profile-copy">
                <strong>Platform team</strong>
                <small>Observability workspace</small>
              </span>
              <span className="profile-led" />
            </div>
          </aside>

          <AnimatePresence initial={false}>
            {menuOpen && (
              <motion.button
                key="navigation-scrim"
                className="sidebar-scrim"
                aria-label="Close navigation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reducedMotion ? 0 : motionDuration.panel,
                  ease: motionEase.standard,
                }}
                onClick={() => setMenuOpen(false)}
              />
            )}
          </AnimatePresence>

          <div className="main-column">
            <header className="topbar">
              <div className="breadcrumb">
                <button
                  className="mobile-menu icon-button"
                  type="button"
                  aria-label="Open navigation"
                  data-tooltip="Open navigation"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                >
                  <Menu size={19} />
                </button>
                <span className="breadcrumb-root">FAULTLINE</span>
                <span className="breadcrumb-divider">/</span>
                <span className="breadcrumb-current">{activePage?.label ?? "Overview"}</span>
              </div>
              <div className="topbar-actions">
                <span className="stream-indicator">
                  <span className="stream-led" />
                  DEMO TELEMETRY
                </span>
                <span className="topbar-separator" />
                <button className="command-button" type="button" aria-label="Keyboard shortcuts">
                  <Command size={14} />
                  <span>K</span>
                </button>
              </div>
            </header>

            <div id="main-content" className="main-content" tabIndex={-1}>
              {children}
            </div>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
