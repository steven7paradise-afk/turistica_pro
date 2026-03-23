"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import styles from "@/app/turnistica/_components/turnistica-shell.module.css";
import { SessionUser } from "@/app/turnistica/_lib/types";

type Props = {
  user: SessionUser;
  logoutEnabled: boolean;
  children: React.ReactNode;
};

const NAV_ITEMS = [
  { href: "/turnistica", label: "Turnistica", detail: "Oggi e domani" },
  { href: "/turnistica/gestione", label: "Pianificazione", detail: "Calendario turni" },
  { href: "/turnistica/personale", label: "Personale", detail: "Team e nomi" }
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/turnistica") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TurnisticaShell({ user, logoutEnabled, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeItem = useMemo(() => NAV_ITEMS.find((item) => isActive(pathname, item.href)) ?? NAV_ITEMS[0], [pathname]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  async function onLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
    setLoggingOut(false);
  }

  return (
    <div className={`${styles.frame} tp-shell-frame`}>
      <button
        type="button"
        className={styles.mobileMenuButton}
        aria-expanded={mobileMenuOpen}
        aria-controls="turnistica-mobile-sidebar"
        aria-label={mobileMenuOpen ? "Chiudi menu di navigazione" : "Apri menu di navigazione"}
        onClick={() => setMobileMenuOpen((current) => !current)}
      >
        <span className={styles.mobileMenuIcon} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className={styles.mobileMenuText}>
          <strong>{activeItem.label}</strong>
          <small>{activeItem.detail}</small>
        </span>
      </button>

      {mobileMenuOpen ? <button type="button" className={styles.backdrop} aria-label="Chiudi menu" onClick={() => setMobileMenuOpen(false)} /> : null}

      <aside id="turnistica-mobile-sidebar" className={`${styles.sidebar} ${mobileMenuOpen ? styles.sidebarOpen : ""} tp-shell-sidebar`}>
        <div className={styles.brandCard}>
          <div className={styles.brandMark}>Tp</div>
          <div className={styles.brandText}>
            <span className={styles.brandEyebrow}>Paradise Studio</span>
            <h1 className={styles.brandTitle}>Turnistica</h1>
          </div>
        </div>

        <nav className={styles.nav} aria-label="Navigazione turnistica">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href as never}
                aria-current={active ? "page" : undefined}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className={styles.navLabel}>{item.label}</span>
                <span className={styles.navDetail}>{item.detail}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.userCard}>
          <div>
            <span className={styles.userLabel}>{logoutEnabled ? "Sessione attiva" : "Accesso diretto"}</span>
            <strong className={styles.userName}>{user.name}</strong>
            <span className={styles.userRole}>{user.role}</span>
          </div>
          {logoutEnabled ? (
            <button type="button" className={styles.logout} onClick={onLogout} disabled={loggingOut}>
              {loggingOut ? "Uscita..." : "Esci"}
            </button>
          ) : null}
        </div>
      </aside>

      <div className={`${styles.main} tp-shell-main`}>
        <div className={styles.topAura} />
        <div className={`${styles.viewport} tp-shell-viewport`}>{children}</div>
      </div>
    </div>
  );
}
