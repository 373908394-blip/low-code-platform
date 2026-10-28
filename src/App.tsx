import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';

import { routes } from './routes';
import { AuthProvider } from '@/contexts/AuthContext';
import { RouteGuard } from '@/components/common/RouteGuard';

const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <IntersectObserver />
        <div className="flex flex-col min-h-screen">
          <main className="flex-grow">
            <Routes>
              {routes.map((route, index) => (
                <Route
                  key={index}
                  path={route.path}
                  // 仅非公开路由进入守卫；/login 等 public 路由直接渲染，
                  // 否则未登录时守卫会与登录页互相重定向造成 replaceState 死循环
                  element={route.public ? route.element : <RouteGuard>{route.element}</RouteGuard>}
                />
              ))}
            </Routes>
          </main>
        </div>
        <Toaster />
      </AuthProvider>
    </Router>
  );
};

export default App;
