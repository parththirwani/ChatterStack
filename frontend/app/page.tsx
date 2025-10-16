"use client"

import { useState, useEffect } from "react";
import ChatterStackPage from "./components/ChatPage";

const BACKEND_URL = "http://localhost:3000";

type User = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);

  // Clean up URL immediately on mount (before any rendering)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('auth')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <ChatterStackPage />
  );
}