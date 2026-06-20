import { useCallback, useEffect, useState } from "react";
import type { AuthSession, DashboardData } from "../types";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/dashboard", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const result = await responseJson<DashboardData>(response);
    setData(result);
    setError(null);
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) return null;
        return responseJson<AuthSession>(response);
      })
      .then(async (result) => {
        if (!active) return;
        setSession(result);
        setAuthChecked(true);
        if (result) await refresh();
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setAuthChecked(true);
        setError(
          reason instanceof Error ? reason.message : "Authentication check failed.",
        );
      });

    return () => {
      active = false;
    };
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await responseJson<AuthSession>(response);
      setSession(result);
      await refresh();
      return result;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    if (session) {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": session.csrfToken },
      });
    }
    setSession(null);
    setData(null);
  }, [session]);

  const mutate = useCallback(
    async <T,>(
      path: string,
      method: "POST" | "PUT" | "DELETE",
      body?: unknown,
    ) => {
      if (!session) throw new Error("Authentication required.");
      const response = await fetch(`/api${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          "x-csrf-token": session.csrfToken,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await responseJson<T>(response);
      await refresh();
      return result;
    },
    [refresh, session],
  );

  const download = useCallback(
    async (path: string, fallbackFilename: string) => {
      if (!session) throw new Error("Authentication required.");
      const response = await fetch(`/api${path}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        await responseJson(response);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackFilename;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    [session],
  );

  const request = useCallback(
    async <T,>(path: string) => {
      if (!session) throw new Error("Authentication required.");
      const response = await fetch(`/api${path}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      return responseJson<T>(response);
    },
    [session],
  );

  return {
    data,
    session,
    authChecked,
    error,
    login,
    logout,
    mutate,
    download,
    request,
    refresh,
  };
}
