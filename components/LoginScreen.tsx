import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Lock, ArrowRight, AlertCircle, UserPlus } from 'lucide-react';
import { UserRole } from '../users';
import { supabase } from '../services/supabase';

interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.LOGISTICS);
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setIsLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setSuccessMessage('Check your email for the confirmation link!');
        setIsLoading(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // Upon successful login, pass the selected role
        // In a real app, this role would come from the user's profile in the DB
        onLogin(role);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary via-primary-container to-primary flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="bg-surface-lowest/90 backdrop-blur-xl rounded-[2.5rem] shadow-[0_32px_64px_rgba(9,20,38,0.24)] p-8 md:p-12 max-w-md w-full relative overflow-hidden"
      >
        {/* Decorative accent bar */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-secondary-container to-secondary" />
        {/* Header */}
        <div className="text-center relative z-10 mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="flex justify-center mb-4"
          >
            <img src="/pluckd.png" alt="Pluckd" className="h-16 w-auto object-contain" />
          </motion.div>
          <p className="text-[0.6875rem] text-secondary font-medium tracking-[0.05em] uppercase mb-4">By Zhenghe Logistics</p>
          <h1 className="text-2xl font-bold text-primary mb-1 tracking-tight">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-[#4a5568] font-medium text-sm">
            {isSignUp ? 'Sign up to get started' : 'Please log in to continue'}
          </p>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleAuth} className="space-y-6 relative z-10">
          <div className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                <User size={20} />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email Address"
                required
                className="block w-full pl-11 pr-4 py-4 bg-surface-low border border-outline/20 rounded-full text-primary placeholder-outline focus:border-secondary focus:ring-2 focus:ring-secondary/10 transition-all outline-none"
              />
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                <Lock size={20} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="block w-full pl-11 pr-4 py-4 bg-surface-low border border-outline/20 rounded-full text-primary placeholder-outline focus:border-secondary focus:ring-2 focus:ring-secondary/10 transition-all outline-none"
              />
            </div>

            {/* Role Selector */}
            {!isSignUp && (
              <div className="relative">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="block w-full px-4 py-4 bg-surface-low border border-outline/20 rounded-full text-primary focus:border-secondary focus:ring-2 focus:ring-secondary/10 transition-all outline-none appearance-none"
                >
                  <option value={UserRole.LOGISTICS}>Shipping Department</option>
                  <option value={UserRole.ACCOUNTS}>Accounts Team</option>
                  <option value={UserRole.TRANSPORT}>Transport Team</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-secondary">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path></svg>
                </div>
              </div>
            )}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-center text-red-600 text-sm font-medium bg-red-50 py-2 rounded-full px-4 text-center"
            >
              <AlertCircle size={16} className="mr-2 flex-shrink-0" />
              {error}
            </motion.div>
          )}

          {successMessage && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-center text-secondary text-sm font-medium bg-secondary-fixed py-2 rounded-full px-4 text-center"
            >
              <AlertCircle size={16} className="mr-2 flex-shrink-0" />
              {successMessage}
            </motion.div>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={isLoading}
            className={`w-full flex items-center justify-center py-4 px-6 rounded-full text-white font-bold text-lg transition-all ${
              isLoading ? 'bg-primary/50 cursor-not-allowed' : 'bg-gradient-to-r from-primary to-primary-container'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {isSignUp ? 'Creating Account...' : 'Logging in...'}
              </span>
            ) : (
              <span className="flex items-center">
                {isSignUp ? 'Sign Up' : 'Login'}
                <ArrowRight size={20} className="ml-2" />
              </span>
            )}
          </motion.button>
        </form>

        {/* Toggle Sign Up / Login */}
        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
              setSuccessMessage('');
            }}
            className="text-sm text-secondary hover:text-primary font-medium flex items-center justify-center mx-auto transition-colors"
          >
            {isSignUp ? (
              <>Already have an account? Log in</>
            ) : (
              <>
                <UserPlus size={16} className="mr-1" />
                New user? Create an account
              </>
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-outline font-medium relative z-10">
          <p>Powered by Claude Sonnet 4.6 & Supabase</p>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginScreen;
