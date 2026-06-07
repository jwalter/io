import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { LogoIcon } from "./LogoIcon";
import {
  MessageSquare,
  Inbox,
  Users,
  Zap,
  Server,
  Clock,
  History,
  BookOpen,
  BarChart3,
  Shield,
  Settings,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

const navItems = [
  { path: "/", icon: MessageSquare, label: "Chat" },
  { path: "/feed", icon: Inbox, label: "Feed" },
  { path: "/squads", icon: Users, label: "Squads" },
  { path: "/skills", icon: Zap, label: "Skills" },
  { path: "/mcp", icon: Server, label: "MCP" },
  { path: "/schedules", icon: Clock, label: "Schedules" },
  { path: "/history", icon: History, label: "History" },
  { path: "/wiki", icon: BookOpen, label: "Wiki" },
  { path: "/usage", icon: BarChart3, label: "Usage" },
  { path: "/audit-log", icon: Shield, label: "Audit Log" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside
      className={`flex flex-col bg-sidebar border-r border-border transition-all duration-200 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
        <LogoIcon size={28} />
        {!collapsed && <span className="font-bold text-lg text-gradient-brand">IO</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
          return (
            <NavLink
              key={path}
              to={path}
              className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded-md transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon size={20} />
              {!collapsed && <span className="text-sm">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 px-2 py-1.5 w-full rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
        {!collapsed && (
          <div className="flex items-center justify-between px-2 mt-2">
            <span className="text-xs text-muted-foreground">v{__APP_VERSION__}</span>
            <a
              href="https://github.com/michaeljolley/io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
