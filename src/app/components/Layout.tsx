import { Outlet, Link, useLocation } from "react-router";
import { useAuth } from "../../contexts/AuthContext";
import { Heart, Trash2, LogOut, Home } from "lucide-react";
import { Button } from "./ui/button";
import { motion } from "motion/react";

export default function Layout() {
  const { signOut, user } = useAuth();
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-purple-50">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-rose-100/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <motion.div
                whileHover={{ scale: 1.1, rotate: 5 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                <Heart className="w-7 h-7 text-rose-500 fill-rose-500" />
              </motion.div>
              <span className="font-semibold text-lg bg-gradient-to-r from-rose-500 to-pink-600 bg-clip-text text-transparent">
                Nuestros Momentos
              </span>
            </Link>

            {/* Navigation */}
            <nav className="flex items-center gap-2">
              <Link to="/">
                <Button
                  variant={isActive('/') && !isActive('/trash') ? "default" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <Home className="w-4 h-4" />
                  <span className="hidden sm:inline">Álbumes</span>
                </Button>
              </Link>
              
              <Link to="/trash">
                <Button
                  variant={isActive('/trash') ? "default" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Papelera</span>
                </Button>
              </Link>

              <div className="w-px h-6 bg-gray-200 mx-2" />

              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="gap-2 text-gray-600 hover:text-gray-900"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Salir</span>
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
