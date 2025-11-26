"use client"
import { useEffect } from "react";
import ChatterStackPage from "./components/ChatPage";

export default function Home() {
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