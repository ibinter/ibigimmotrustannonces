import { Routes, Route, NavLink } from 'react-router-dom';
import { Home, PlusCircle, Users, Columns, Activity } from 'lucide-react';
import Dashboard   from './pages/Dashboard';
import Import      from './pages/Import';
import Recherches  from './pages/Recherches';
import Pipeline    from './pages/Pipeline';

const nav = [
  { to: '/',          icon: Home,        label: 'Dashboard'   },
  { to: '/import',    icon: PlusCircle,  label: 'Importer'    },
  { to: '/clients',   icon: Users,       label: 'Clients'     },
  { to: '/pipeline',  icon: Columns,     label: 'Pipeline'    },
];

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <span className="font-bold text-brand-600 text-lg">IBIG Immo Trust</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                 ${isActive
                   ? 'bg-brand-50 text-brand-700'
                   : 'text-gray-600 hover:bg-gray-100'}`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-100 text-xs text-gray-400">
          IBIG SOFT — v1.0
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/import"   element={<Import />} />
          <Route path="/clients"  element={<Recherches />} />
          <Route path="/pipeline" element={<Pipeline />} />
        </Routes>
      </main>
    </div>
  );
}
