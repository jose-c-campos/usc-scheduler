import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const { login, signup, forgotPassword, resetPassword, loading, error: authError } = useAuth();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup form state
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Forgot password form state
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  
  // Reset password form state
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  // On mount, if there's a token in the URL, go straight to reset form
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
      setResetToken(token);
      setIsResetPassword(true);
      setIsForgotPassword(false);
      setIsLogin(false);
    }
  }, []);

  // Password visibility toggles
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      await login(loginEmail, loginPassword);
      navigate('/scheduler');
    } catch (err: any) {
      setError(authError || 'Login failed. Please try again.');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate passwords match
    if (signupPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password strength
    if (signupPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    try {
      await signup(signupName, signupEmail, signupPassword);
      navigate('/scheduler');
    } catch (err: any) {
      setError(authError || 'Signup failed. Please try again.');
    }
  };
  
  // Handle forgot password request
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    try {
      await forgotPassword(forgotPasswordEmail);
  setSuccess('If an account exists, a password reset link has been sent to your email');
      
    } catch (err: any) {
      setError(authError || 'Failed to process password reset request.');
    }
  };
  
  // Handle password reset
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    // Validate passwords match
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match');
      return;
    }
    
    // Validate password strength
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    
    try {
      await resetPassword(resetToken, newPassword);
      setSuccess('Your password has been reset successfully');
      
      // Return to login form after successful reset
      setTimeout(() => {
        setIsResetPassword(false);
        setIsLogin(true);
      }, 2000);
      
    } catch (err: any) {
      setError(authError || 'Failed to reset password.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6">
      <div className="w-full max-w-md">
        {/* Tab switching - Only show for login/signup, not for password reset flows */}
        {!isForgotPassword && !isResetPassword && (
          <div className="flex mb-6 border-b border-white/20">
            <button
              className={`py-3 px-6 font-medium text-lg transition-colors ${
                isLogin ? 'text-usc-red border-b-2 border-usc-red' : 'text-white/70 hover:text-white'
              }`}
              onClick={() => setIsLogin(true)}
            >
              Login
            </button>
            <button
              className={`py-3 px-6 font-medium text-lg transition-colors ${
                !isLogin ? 'text-usc-red border-b-2 border-usc-red' : 'text-white/70 hover:text-white'
              }`}
              onClick={() => setIsLogin(false)}
            >
              Sign Up
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-800/30 border border-red-600 text-white rounded-lg">
            {error}
          </div>
        )}
        
        {/* Success message */}
        {success && (
          <div className="mb-4 p-3 bg-green-800/30 border border-green-600 text-white rounded-lg">
            {success}
          </div>
        )}

        {/* Login Form */}
        {isLogin && !isForgotPassword && !isResetPassword && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-white mb-2">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-white mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  id="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  className="w-full p-3 pr-16 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/70 hover:text-white"
                  aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                >
                  {showLoginPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsForgotPassword(true)}
                className="text-sm text-white/70 hover:text-usc-red"
              >
                Forgot password?
              </button>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-usc-red text-white font-bold rounded-lg hover:bg-red-800 transition-colors disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
            <div className="text-center text-white/70">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => setIsLogin(false)}
                className="text-usc-red hover:underline"
              >
                Sign up
              </button>
            </div>
          </form>
        )}

        {/* Signup Form */}
        {!isLogin && !isForgotPassword && !isResetPassword && (
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-white mb-2">
                Full Name
              </label>
              <input
                type="text"
                id="name"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                required
                className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
              />
            </div>
            <div>
              <label htmlFor="signup-email" className="block text-white mb-2">
                Email
              </label>
              <input
                type="email"
                id="signup-email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
                className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
              />
            </div>
            <div>
              <label htmlFor="signup-password" className="block text-white mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showSignupPassword ? 'text' : 'password'}
                  id="signup-password"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  required
                  className="w-full p-3 pr-16 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
                />
                <button
                  type="button"
                  onClick={() => setShowSignupPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/70 hover:text-white"
                  aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                >
                  {showSignupPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-1 text-xs text-white/60">
                Must be at least 8 characters
              </p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-white mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full p-3 pr-16 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/70 hover:text-white"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-usc-red text-white font-bold rounded-lg hover:bg-red-800 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
            <div className="text-center text-white/70">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setIsLogin(true)}
                className="text-usc-red hover:underline"
              >
                Login
              </button>
            </div>
          </form>
        )}
        
        {/* Forgot Password Form */}
        {isForgotPassword && !isResetPassword && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Reset Your Password</h2>
            <p className="text-white/70 mb-6 text-center">
              Enter your email address and we'll send you instructions to reset your password.
            </p>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label htmlFor="forgot-email" className="block text-white mb-2">
                  Email
                </label>
                <input
                  type="email"
                  id="forgot-email"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  required
                  className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-usc-red text-white font-bold rounded-lg hover:bg-red-800 transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
              <div className="text-center text-white/70">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setIsLogin(true);
                  }}
                  className="text-usc-red hover:underline"
                >
                  Back to Login
                </button>
              </div>
            </form>
          </div>
        )}
        
        {/* Reset Password Form */}
        {isResetPassword && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Create New Password</h2>
            <p className="text-white/70 mb-6 text-center">
              Enter your new password below.
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-white mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    id="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full p-3 pr-16 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/70 hover:text-white"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-white/60">
                  Must be at least 8 characters
                </p>
              </div>
              <div>
                <label htmlFor="confirm-new-password" className="block text-white mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmNewPassword ? 'text' : 'password'}
                    id="confirm-new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                    className="w-full p-3 pr-16 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmNewPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/70 hover:text-white"
                    aria-label={showConfirmNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmNewPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-usc-red text-white font-bold rounded-lg hover:bg-red-800 transition-colors disabled:opacity-50"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
              <div className="text-center text-white/70">
        <button
                  type="button"
                  onClick={() => {
          setIsResetPassword(false);
          setIsLogin(true);
          setResetToken('');
          setError('');
          setSuccess('');
                  }}
                  className="text-usc-red hover:underline"
                >
                  Back to Login
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;
