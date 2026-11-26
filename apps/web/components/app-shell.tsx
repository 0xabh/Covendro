"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import { apiBase, apiFetch, pilotMode } from "../lib/api";
import { createAgent } from "@ui-sdk/react/agent";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const covendroAgent = createAgent();

const navigation = [
  { label: "Overview", href: "/", section: "Workspace", shortcut: "G O" },
  {
    label: "Invoices",
    href: "/invoices",
    section: "Operations",
    shortcut: "G I",
  },
  {
    label: "Payments",
    href: "/payments",
    section: "Operations",
    shortcut: "G P",
  },
  {
    label: "Vendors",
    href: "/vendors",
    section: "Operations",
    shortcut: "G V",
  },
  {
    label: "Treasury policy",
    href: "/treasury-policy",
    section: "Controls",
    shortcut: "G T",
  },
  { label: "Ledger", href: "/ledger", section: "Evidence", shortcut: "G L" },
  {
    label: "Audit history",
    href: "/audit",
    section: "Evidence",
    shortcut: "G A",
  },
];

const WorkspaceRole = createContext<string | null>(null);

export function useWorkspaceRole() {
  return useContext(WorkspaceRole);
}

async function readWorkspaceRole() {
  const response = await apiFetch(`${apiBase}/api/session`);
  if (!response.ok) return null;
  const data = (await response.json()).data;
  return typeof data?.role === "string" ? data.role : null;
}

function WorkspaceAccess({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "signed-out" | "signed-in">("loading");
  const [role, setRole] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    readWorkspaceRole()
      .then((role) => { setRole(role); setState(role ? "signed-in" : "signed-out"); })
      .catch(() => setState("signed-out"));
  }, []);

  if (state === "loading") return <main className="page-shell">Checking workspace session…</main>;
  if (state === "signed-in") return <WorkspaceRole.Provider value={role}>{children}</WorkspaceRole.Provider>;

  return <main className="page-shell narrow-page">
    <form className="panel" onSubmit={async (event) => {
      event.preventDefault();
      setWorking(true);
      setError("");
      try {
        const response = await apiFetch(`${apiBase}/api/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invite: invite.trim() }),
        });
        if (!response.ok) throw new Error("Sign-in failed. Check your invite or request a new one.");
        const role = await readWorkspaceRole();
        if (!role) throw new Error("Sign-in completed but the workspace session could not be loaded.");
        setInvite("");
        setRole(role);
        setState("signed-in");
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Sign-in failed");
      } finally {
        setWorking(false);
      }
    }}>
      <h1>Sign in to Covendro</h1>
      <label>Workspace invite<input type="password" value={invite} onChange={(event) => setInvite(event.target.value)} required autoComplete="off" /></label>
      <button disabled={working}>Sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </main>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return pilotMode ? <WorkspaceAccess><WorkspaceShell>{children}</WorkspaceShell></WorkspaceAccess> : <WorkspaceShell>{children}</WorkspaceShell>;
}

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = useState(false);
  const currentPage = useMemo(
    () =>
      navigation.find((item) => item.href === pathname) ??
      navigation.find((item) => pathname.startsWith(item.href + "/")),
    [pathname],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-frame">
      <aside className="app-sidebar" aria-label="Covendro workspace navigation">
        <a className="app-brand" href="/" aria-label="Covendro overview">
          <span className="brand-glyph">C</span>
          <span>
            <strong>Covendro</strong>
            <small>Private treasury OS</small>
          </span>
        </a>

        <div className="workspace-switcher" aria-label="Current workspace">
          <span className="workspace-avatar">TC</span>
          <span>
            <strong>Treasury control</strong>
            <small>{pilotMode ? "Pilot workspace" : "Demo workspace"}</small>
          </span>
          <span className="workspace-chevron">⌄</span>
        </div>

        {pilotMode && <button type="button" onClick={async () => {
          const response = await apiFetch(`${apiBase}/api/session`, { method: "DELETE" });
          if (response.ok || response.status === 401) window.location.reload();
        }}>Sign out</button>}

        <nav className="shell-nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <a
                className={active ? "shell-nav-item active" : "shell-nav-item"}
                href={item.href}
                key={item.href}
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.label === "Overview"
                    ? "◈"
                    : item.label === "Invoices"
                      ? "▤"
                      : item.label === "Payments"
                        ? "↗"
                        : item.label === "Vendors"
                          ? "◎"
                          : item.label === "Treasury policy"
                            ? "⌘"
                            : item.label === "Ledger"
                              ? "▥"
                              : "≡"}
                </span>
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="sidebar-lower">
          <div className="rail-status">
            <span className="status-dot" />
            <span>
              <strong>Safe mode</strong>
              <small>Mock rails enabled</small>
            </span>
          </div>
          <div className="user-row">
            <span className="user-avatar">TA</span>
            <span>
              <strong>Treasury Admin</strong>
              <small>Administrator</small>
            </span>
            <span className="more-icon">•••</span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="shell-header">
          <div className="breadcrumbs">
            <span>Covendro</span>
            <span>/</span>
            <strong>{currentPage?.label ?? "Workspace"}</strong>
          </div>
          <div className="shell-actions">
            <Button
              className="command-trigger"
              aria-label="Open command menu"
              onClick={() => setCommandOpen(true)}
            >
              <span className="search-symbol">⌕</span>
              <span>Search workspace</span>
              <kbd>⌘ K</kbd>
            </Button>
            <a
              className="header-icon-button"
              href="/audit"
              aria-label="Open audit history"
            >
              ◌
            </a>
            <span className="header-role">Demo</span>
          </div>
        </header>
        <div className="app-content">{children}</div>
      </div>

      {commandOpen && (
        <div
          className="command-overlay"
          role="presentation"
          onMouseDown={() => setCommandOpen(false)}
        >
          <div
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search workspace"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Command
              items={navigation.map((item) => item.label)}
              autoHighlight
              onAction={(value) => {
                const item = navigation.find((entry) => entry.label === value);
                if (item) window.location.href = item.href;
              }}
            >
              <CommandInput
                aria-label="Search navigation"
                placeholder="Jump to a workspace page…"
              />
              <CommandList>
                {navigation.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={item.label}
                    label={item.label}
                    keywords={[item.section]}
                  >
                    <span className="command-item-icon">
                      {item.label.slice(0, 1)}
                    </span>
                    <span>{item.label}</span>
                    <kbd>{item.shortcut}</kbd>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
            <p className="command-hint">
              Use ↑ ↓ to navigate · Enter to open · Esc to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
