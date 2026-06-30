import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Storage } from './pages/Storage';
import { Shares } from './pages/Shares';
import { Users } from './pages/Users';
import { Files } from './pages/Files';
import { Virtualization } from './pages/Virtualization';
import { NotFound } from './pages/NotFound';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'storage', element: <Storage /> },
      { path: 'shares', element: <Shares /> },
      { path: 'users', element: <Users /> },
      { path: 'files', element: <Files /> },
      { path: 'virtualization', element: <Virtualization /> },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
]);
