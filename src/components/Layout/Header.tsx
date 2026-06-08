import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { LogOut } from 'lucide-react';

const Header: React.FC = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 h-14 sm:h-16">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src="/sanaladas-logo-new.png"
              alt="Sanaladas"
              className="h-8 w-auto sm:h-10 flex-shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-slate-900 truncate">Sistema de Pedidos</h1>
              <p className="hidden sm:block text-xs text-slate-500">Gestión y organización</p>
            </div>
          </div>

          {user && (
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <div className="hidden sm:block text-right min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate max-w-[180px]">{user.email}</p>
                <p className="text-xs text-slate-500">Usuario activo</p>
              </div>
              <button
                onClick={signOut}
                title="Cerrar sesión"
                className="inline-flex items-center gap-2 px-2 sm:px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors flex-shrink-0"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Cerrar sesión</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
