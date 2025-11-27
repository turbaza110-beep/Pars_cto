import { Layout } from "@/components/Layout";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { BookOpen, Home, Search, Users, Send } from "lucide-react";

export default function Help() {
  const sections = [
    {
      icon: Home,
      title: "Личный кабинет",
      content: "В личном кабинете вы можете просмотреть информацию о вашей подписке, статистику использования и оформить подписку. Доступны тарифы на неделю, месяц и год со скидками.",
    },
    {
      icon: Search,
      title: "Парсинг каналов",
      content: "Найдите нужные Telegram каналы по городу, категории и количеству участников. Результаты автоматически сохраняются и становятся доступны для выбора во вкладке Аудитория. Вы можете скачивать файлы по отдельности или архивом.",
    },
    {
      icon: Users,
      title: "Активная аудитория",
      content: "Выберите базу каналов/чатов из сохранённых результатов парсинга или укажите ссылку вручную. Система анализирует активность пользователей и находит людей с наибольшей вовлечённостью по лайкам, комментариям и репостам. Результаты сохраняются для использования в рассылке.",
    },
    {
      icon: Send,
      title: "Рассылка",
      content: "Выберите базу контактов из сохранённых результатов анализа аудитории или введите никнеймы (@username) вручную через запятую. Система автоматически контролирует скорость отправки для безопасности. Прогресс отслеживается в реальном времени.",
    },
  ];

  const mockUserPhoto = "https://api.dicebear.com/7.x/avataaars/svg?seed=telegram";

  return (
    <Layout backgroundImage={mockUserPhoto}>
      <div className="space-y-6 max-w-2xl mx-auto animate-slide-up">
        <GlassCard>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-accent/20 glow-effect">
              <BookOpen className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Инструкция</h1>
              <p className="text-sm text-muted-foreground">Как пользоваться приложением</p>
            </div>
          </div>
        </GlassCard>

        {sections.map((section, idx) => {
          const Icon = section.icon;
          return (
            <div 
              key={idx}
              className="animate-fade-in"
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              <GlassCard>
              <div className="flex gap-4">
                <div className="p-3 rounded-2xl bg-primary/20 h-fit">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-2">{section.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {section.content}
                  </p>
                </div>
              </div>
              </GlassCard>
            </div>
          );
        })}

        <GlassCard className="bg-primary/5 border-primary/20">
          <h3 className="font-semibold mb-3">Важная информация</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <span>Все данные хранятся только во время активной подписки</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <span>При завершении подписки файлы и статистика удаляются автоматически</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <span>Рассылки работают с учётом лимитов Telegram для безопасности</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <span>Авторизация происходит автоматически через Telegram</span>
            </li>
          </ul>
        </GlassCard>

        <GlassCard className="text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Если у вас остались вопросы, свяжитесь с поддержкой
          </p>
          <Button 
            asChild 
            className="w-full sm:w-auto min-w-[200px] glass-card border-primary/30 hover:border-primary/50"
            variant="outline"
          >
            <a 
              href="https://t.me/RBCCRYPTA" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Поддержка
            </a>
          </Button>
        </GlassCard>
      </div>
    </Layout>
  );
}
