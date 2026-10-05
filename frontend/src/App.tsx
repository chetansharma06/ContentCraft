import { useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Archive,
  ArrowUpRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Command,
  FileOutput,
  LayoutDashboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ScanSearch,
  Sparkles,
  Sun,
} from 'lucide-react'
import { checkHealth } from './api/client'
import { CatalogPage } from './pages/CatalogPage'
import { GeneratePage } from './pages/GeneratePage'
import { OverviewPage } from './pages/OverviewPage'
import { PublishPage } from './pages/PublishPage'
import { ReviewPage } from './pages/ReviewPage'
import { ReviewWorkspace } from './pages/ReviewWorkspace'
import { AuditPage } from './pages/AuditPage'

const navigation = [
  { label: 'Overview', path: '/overview', icon: LayoutDashboard },
  { label: 'Catalog', path: '/catalog', icon: Archive },
  { label: 'Generate', path: '/generate', icon: Sparkles },
  { label: 'Review', path: '/review', icon: CheckCheck },
  { label: 'Publish', path: '/publish', icon: FileOutput },
  { label: 'Audit', path: '/audit', icon: ScanSearch },
]

const pageContent: Record<string, { eyebrow: string; title: string; icon: typeof Activity }> = {
  '/overview': { eyebrow: 'Workspace', title: 'Overview', icon: LayoutDashboard },
  '/catalog': { eyebrow: 'Product data', title: 'Catalog', icon: Archive },
  '/generate': { eyebrow: 'Content studio', title: 'Generate', icon: Sparkles },
  '/review': { eyebrow: 'Quality control', title: 'Review', icon: CheckCheck },
  '/publish': { eyebrow: 'Distribution', title: 'Publish', icon: FileOutput },
  '/audit': { eyebrow: 'Workspace history', title: 'Audit', icon: ScanSearch },
}

function App() {
  const [collapsed, setCollapsed] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('contentcraft-theme') === 'dark')
  const location = useLocation()
  const navigate = useNavigate()
  const health = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    refetchInterval: 20_000,
  })
  const currentPath = location.pathname.startsWith('/review/') ? '/review' : location.pathname
  const currentPage = pageContent[currentPath] ?? pageContent['/overview']

  function toggleTheme() {
    const nextTheme = dark ? 'light' : 'dark'
    localStorage.setItem('contentcraft-theme', nextTheme)
    setDark(nextTheme === 'dark')
  }

  return (
    <div className={`app-frame${dark ? ' theme-dark' : ''}`}>
      <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Command size={17} strokeWidth={2.3} /></div>
          {!collapsed && <span className="brand-name">content<span>craft</span></span>}
          <button
            className="icon-button sidebar-toggle"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        {!collapsed && <div className="workspace-switcher">
          <div className="workspace-avatar">C</div>
          <div className="workspace-copy"><span>Workspace</span><strong>ContentCraft HQ</strong></div>
          <ChevronRight className="workspace-chevron" size={15} />
        </div>}

        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={path} aria-label={label} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} title={collapsed ? label : undefined}>
              <Icon size={18} strokeWidth={1.8} />
              {!collapsed && <span>{label}</span>}
              {label === 'Review' && !collapsed && <span className="nav-count">0</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          {!collapsed && <div className="plan-card">
            <div className="plan-icon"><Sparkles size={15} /></div>
            <div><strong>Creation engine</strong><span>Ready for your next batch</span></div>
            <ArrowUpRight size={14} className="plan-arrow" />
          </div>}
          <button className="nav-link help-link" aria-label="Help center" title={collapsed ? 'Help center' : undefined}>
            <CircleHelp size={18} strokeWidth={1.8} />
            {!collapsed && <span>Help center</span>}
          </button>
          <div className="profile-row">
            <div className="profile-avatar">JD</div>
            {!collapsed && <div className="profile-copy"><strong>Chetan Sharma</strong><span>Administrator</span></div>}
            {!collapsed && <button className="icon-button profile-more" aria-label="Profile options"><ChevronLeft size={16} /></button>}
          </div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{currentPage.title}</strong></div>
          <div className="topbar-actions">
            <div className={`health-indicator ${health.isSuccess ? 'connected' : health.isError ? 'disconnected' : 'checking'}`}>
              <span className="health-dot" />
              <span>{health.isSuccess ? 'Backend connected' : health.isError ? 'Backend offline' : 'Connecting'}</span>
            </div>
            <span className="topbar-divider" />
            <button className="icon-button theme-button" onClick={toggleTheme} title={`Switch to ${dark ? 'light' : 'dark'} theme`} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="new-button" onClick={() => navigate('/generate')}><Plus size={16} /><span>New content</span></button>
          </div>
        </header>

        <div className="page-area">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/generate" element={<GeneratePage />} />
            <Route path="/review/:id" element={<ReviewWorkspace />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/publish" element={<PublishPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App