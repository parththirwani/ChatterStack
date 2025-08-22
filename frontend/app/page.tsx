"use client"

import { useEffect, useState } from "react";

const BACKEND_URL = "http://localhost:3000"; //  your express server

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

  // ---- Example: Call chat API after login
  const callChat = async () => {
    setLoading(true);
    const response = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", //  send auth cookies
      body: JSON.stringify({
        message: "what is 2+2",
        model: "openai/gpt-4o",
      }),
    });

    if (!response.body) {
      console.error("No response body");
      setLoading(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream finished");
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        console.log("Received Chunk:", chunk);
      }
    } catch (error) {
      console.error("Error reading stream", error);
    } finally {
      reader.releaseLock();
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>ChatterStack Client</h1>

      {!user ? (
        <div>
          <button onClick={() => handleLogin("google")}>Login with Google</button>
          <button onClick={() => handleLogin("github")}>Login with GitHub</button>
        </div>
      ) : (
        <div>
          <p>✅ Logged in as {user.name} ({user.email})</p>
          {user.avatarUrl && <img src={user.avatarUrl} alt="avatar" width={40} />}
          <button onClick={handleLogout}>Logout</button>
        </div>
      )}

      <hr />

      <button onClick={callChat} disabled={loading}>
        {loading ? "Calling Chat..." : "Call Chat API"}
      </button>
    </div>
  );
}
