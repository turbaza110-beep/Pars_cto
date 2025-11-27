import { Layout } from "@/components/Layout";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

export default function Broadcast() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [manualNicknames, setManualNicknames] = useState("");
  const [audienceResults, setAudienceResults] = useState<Array<{id: string, name: string, count: number}>>([]);

  useEffect(() => {
    const savedResults = JSON.parse(localStorage.getItem('audienceResults') || '[]');
    setAudienceResults(savedResults);
  }, []);

  const handleBroadcast = () => {
    if (!message.trim()) {
      toast({
        title: "Ошибка",
        description: "Введите текст сообщения",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setProgress(0);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsLoading(false);
          toast({
            title: "Рассылка завершена",
            description: "Сообщения успешно отправлены",
          });
          return 100;
        }
        return prev + 10;
      });
    }, 300);
  };

  const mockUserPhoto = "https://api.dicebear.com/7.x/avataaars/svg?seed=telegram";

  return (
    <Layout backgroundImage={mockUserPhoto}>
      <div className="space-y-6 max-w-2xl mx-auto animate-slide-up">
        <GlassCard>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-2xl bg-primary/20 glow-effect">
              <Send className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Рассылка</h1>
              <p className="text-sm text-muted-foreground">Отправьте сообщения аудитории</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Выберите базу контактов</Label>
              <Select>
                <SelectTrigger className="glass-card border-white/20 mt-1">
                  <SelectValue placeholder="Выберите файл с результатами" />
                </SelectTrigger>
                <SelectContent className="glass-card glass-effect">
                  {audienceResults.length > 0 ? (
                    audienceResults.map((result) => (
                      <SelectItem key={result.id} value={result.id}>
                        {result.name} ({result.count})
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="empty" disabled>Нет сохранённых результатов</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Ручной ввод никнеймов</Label>
              <Input 
                placeholder="@username1, @username2, @username3..."
                className="glass-card border-white/20 mt-1"
                value={manualNicknames}
                onChange={(e) => setManualNicknames(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Введите никнеймы через запятую
              </p>
            </div>

            <div>
              <Label>Текст сообщения</Label>
              <Textarea 
                placeholder="Напишите ваше сообщение..."
                className="glass-card border-white/20 mt-1 min-h-[150px] resize-none"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {message.length} / 4096 символов
              </p>
            </div>

            <GlassCard className="bg-accent/5 border-accent/20">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-accent" />
                Безопасность рассылки
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
                  <span className="text-muted-foreground">Автоматические паузы между сообщениями</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
                  <span className="text-muted-foreground">Соблюдение лимитов Telegram API</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
                  <span className="text-muted-foreground">Защита от блокировки аккаунта</span>
                </div>
              </div>
            </GlassCard>

            {isLoading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Отправлено</span>
                  <span className="font-medium">{Math.floor(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <Button 
              onClick={handleBroadcast}
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 glow-effect mt-6"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Начать рассылку
                </>
              )}
            </Button>
          </div>
        </GlassCard>

        {/* Statistics */}
        <div className="grid grid-cols-3 gap-3">
          <GlassCard className="text-center p-4">
            <p className="text-2xl font-bold">0</p>
            <p className="text-xs text-muted-foreground mt-1">Отправлено</p>
          </GlassCard>
          
          <GlassCard className="text-center p-4">
            <p className="text-2xl font-bold text-accent">0</p>
            <p className="text-xs text-muted-foreground mt-1">Прочитано</p>
          </GlassCard>
          
          <GlassCard className="text-center p-4">
            <p className="text-2xl font-bold text-destructive">0</p>
            <p className="text-xs text-muted-foreground mt-1">Ошибки</p>
          </GlassCard>
        </div>
      </div>
    </Layout>
  );
}
