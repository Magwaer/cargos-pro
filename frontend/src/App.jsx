import { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, getToken } from './api.js'
import { InvoiceProvider } from './components/InvoiceDrawer.jsx'
import Shell from './components/Shell.jsx'
import { I18nProvider } from './i18n.jsx'
import Auth from './pages/Auth.jsx'
import Companies from './pages/Companies.jsx'
import Contacts from './pages/Contacts.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Dispatch from './pages/Dispatch.jsx'
import Documents from './pages/Documents.jsx'
import Expenses from './pages/Expenses.jsx'
import DriverApp from './pages/DriverApp.jsx'
import Fleet from './pages/Fleet.jsx'
import Invoices from './pages/Invoices.jsx'
import PublicInvoice from './pages/PublicInvoice.jsx'
import Messages from './pages/Messages.jsx'
import Orders from './pages/Orders.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'
import Tasks from './pages/Tasks.jsx'
import Workflows from './pages/Workflows.jsx'

const AuthContext = createContext(null)
export function useAuth() { return useContext(AuthContext) }

function AuthProvider({ children }) {
  const [me, setMe] = useState(undefined)
  const reload = () => {
    if (!getToken()) { setMe(null); return }
    api('/api/auth/me').then(setMe).catch(() => setMe(null))
  }
  useEffect(() => { reload() }, [])
  return <AuthContext.Provider value={{ me, reload, setMe }}>{children}</AuthContext.Provider>
}

function Require({ children }) {
  const { me } = useAuth()
  const location = useLocation()
  if (me === undefined) return <div className="boot">Loading…</div>
  if (!me) return <Navigate to="/login" replace />
  if (me.role === 'driver' && location.pathname !== '/drive') return <Navigate to="/drive" replace />
  if (location.pathname === '/drive') return children
  if (/^\/workflows\/[^/]+$/.test(location.pathname)) return children
  return <Shell>{children}</Shell>
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <InvoiceProvider>
        <Routes>
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/register" element={<Auth mode="register" />} />
          <Route path="/" element={<Require><Dashboard /></Require>} />
          <Route path="/companies" element={<Require><Companies /></Require>} />
          <Route path="/companies/:id" element={<Require><Companies /></Require>} />
          <Route path="/contacts" element={<Require><Contacts /></Require>} />
          <Route path="/contacts/:id" element={<Require><Contacts /></Require>} />
          <Route path="/orders" element={<Require><Orders /></Require>} />
          <Route path="/orders/:id" element={<Require><Orders /></Require>} />
          <Route path="/dispatch" element={<Require><Dispatch /></Require>} />
          <Route path="/fleet" element={<Require><Fleet /></Require>} />
          <Route path="/invoices" element={<Require><Invoices /></Require>} />
          <Route path="/expenses" element={<Require><Expenses /></Require>} />
          <Route path="/documents" element={<Require><Documents /></Require>} />
          <Route path="/tasks" element={<Require><Tasks /></Require>} />
          <Route path="/workflows" element={<Require><Workflows /></Require>} />
          <Route path="/workflows/:id" element={<Require><Workflows /></Require>} />
          <Route path="/reports" element={<Require><Reports /></Require>} />
          <Route path="/settings" element={<Require><Settings /></Require>} />
          <Route path="/messages" element={<Require><Messages /></Require>} />
          <Route path="/drive" element={<Require><DriverApp /></Require>} />
          <Route path="/i/:token" element={<PublicInvoice />} />
          <Route path="*" element={<Require><Dashboard /></Require>} />
        </Routes>
        </InvoiceProvider>
      </AuthProvider>
    </I18nProvider>
  )
}
