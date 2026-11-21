import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/useAuth";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/play", label: "Deploy" },
  { href: "/leaderboard", label: "Ranks" },
  { href: "/profile", label: "Dossier" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [loc] = useLocation();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center border border-primary/60 bg-primary/10">
              <span className="h-2 w-2 bg-primary" />
            </span>
            <span className="hud-value text-sm font-semibold tracking-[0.18em] text-foreground">
              TANK<span className="text-primary">WAR</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                to={n.href}
                className={`hud-label px-3 py-2 transition-colors hover:text-foreground ${
                  loc === n.href ? "text-primary" : ""
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <>
                <span className="hud-label hidden sm:inline">{user.name || user.email}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="hud-label h-8 border-border px-3"
                  onClick={() => void logout()}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Link to="/login" className="hud-label px-2 hover:text-foreground">
                  Sign in
                </Link>
                <Button asChild size="sm" className="hud-label h-8 px-3">
                  <Link to="/signup">Enlist</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {children}

      <footer className="mt-16 border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="hud-label">Tank War · supervised battle simulator</p>
          <p className="hud-label text-muted-foreground/70">
            Every round is tuned by the supervisor agent
          </p>
        </div>
      </footer>
    </div>
  );
}
