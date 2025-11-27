import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export const GlassCard = ({ children, className, hover = false }: GlassCardProps) => {
  return (
    <div 
      className={cn(
        "glass-card glass-effect rounded-3xl p-6 transition-all duration-300",
        hover && "hover:scale-[1.02] hover:shadow-xl cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
};
