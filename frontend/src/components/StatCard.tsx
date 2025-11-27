import { LucideIcon } from "lucide-react";
import { GlassCard } from "./GlassCard";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  trend?: string;
}

export const StatCard = ({ icon: Icon, label, value, trend }: StatCardProps) => {
  return (
    <GlassCard className="flex items-center gap-4" hover>
      <div className="p-3 rounded-2xl bg-primary/20 glow-effect">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        {trend && (
          <p className="text-xs text-accent mt-1">{trend}</p>
        )}
      </div>
    </GlassCard>
  );
};
