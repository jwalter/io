import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuthStore } from "@/stores/auth";

const LoginView = lazy(() => import("@/views/LoginView"));
const ChatView = lazy(() => import("@/views/ChatView"));
const FeedView = lazy(() => import("@/views/FeedView"));
const SettingsView = lazy(() => import("@/views/SettingsView"));
const McpView = lazy(() => import("@/views/McpView"));
const SchedulesView = lazy(() => import("@/views/SchedulesView"));
const SkillsView = lazy(() => import("@/views/SkillsView"));
const SquadsView = lazy(() => import("@/views/SquadsView"));
const SquadDetailView = lazy(() => import("@/views/SquadDetailView"));
const UsageView = lazy(() => import("@/views/UsageView"));
const WikiView = lazy(() => import("@/views/WikiView"));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-zinc-600 font-mono text-sm">Loading...</div>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ChatView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/feed"
          element={
            <ProtectedRoute>
              <FeedView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/squads"
          element={
            <ProtectedRoute>
              <SquadsView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/squads/:id"
          element={
            <ProtectedRoute>
              <SquadDetailView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/skills"
          element={
            <ProtectedRoute>
              <SkillsView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mcp"
          element={
            <ProtectedRoute>
              <McpView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/schedules"
          element={
            <ProtectedRoute>
              <SchedulesView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wiki"
          element={
            <ProtectedRoute>
              <WikiView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/usage"
          element={
            <ProtectedRoute>
              <UsageView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsView />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}
