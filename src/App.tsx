import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Auth } from "@/pages/Auth";
import { Dashboard } from "@/pages/Dashboard";
import { Index } from "@/pages/Index";
import { Profile } from "@/pages/Profile";

export function App() {
  return (
    <Routes>
      <Route path="/main" element={<MainRoute />} />
      <Route path="/admin" element={<WorkspaceRoute admin />} />
      <Route path="/:userId" element={<WorkspaceRoute />} />
      <Route path="/:userId/projects/:projectId" element={<WorkspaceRoute />} />
      <Route path="*" element={<RedirectTo pathname="/main" />} />
    </Routes>
  );
}

function RedirectTo({ pathname }: { pathname: string }) {
  const { search } = useLocation();
  return <Navigate replace to={{ pathname, search }} />;
}

function CheckingAccount() {
  return <p className="p-8 text-sm text-muted-foreground" role="status">Checking your account…</p>;
}

function MainRoute() {
  const account = useAuth();
  if (account.loading) return <CheckingAccount />;
  if (!account.user) return <Index welcome />;
  if (!account.role) return <Auth />;
  return <RedirectTo pathname={account.role === "admin" ? "/admin" : `/${encodeURIComponent(account.user.uid)}`} />;
}

function WorkspaceRoute({ admin = false }: { admin?: boolean }) {
  const account = useAuth();
  const { userId, projectId } = useParams();
  if (account.loading) return <CheckingAccount />;
  if (!account.user || !account.role) return <RedirectTo pathname="/main" />;
  if (!admin && !projectId && userId === `${account.user.uid}profile`) {
    return <Profile key={account.user.uid} />;
  }
  if (account.role === "admin") {
    if (admin) return <Dashboard />;
    return userId === account.user.uid ? <Index welcome={!projectId} /> : <RedirectTo pathname="/admin" />;
  }
  const workspace = `/${encodeURIComponent(account.user.uid)}`;
  return !admin && userId === account.user.uid ? <Index welcome={!projectId} /> : <RedirectTo pathname={workspace} />;
}
