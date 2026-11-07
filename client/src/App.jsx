// Routage + garde par rôle.
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, homeFor } from './auth.jsx';
import { ToastProvider } from './components/Toast.jsx';
import InstallPWA from './components/InstallPWA.jsx';
import Aide from './pages/Aide.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Abonnement from './pages/Abonnement.jsx';
import Admin from './pages/Admin.jsx';
import AdminSubscriptions from './pages/AdminSubscriptions.jsx';
import CarteClient from './pages/CarteClient.jsx';
import DashboardLivreur from './pages/DashboardLivreur.jsx';
import DashboardCommercant from './pages/DashboardCommercant.jsx';

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <ToastProvider>
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Register />} />
      <Route path="/abonnement" element={<Guard roles={['client', 'commercant', 'livreur']}><Abonnement /></Guard>} />
      <Route path="/admin" element={<Guard roles={['admin']}><Admin /></Guard>} />
      <Route path="/admin/subscriptions" element={<Guard roles={['admin']}><AdminSubscriptions /></Guard>} />
      <Route path="/carte" element={<Guard roles={['client']}><CarteClient /></Guard>} />
      <Route path="/livreur" element={<Guard roles={['livreur']}><DashboardLivreur /></Guard>} />
      <Route path="/commercant" element={<Guard roles={['commercant']}><DashboardCommercant /></Guard>} />
      <Route path="/aide" element={<Guard><Aide /></Guard>} />
      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
    </Routes>
    {/* Bannière « Installer l'application » (masquée si déjà installée) */}
    <InstallPWA />
    </ToastProvider>
  );
}
