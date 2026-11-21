import { Redirect } from "wouter";
import { useAuth } from "./useAuth";

/** Renders children only for a signed-in user; otherwise sends them to /login. */
export default function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <p className="label-mono animate-pulse text-muted-foreground">Establishing link…</p>
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <>{children}</>;
}
