import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthPage } from "@/pages/auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CategoriesPage } from "@/pages/categories";
import { OverviewPage } from "@/pages/overview";
import { RecurringPage } from "@/pages/recurring";
import { SettingsPage } from "@/pages/settings";
import { TransactionsPage } from "@/pages/transactions";
import "./index.css";

// Follow the OS color scheme. shadcn themes key off a `.dark` class on <html>.
const scheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyScheme = () => document.documentElement.classList.toggle("dark", scheme.matches);
applyScheme();
scheme.addEventListener("change", applyScheme);

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "transactions", element: <TransactionsPage /> },
      { path: "categories", element: <CategoriesPage /> },
      { path: "recurring", element: <RecurringPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

function Gate() {
  const { loading, user } = useAuth();
  if (loading) return null;
  if (!user) return <AuthPage />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </TooltipProvider>
  </StrictMode>,
);
