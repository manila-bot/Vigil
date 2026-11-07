import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { session } from "./api/client";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import CommandCenter from "./pages/CommandCenter";
import Incident from "./pages/Incident";
import Access from "./pages/Access";

function RequireAuth({ children }: { children: React.ReactNode }) {
  return session.token ? <>{children}</> : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/incidents/:id" element={<Incident />} />
          <Route path="/access" element={<Access />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
