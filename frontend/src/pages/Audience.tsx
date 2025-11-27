import { Layout } from "@/components/Layout";
import { GlassCard } from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Users, TrendingUp, Download, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export default function Audience() {
  const {
    toast
  } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [criteria, setCriteria] = useState({
    likes: true,
    comments: true,
    reposts: true,
    frequency: true
  });
  const [parsingResults, setParsingResults] = useState<Array<{id: string, name: string, count: number}>>([]);

  useEffect(() => {
    const savedResults = JSON.parse(localStorage.getItem('parsingResults') || '[]');
    setParsingResults(savedResults);
  }, []);
  const mockUserPhoto = "https://api.dicebear.com/7.x/avataaars/svg?seed=telegram";
  const handleParsing = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      
      // Save results to localStorage
      const timestamp = new Date().toISOString();
      const savedResults = JSON.parse(localStorage.getItem('audienceResults') || '[]');
      const newResult = {
        id: Date.now().toString(),
        name: `Результаты поиска ${new Date().toLocaleDateString('ru-RU')}`,
        count: Math.floor(Math.random() * 500) + 100,
        timestamp
      };
      savedResults.push(newResult);
      localStorage.setItem('audienceResults', JSON.stringify(savedResults));
      
      toast({
        title: "Аудитория найдена",
        description: "Данные об активных пользователях сохранены"
      });
    }, 3000);
  };
  return <Layout backgroundImage={mockUserPhoto}>
      <div className="space-y-6 max-w-2xl mx-auto animate-slide-up">
        <GlassCard>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-2xl bg-accent/20 glow-effect">
              <Users className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Активная аудитория</h1>
              <p className="text-sm text-muted-foreground">Найдите вовлечённых пользователей</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Выберите базу каналов/чатов</Label>
              <Select>
                <SelectTrigger className="glass-card border-white/20 mt-1">
                  <SelectValue placeholder="Выберите результаты парсинга" />
                </SelectTrigger>
                <SelectContent className="glass-card glass-effect">
                  {parsingResults.length > 0 ? (
                    parsingResults.map((result) => (
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
              <Label>Ссылка на канал / чат</Label>
              <Input placeholder="https://t.me/channelname или @channelname" className="glass-card border-white/20 mt-1" />
            </div>

            <GlassCard className="bg-primary/5 border-primary/20">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Критерии активности
              </h4>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Лайки и реакции</span>
                  <Switch checked={criteria.likes} onCheckedChange={checked => setCriteria({
                  ...criteria,
                  likes: checked
                })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Комментарии</span>
                  <Switch checked={criteria.comments} onCheckedChange={checked => setCriteria({
                  ...criteria,
                  comments: checked
                })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Репосты</span>
                  <Switch checked={criteria.reposts} onCheckedChange={checked => setCriteria({
                  ...criteria,
                  reposts: checked
                })} />
                </div>
                
              </div>
            </GlassCard>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Период анализа</Label>
                <Input type="number" placeholder="30" className="glass-card border-white/20 mt-1" />
                <p className="text-xs text-muted-foreground mt-1">дней</p>
              </div>
              <div>
                <Label>Мин. активность</Label>
                <Input type="number" placeholder="5" className="glass-card border-white/20 mt-1" />
                <p className="text-xs text-muted-foreground mt-1">действий</p>
              </div>
            </div>

            <Button onClick={handleParsing} disabled={isLoading} className="w-full bg-gradient-to-r from-accent to-primary hover:opacity-90 glow-effect mt-6">
              {isLoading ? <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Поиск...
                </> : <>
                  <Users className="w-4 h-4 mr-2" />
                  Начать поиск
                </>}
            </Button>
          </div>
        </GlassCard>

        {/* Statistics */}
        <div className="grid grid-cols-2 gap-3">
          <GlassCard className="text-center">
            <div className="p-3 rounded-2xl bg-primary/20 w-fit mx-auto mb-3">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <p className="text-2xl font-bold">0</p>
            <p className="text-sm text-muted-foreground">Активных</p>
          </GlassCard>
          
          <GlassCard className="text-center">
            <div className="p-3 rounded-2xl bg-accent/20 w-fit mx-auto mb-3">
              <TrendingUp className="w-6 h-6 text-accent" />
            </div>
            <p className="text-2xl font-bold">0%</p>
            <p className="text-sm text-muted-foreground">Вовлечённость</p>
          </GlassCard>
        </div>

        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Экспорт данных</h3>
            <Button size="sm" disabled className="glass-card border-white/20">
              <Download className="w-4 h-4 mr-2" />
              Excel
            </Button>
          </div>
          <p className="text-sm text-muted-foreground text-center py-4">Начните поиск для получения данных</p>
        </GlassCard>
      </div>
    </Layout>;
}