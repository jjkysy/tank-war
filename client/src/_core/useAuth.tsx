import { createContext, useContext, type ReactNode } from "react";
import { trpc } from "./trpc";

interface AuthState {
  user: { id: string; email: string; name: string | null; role: string } | null;
  loading: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, refetch: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, refetch } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (
    <AuthContext.Provider value={{ user: data ?? null, loading: isLoading, refetch: () => void refetch() }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
