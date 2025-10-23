import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { AuthProvider } from "./context/AuthContext";
import Auth from "./pages/Auth";
import CitizenDashboard from "./pages/CitizenDashboard";
import AuthorityDashboard from "./pages/AuthorityDashboard";
import TransparencyDashboard from "./pages/TransparencyDashboard";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/citizen" element={<CitizenDashboard />} />
            <Route path="/authority" element={<AuthorityDashboard />} />
            <Route path="/transparency" element={<TransparencyDashboard />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

const container = document.getElementById("root")!;
const win = window as any;
// Always try to unmount any existing root to avoid duplicate createRoot calls causing DOM inconsistencies
try {
  if (win.__REACT_ROOT) {
    try { win.__REACT_ROOT.unmount(); } catch (e) { /* ignore */ }
    win.__REACT_ROOT = undefined;
    win.__REACT_ROOT_CONTAINER = undefined;
  }
} catch (e) { /* ignore */ }

try {
  win.__REACT_ROOT = createRoot(container);
  win.__REACT_ROOT_CONTAINER = container;
  win.__REACT_ROOT.render(<App />);
} catch (e) {
  // Fallback
  const root = createRoot(container);
  root.render(<App />);
}

// Vite HMR: ensure we unmount on module dispose to avoid duplicate roots
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    try {
      if ((window as any).__REACT_ROOT) {
        (window as any).__REACT_ROOT.unmount();
        (window as any).__REACT_ROOT = undefined;
        (window as any).__REACT_ROOT_CONTAINER = undefined;
      }
    } catch (e) {
      // ignore
    }
  });
}

export default App;
