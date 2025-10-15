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
  const [loading, setLoading] = useState(false);

  // Clean up URL immediately on mount (before any rendering)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('auth')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // ---- Fetch logged-in user (optional helper)
  const fetchUser = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // important: send cookies
        body: JSON.stringify({ userId: user?.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch (err) {
      console.error("Error fetching user", err);
    }
  };

  // ---- Auth Actions
  const handleLogin = (provider: "google" | "github") => {
    // Redirect user to backend OAuth route
    window.location.href = `${BACKEND_URL}/auth/${provider}`;
  };

  const handleLogout = async () => {
    await fetch(`${BACKEND_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  };

  return (
    <ChatterStackPage />
  );
}