import { createBrowserRouter, Navigate } from "react-router-dom";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Index } from "@/pages/Index";
import { NotFound } from "@/pages/NotFound";
import { RouteError } from "@/pages/RouteError";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <SiteLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Index /> },
      { path: "index.html", element: <Index /> },
      ...["hem", "om-oss", "mer", "bestall"].map((section) => ({
        path: section,
        element: <Navigate replace to={`/#${section}`} />,
      })),
      { path: "*", element: <NotFound /> },
    ],
  },
]);
