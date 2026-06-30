import { createBrowserRouter } from 'react-router-dom';
import { Login } from './pages/Login';
import { Desktop } from './components/desktop/Desktop';

// /login is the only standalone route. Every other path renders the
// auth-guarded Desktop; feature "pages" are apps opened as windows, not routes.
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '*',
    element: <Desktop />,
  },
]);
