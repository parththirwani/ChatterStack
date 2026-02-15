import { useState, useEffect } from 'react';
import { User } from '@/src/types';
import ApiService from '@/src/services/api';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await ApiService.validateAuth();
        if (result.ok && result.user) {
          setUser(result.user);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const logout = async () => {
    try {
      await ApiService.logout();
    } finally {
      setUser(null);
    }
  };

  return {
    user,
    loading,
    isAuthenticated: !!user,
    logout,
  };
};
