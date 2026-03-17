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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="bg-white/80 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-blue-100 p-8 md:p-12 max-w-md w-full relative overflow-hidden"
      >
        {/* Decorative Background Elements */}
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 to-blue-600" />
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
          <p className="text-xs text-blue-400 font-medium tracking-widest uppercase mb-4">By Zhenghe Logistics</p>
          <h1 className="text-2xl font-bold text-blue-900 mb-1 tracking-tight">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-blue-500 font-medium text-sm">
            {isSignUp ? 'Sign up to get started' : 'Please log in to continue'}
          </p>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleAuth} className="space-y-6 relative z-10">
          <div className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-blue-300">
                <User size={20} />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email Address"
                required
                className="block w-full pl-11 pr-4 py-4 bg-white border-2 border-blue-100 rounded-full text-blue-900 placeholder-blue-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all outline-none"
              />
            </div>
            
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-blue-300">
                <Lock size={20} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="block w-full pl-11 pr-4 py-4 bg-white border-2 border-blue-100 rounded-full text-blue-900 placeholder-blue-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all outline-none"
              />
            </div>

            {/* Role Selector (Only show on Login for simplicity, or both) */}
            {!isSignUp && (
              <div className="relative">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="block w-full px-4 py-4 bg-white border-2 border-blue-100 rounded-full text-blue-900 focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all outline-none appearance-none"
                >
                  <option value={UserRole.LOGISTICS}>Shipping Department</option>
                  <option value={UserRole.ACCOUNTS}>Accounts Team</option>
                  <option value={UserRole.TRANSPORT}>Transport Team</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-blue-500">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path></svg>
                </div>
              </div>
            )}
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-center text-red-500 text-sm font-medium bg-red-50 py-2 rounded-full px-4 text-center"
            >
              <AlertCircle size={16} className="mr-2 flex-shrink-0" />
              {error}
            </motion.div>
          )}

          {successMessage && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-center text-green-600 text-sm font-medium bg-green-50 py-2 rounded-full px-4 text-center"
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
            className={`w-full flex items-center justify-center py-4 px-6 rounded-full text-white font-bold text-lg shadow-lg shadow-blue-200 transition-all ${
              isLoading ? 'bg-blue-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
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
            className="text-sm text-blue-500 hover:text-blue-700 font-medium flex items-center justify-center mx-auto transition-colors"
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
        <div className="mt-8 text-center text-xs text-blue-300 font-medium relative z-10">
          <p>Powered by Claude Sonnet 4.6 & Supabase</p>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginScreen;
