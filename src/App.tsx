import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, BookOpenText, CalendarDays, FileBox, LayoutDashboard, Menu, Plus, Settings, Sparkles, Upload, Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { AddTradeModal, DayModal, ImportModal, StartDayModal } from './components/modals';
import { api, EMPTY_FILTERS, FilterContext, UiContext, type Filters } from './lib';
import AccountsPage from './pages/Accounts';
import AiPage from './pages/Ai';
import Dashboard from './pages/Dashboard';
import DayPage from './pages/Day';
import NotebookPage from './pages/Notebook';
import ReportsPage from './pages/Reports';
import SettingsPage from './pages/Settings';
import StrategiesPage from './pages/Strategies';
import TradeDetail from './pages/TradeDetail';
import TradesPage from './pages/Trades';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/trades', label: 'Trades', icon: CalendarDays },
  { to: '/notebook', label: 'Notebook', icon: BookOpenText },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/ai', label: 'Edge AI', icon: Sparkles },
  { to: '/strategies', label: 'Strategies', icon: FileBox },
  { to: '/accounts', label: 'Trading accounts', icon: Wallet },
];

export function Logo() {
  return (
    <div className="logo">
      <svg className="logo-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M3 24l8-10 7 5L29 6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 6h8v8" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Edgebook
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/login', { method: 'POST', json: { password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <div className="login-logo"><Logo /></div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="banner bad" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 14 }} disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

/** Asks the server whether a login is needed before showing any of the journal. */
export default function App() {
  const qc = useQueryClient();
  const { data: session, refetch } = useQuery<{ required: boolean; authenticated: boolean }>({ queryKey: ['session'], queryFn: () => api('/session') });
  useEffect(() => {
    const onSignedOut = () => {
      qc.clear();
      void refetch();
    };
    window.addEventListener('edgebook:signed-out', onSignedOut);
    return () => window.removeEventListener('edgebook:signed-out', onSignedOut);
  }, [qc, refetch]);
  if (!session) return null;
  if (session.required && !session.authenticated) return <Login onDone={() => void refetch()} />;
  return <Journal />;
}

function Journal() {
  const [open, setOpen] = useState(() => localStorage.getItem('sidebar') !== 'closed');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [importing, setImporting] = useState(false);
  const [addingTrade, setAddingTrade] = useState(false);
  const [startDay, setStartDay] = useState(false);
  const [dayModal, setDayModal] = useState<string | null>(null);
  const navigate = useNavigate();
  useQuery({ queryKey: ['meta'], queryFn: () => api('/meta') });

  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem('sidebar', v ? 'closed' : 'open');
      return !v;
    });
  };

  const ui = useMemo(
    () => ({
      openImport: () => setImporting(true),
      openDay: (d: string) => setDayModal(d),
      openAddTrade: () => setAddingTrade(true),
      openStartDay: () => setStartDay(true),
    }),
    [],
  );

  return (
    <FilterContext.Provider value={{ filters, setFilters }}>
      <UiContext.Provider value={ui}>
        <header className="topbar">
          <button className="icon-btn" onClick={toggle} aria-label="Toggle sidebar">
            <Menu size={20} />
          </button>
          <Logo />
          <div className="spacer" />
          <button className="ai-pill" onClick={() => navigate('/ai')}>
            <Sparkles size={16} /> Edge AI
          </button>
          <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">
            <Settings size={19} />
          </button>
        </header>

        <aside className={`sidebar ${open ? 'open' : ''}`}>
          <button className="add-btn" onClick={() => setImporting(true)} title="Upload trades">
            <Plus size={18} />
            {open && 'Upload Trades'}
          </button>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={n.label}>
              <n.icon size={19} />
              {open && n.label}
            </NavLink>
          ))}
          <div className="bottom">
            <button className="nav-item" style={{ width: '100%', border: 0, background: 'none' }} onClick={() => setImporting(true)} title="Upload a CSV">
              <Upload size={19} />
              {open && 'Import CSV'}
            </button>
            <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Settings">
              <Settings size={19} />
              {open && 'Settings'}
            </NavLink>
          </div>
        </aside>

        <main className={`main ${open ? 'open' : ''}`}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/trades" element={<TradesPage />} />
            <Route path="/trades/:id" element={<TradeDetail />} />
            <Route path="/day/:date" element={<DayPage />} />
            <Route path="/notebook" element={<NotebookPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/ai" element={<AiPage />} />
            <Route path="/strategies" element={<StrategiesPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>

        {importing && <ImportModal onClose={() => setImporting(false)} />}
        {addingTrade && <AddTradeModal onClose={() => setAddingTrade(false)} />}
        {startDay && <StartDayModal onClose={() => setStartDay(false)} />}
        {dayModal && <DayModal date={dayModal} onClose={() => setDayModal(null)} />}
      </UiContext.Provider>
    </FilterContext.Provider>
  );
}
