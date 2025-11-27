import { Layout } from "@/components/Layout";
import { GlassCard } from "@/components/GlassCard";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getUserAvatarUrl, getUserBackgroundImage } from "@/lib/user";
import { BarChart3, Users, Send, CheckCircle, Crown, LogOut } from "lucide-react";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();

  if (!user) {
    return (
      <AuthGuard>
        <div />
      </AuthGuard>
    );
  }

  const avatarUrl = getUserAvatarUrl(user);
  const backgroundImage = getUserBackgroundImage(user);
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Пользователь";
  const username = user.telegram_username ? `@${user.telegram_username.replace(/^@/, "")}` : user.phone_number ?? "—";
  const hasActiveSubscription = user.subscription?.status === "active";
  const subscriptionExpiresAt = user.subscription?.expires_at
    ? new Date(user.subscription.expires_at).toLocaleDateString("ru-RU")
    : null;

  const parsingUsed = Number(user.limits?.parsing_used ?? 0);
  const parsingLimit = Number(user.limits?.parsing_limit ?? 0);
  const audienceUsed = Number(user.limits?.audience_used ?? 0);
  const audienceLimit = Number(user.limits?.audience_limit ?? 0);
  const broadcastUsed = Number(user.limits?.broadcast_used ?? 0);
  const broadcastLimit = Number(user.limits?.broadcast_limit ?? 0);

  const formatUsage = (used: number, limit?: number) => {
    if (!limit) {
      return `${used}`;
    }
    return `${used} / ${limit}`;
  };

  const formatTrend = (used: number, limit?: number) => {
    if (!limit) {
      return "Без ограничений";
    }
    const remaining = Math.max(limit - used, 0);
    return `Осталось ${remaining}`;
  };

  const stats = [
    {
      icon: BarChart3,
      label: "Парсинг",
      value: formatUsage(parsingUsed, parsingLimit),
      trend: formatTrend(parsingUsed, parsingLimit),
    },
    {
      icon: Users,
      label: "Аудитория",
      value: formatUsage(audienceUsed, audienceLimit),
      trend: formatTrend(audienceUsed, audienceLimit),
    },
    {
      icon: Send,
      label: "Рассылки",
      value: formatUsage(broadcastUsed, broadcastLimit),
      trend: formatTrend(broadcastUsed, broadcastLimit),
    },
  ];

  const pricingPlans = [
    { period: "1 неделя", price: "500 ₽", discount: null },
    { period: "1 месяц", price: "1000 ₽", discount: "-20%", popular: true },
    { period: "1 год", price: "5700 ₽", discount: "-52%", savings: "Экономия 5500 ₽" },
  ];

  const handleLogout = async () => {
    await logout();
    toast({ title: "Вы вышли из аккаунта" });
  };

  return (
    <AuthGuard>
      <Layout backgroundImage={backgroundImage}>
        <div className="space-y-6 max-w-2xl mx-auto animate-slide-up">
          <GlassCard>
            <div className="flex items-start gap-4 mb-4">
              <Avatar className="w-16 h-16 sm:w-20 sm:h-20 border-4 border-white/30 flex-shrink-0">
                <AvatarImage src={avatarUrl} />
                <AvatarFallback>{displayName[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold">{displayName}</h2>
                    <p className="text-muted-foreground text-sm">{username}</p>
                    <p className="text-xs text-muted-foreground mt-1">ID: {user.id}</p>
                    {hasActiveSubscription ? (
                      <Badge className="bg-accent/20 text-accent border-accent/30 text-xs whitespace-nowrap mt-2 inline-flex">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Активна {subscriptionExpiresAt ? `до ${subscriptionExpiresAt}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-muted text-xs whitespace-nowrap mt-2 inline-flex">
                        Нет подписки
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {!hasActiveSubscription && (
              <div className="pt-4 border-t border-white/20">
                <p className="text-sm text-muted-foreground mb-3">Оформите подписку для доступа ко всем функциям</p>
                <Button className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 glow-effect">
                  <Crown className="w-4 h-4 mr-2" />
                  Оформить подписку
                </Button>
              </div>
            )}
          </GlassCard>

          {!hasActiveSubscription && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold px-2">Выберите тариф</h3>
              {pricingPlans.map((plan, idx) => (
                <GlassCard key={idx} hover className={plan.popular ? "border-primary/50 ring-2 ring-primary/20" : ""}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">{plan.period}</h4>
                        {plan.discount && (
                          <Badge className="bg-accent/20 text-accent border-accent/30 text-xs">{plan.discount}</Badge>
                        )}
                        {plan.popular && (
                          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Популярно</Badge>
                        )}
                      </div>
                      {plan.savings && <p className="text-xs text-muted-foreground mt-1">{plan.savings}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold gradient-text">{plan.price}</p>
                      <Button size="sm" className={plan.popular ? "bg-primary glow-effect" : "bg-secondary"}>
                        Выбрать
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-lg font-semibold px-2">Статистика</h3>
            {stats.map((stat, idx) => (
              <div key={idx} style={{ animationDelay: `${idx * 100}ms` }} className="animate-fade-in">
                <StatCard {...stat} />
              </div>
            ))}
          </div>

          <GlassCard>
            <h3 className="text-lg font-semibold mb-4">Активность за месяц</h3>
            <div className="h-48 flex items-end justify-around gap-2">
              {[40, 65, 45, 80, 55, 90, 70].map((height, idx) => (
                <div
                  key={idx}
                  className="flex-1 bg-gradient-to-t from-primary to-accent rounded-t-lg opacity-60 hover:opacity-100 transition-all duration-300"
                  style={{
                    height: `${height}%`,
                    animationDelay: `${idx * 100}ms`,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-around text-xs text-muted-foreground mt-2">
              <span>ПН</span>
              <span>ВТ</span>
              <span>СР</span>
              <span>ЧТ</span>
              <span>ПТ</span>
              <span>СБ</span>
              <span>ВС</span>
            </div>
          </GlassCard>
        </div>
      </Layout>
    </AuthGuard>
  );
}
