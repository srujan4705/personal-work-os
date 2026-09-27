import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { ApiError } from './lib/api';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { TimesheetPage } from './pages/Timesheet';
import { CalendarPage } from './pages/Calendar';
import { WorkPage, TicketPage } from './pages/Work';
import { TimelinePage } from './pages/Timeline';
import { JournalPage } from './pages/Journal';
import { SprintsPage } from './pages/Sprints';
import { ReportsPage } from './pages/Reports';
import { AssistantPage } from './pages/Assistant';
import { SettingsPage } from './pages/Settings';
import { SearchPage } from './pages/Search';
import { CloseOutPage } from './pages/CloseOut';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: true },
  },
});

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function App() {
  const page = (el: ReactNode) => <Protected>{el}</Protected>;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={page(<DashboardPage />)} />
      <Route path="/timesheet" element={page(<TimesheetPage />)} />
      <Route path="/calendar" element={page(<CalendarPage />)} />
      <Route path="/work" element={page(<WorkPage />)} />
      <Route path="/work/:id" element={page(<TicketPage />)} />
      <Route path="/timeline" element={page(<TimelinePage />)} />
      <Route path="/journal" element={page(<JournalPage />)} />
      <Route path="/sprints" element={page(<SprintsPage />)} />
      <Route path="/reports" element={page(<ReportsPage />)} />
      <Route path="/assistant" element={page(<AssistantPage />)} />
      <Route path="/settings" element={page(<SettingsPage />)} />
      <Route path="/search" element={page(<SearchPage />)} />
      <Route path="/close-out" element={page(<CloseOutPage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
