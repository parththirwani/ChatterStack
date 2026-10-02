"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

import type { User } from "../../app/types";
import { ApiService } from "../../services/api";
import CouncilChatInterface from "./interface/CouncilChatInterface";
import Sidebar from "../sidebar/Sidebar";

const CouncilPage: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] =
    useState<string | undefined>();
  const [refreshConversations, setRefreshConversations] = useState(0);

  const initializedRef = useRef(false);
  const lastConversationIdRef = useRef<string | undefined>(undefined);

  // ---------- INIT USER ----------
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      try {
        const currentUser = await ApiService.getCurrentUser();
        setUser(currentUser);
      } catch (err) {
        console.error("User fetch failed:", err);
        setUser(null);
      } finally {
        setUserLoading(false);
      }
    };

    init();
  }, []);

  // ---------- URL SYNC ----------
  useEffect(() => {
    const segments = pathname.split("/").filter(Boolean);
    const id = segments[1];

    const newId = id && id.length > 0 ? id : undefined;

    if (newId !== lastConversationIdRef.current) {
      lastConversationIdRef.current = newId;
      setSelectedConversationId(newId);
    }
  }, [pathname]);

  // ---------- NAVIGATION ----------
  const navigate = useCallback(
    (path: string, id?: string) => {
      lastConversationIdRef.current = id;
      setSelectedConversationId(id);

      if (pathname !== path) {
        router.push(path);
      }
    },
    [pathname, router]
  );

  // ---------- HANDLERS ----------
  const handleToggleSidebar = () =>
    setSidebarCollapsed((prev) => !prev);

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser);
    navigate("/council");
  };

  const handleConversationSelect = (id: string) => {
    navigate(`/council/${id}`, id);
  };

  const handleNewChat = () => {
    navigate("/council");
  };

  const handleConversationCreated = (id: string) => {
    setRefreshConversations((prev) => prev + 1);
    navigate(`/council/${id}`, id);
  };

  // ---------- LOADING UI ----------
  if (userLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#201d26]">
        <motion.div
          className="w-10 h-10 border-2 border-yellow-400 border-t-transparent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#1a1822] text-white overflow-hidden">
      {/* ---------- SIDEBAR ---------- */}
      <motion.div
        animate={{ width: sidebarCollapsed ? 80 : 280 }}
        transition={{ duration: 0.25 }}
        className="h-full border-r border-white/5 backdrop-blur-md"
      >
        <MemoizedSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          user={user}
          onUserChange={handleUserChange}
          onConversationSelect={handleConversationSelect}
          onNewChat={handleNewChat}
          currentConversationId={selectedConversationId}
          refreshTrigger={refreshConversations}
        />
      </motion.div>

      {/* ---------- MAIN PANEL ---------- */}
      <motion.div
        layout
        className="flex-1 flex flex-col relative"
      >
        {/* subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-yellow-500/5 pointer-events-none" />

        <AnimatePresence mode="wait">
          <motion.div
            key={selectedConversationId || "new"}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col"
          >
            <MemoizedCouncilChatInterface
              selectedConversationId={selectedConversationId}
              onConversationCreated={handleConversationCreated}
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

// ---------- MEMOIZATION ----------
const MemoizedCouncilChatInterface = memo(
  CouncilChatInterface,
  (prev, next) =>
    prev.selectedConversationId === next.selectedConversationId
);

const MemoizedSidebar = memo(
  Sidebar,
  (prev, next) =>
    prev.collapsed === next.collapsed &&
    prev.user?.id === next.user?.id &&
    prev.currentConversationId === next.currentConversationId &&
    prev.refreshTrigger === next.refreshTrigger
);

MemoizedCouncilChatInterface.displayName =
  "MemoizedCouncilChatInterface";
MemoizedSidebar.displayName = "MemoizedSidebar";

export default memo(CouncilPage);