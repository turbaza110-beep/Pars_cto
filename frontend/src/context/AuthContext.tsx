import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { AuthUser } from "@/types/auth";

interface SendCodeResponse {
  auth_session_id: string;
  phone_code_hash: string;
}

interface VerifyPhoneCodePayload {
  authSessionId: string;
  code: string;
  password?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  requestPhoneCode: (phoneNumber: string) => Promise<SendCodeResponse>;
  verifyPhoneCode: (payload: VerifyPhoneCodePayload) => Promise<AuthUser | null>;
  me: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
}

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const TOKEN_STORAGE_KEY = "love_parser_access_token";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function safeGetToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeStoreToken(token: string | null) {
  try {
    if (!token) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // no-op
  }
}

async function parseErrorMessage(response: Response) {
  try {
    const payload = await response.json();
    if (payload?.error?.message) {
      return payload.error.message as string;
    }
    if (payload?.message) {
      return payload.message as string;
    }
  } catch {
    // ignore JSON parse errors
  }

  return response.statusText || "Неизвестная ошибка";
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const me = useCallback(async () => {
    const token = safeGetToken();
    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          safeStoreToken(null);
          setUser(null);
          return null;
        }

        throw new Error(await parseErrorMessage(response));
      }

      const data = (await response.json()) as AuthUser;
      setUser(data);
      return data;
    } catch (error) {
      setUser(null);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Не удалось загрузить профиль");
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await me();
      } catch {
        // silently ignore bootstrap errors
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrap();
  }, [me]);

  const requestPhoneCode = useCallback(async (rawPhoneNumber: string) => {
    const phone_number = rawPhoneNumber.trim();
    const response = await fetch(`${API_BASE_URL}/api/v1/telegram/auth/send-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone_number }),
    });

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    return (await response.json()) as SendCodeResponse;
  }, []);

  const verifyPhoneCode = useCallback(
    async ({ authSessionId, code, password }: VerifyPhoneCodePayload) => {
      const payload = {
        auth_session_id: authSessionId,
        code,
        password,
      };

      const response = await fetch(`${API_BASE_URL}/api/v1/telegram/auth/verify-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response));
      }

      const data = (await response.json()) as { access_token?: string };
      if (data?.access_token) {
        safeStoreToken(data.access_token);
      }

      return me();
    },
    [me],
  );

  const logout = useCallback(async () => {
    const token = safeGetToken();

    try {
      if (token) {
        await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } finally {
      safeStoreToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      requestPhoneCode,
      verifyPhoneCode,
      me,
      logout,
    }),
    [user, isLoading, requestPhoneCode, verifyPhoneCode, me, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
