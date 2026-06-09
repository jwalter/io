import { ReactNode } from "react";

export function GlassCard({ children, color, onClick } : {
  children: ReactNode;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{ 
        background: color ? `${color}05` : "rgba(31, 40, 51, 0.55)",
        borderColor: color ? `${color}1A` : "rgba(255, 255, 255, 0.07)"}}
      className={`glass-card border flex flex-col justify-start rounded-2xl p-4`}
    >
      {children}
    </button>
  );
}
