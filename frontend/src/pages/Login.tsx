import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Lock, Phone, ShieldCheck } from "lucide-react";

import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const { requestPhoneCode, verifyPhoneCode, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [phoneNumber, setPhoneNumber] = useState("+7");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [authSessionId, setAuthSessionId] = useState<string | null>(null);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const canSubmitPhone = useMemo(() => phoneNumber.trim().length >= 5, [phoneNumber]);
  const canVerifyCode = useMemo(() => code.trim().length >= 3 && Boolean(authSessionId), [code, authSessionId]);

  const handlePhoneSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmitPhone) return;

    setIsRequestingCode(true);
    setError(null);

    try {
      const response = await requestPhoneCode(phoneNumber);
      setAuthSessionId(response.auth_session_id);
      setStep("code");
      toast({
        title: "Код отправлен",
        description: "Введите код подтверждения, который пришёл в Telegram",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отправить код";
      setError(message);
    } finally {
      setIsRequestingCode(false);
    }
  };

  const handleVerifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canVerifyCode || !authSessionId) {
      setError("Введите код подтверждения");
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      await verifyPhoneCode({ authSessionId, code: code.trim(), password: password.trim() || undefined });
      toast({
        title: "Успешный вход",
        description: "Добро пожаловать обратно!",
      });
      navigate("/", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось подтвердить код";
      setError(message);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendCode = async () => {
    if (!canSubmitPhone) return;
    setError(null);
    setIsRequestingCode(true);

    try {
      const response = await requestPhoneCode(phoneNumber);
      setAuthSessionId(response.auth_session_id);
      toast({
        title: "Код повторно отправлен",
        description: "Проверьте сообщения Telegram",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отправить код";
      setError(message);
    } finally {
      setIsRequestingCode(false);
    }
  };

  if (isLoading || (isAuthenticated && !isVerifying && !isRequestingCode)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <GlassCard className="w-full max-w-md space-y-6">
        <div className="space-y-3 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Phone className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Вход через Telegram</h1>
            <p className="text-sm text-muted-foreground">Введите номер телефона, привязанный к Telegram</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
          <div className={`flex items-center gap-2 ${step === "phone" ? "text-primary" : "opacity-60"}`}>
            <span className="h-6 w-6 rounded-full border flex items-center justify-center border-current">1</span>
            Телефон
          </div>
          <div className="h-px flex-1 bg-border" />
          <div className={`flex items-center gap-2 ${step === "code" ? "text-primary" : "opacity-60"}`}>
            <span className="h-6 w-6 rounded-full border flex items-center justify-center border-current">2</span>
            Код
          </div>
        </div>

        {step === "phone" && (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Номер телефона</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="+79990000000"
                className="glass-card border-white/20"
              />
              <p className="text-xs text-muted-foreground">Мы отправим код подтверждения в Telegram</p>
            </div>

            <Button type="submit" disabled={!canSubmitPhone || isRequestingCode} className="w-full">
              {isRequestingCode ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Отправляем код...
                </>
              ) : (
                "Получить код"
              )}
            </Button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="flex justify-between text-sm">
              <div className="text-muted-foreground">
                Отправили код на <span className="font-medium text-foreground">{phoneNumber}</span>
              </div>
              <button
                type="button"
                className="text-primary text-xs"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setPassword("");
                  setError(null);
                }}
              >
                Изменить номер
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Код из Telegram</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder="12345"
                className="glass-card border-white/20 tracking-[0.3em] text-center text-lg"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="password" className="text-sm">
                  Пароль 2FA (если включён)
                </Label>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Введите пароль"
                className="glass-card border-white/20"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button type="button" onClick={handleResendCode} disabled={isRequestingCode} className="text-primary disabled:opacity-50">
                Отправить код ещё раз
              </button>
              <span>Код действует 10 минут</span>
            </div>

            <Button type="submit" disabled={!canVerifyCode || isVerifying} className="w-full">
              {isVerifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Проверяем код...
                </>
              ) : (
                "Войти"
              )}
            </Button>
          </form>
        )}

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <div className="flex items-start gap-3 rounded-2xl bg-primary/5 p-4 border border-primary/10">
          <div className="mt-0.5">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Безопасность</p>
            <p>Мы используем официальное Telegram API. Ваши данные не сохраняются после выхода.</p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
