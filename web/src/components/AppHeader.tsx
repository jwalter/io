import { useNavigate } from "react-router";
import { useAuthStore } from "@/stores/auth";
import { Inbox, LogOut, User } from "lucide-react";

export function AppHeader() {
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="flex items-center justify-end gap-4 px-6 py-3 bg-header border-b border-border">
      <button
        onClick={() => navigate("/feed")}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Inbox"
      >
        <Inbox size={20} />
      </button>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <User size={16} />
        <span>{email ?? "User"}</span>
      </div>
      <button
        onClick={handleLogout}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Logout"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
