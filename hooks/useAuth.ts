import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { UserRole, TEAM_NAMES } from '../users';
import { AppConfig } from '../config';

export function useAuth(onLogout?: () => void) {
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('All');

  const isAdmin = userId === import.meta.env.VITE_ADMIN_USER_ID;

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUserId(session.user.id);
        const storedRole = localStorage.getItem('userRole') as UserRole;
        setUserRole(storedRole || UserRole.LOGISTICS);
      }
      setIsSessionLoading(false);
    };
    checkSession();
  }, []);

  useEffect(() => {
    if (userRole) {
      const roleConfig = AppConfig.roles[userRole as keyof typeof AppConfig.roles];
      setActiveTab(roleConfig ? roleConfig.defaultTab : 'All');
    }
  }, [userRole]);

  const getTabs = useCallback(() => {
    if (!userRole) return [];
    const roleConfig = AppConfig.roles[userRole as keyof typeof AppConfig.roles];
    const allowedTypes = roleConfig ? roleConfig.allowedTypes : [];
    return [...allowedTypes, 'Developer Notes'];
  }, [userRole]);

  const tabs = getTabs();

  const handleLogin = (role: UserRole) => {
    localStorage.setItem('userRole', role);
    setUserRole(role);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('userRole');
    setUserRole(null);
    onLogout?.();
  };

  const getTeamName = (role: UserRole | null) =>
    role ? TEAM_NAMES[role] : 'Logistics Data Controller';

  return {
    userRole, setUserRole, userId, isAdmin, isSessionLoading,
    activeTab, setActiveTab, tabs, handleLogin, handleLogout, getTeamName,
  };
}
