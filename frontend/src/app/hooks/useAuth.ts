import { useState, useEffect, useCallback } from 'react';
import { ApiService } from '../services/api';
import type { User } from '../types';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const validateAuth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await ApiService.validateAuth();
      if (result.ok && result.user) {
        setUser(result.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Auth validation error:', err);
      setError('Failed to validate authentication');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setError(null);
      await ApiService.logout();
      setUser(null);
    } catch (err) {
      console.error('Logout error:', err);
      setError('Failed to logout');
    }
  }, []);

  const login = useCallback((userData: User) => {
    setUser(userData);
    setError(null);
  }, []);

  // Check auth status on mount and after OAuth redirects
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authParam = urlParams.get('auth');
    
    if (authParam === 'success') {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      // Validate auth after OAuth success
      validateAuth();
    } else if (authParam === 'error') {
      // Clear URL parameters and set error
      window.history.replaceState({}, document.title, window.location.pathname);
      setError('Authentication failed');
      setLoading(false);
    } else {
      // Check if user is already logged in on page load
      validateAuth();
    }
  }, [validateAuth]);

  return {
    user,
    loading,
    error,
    login,
    logout,
    validateAuth,
    isAuthenticated: !!user && user.id !== 'guest',
  };
};