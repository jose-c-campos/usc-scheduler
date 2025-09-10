// Authentication related routes
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../services/mailer');

// Initialize database connection pool (reusing your existing config)
const pool = new Pool({
  host:     process.env.USC_DB_HOST     || 'localhost', // Docker container is mapped to localhost
  port:     Number(process.env.USC_DB_PORT) || 5432,
  database: process.env.USC_DB_NAME     || 'usc_sched',
  user:     process.env.USC_DB_USER,
  password: process.env.USC_DB_PASSWORD
});

if (!process.env.USC_DB_USER || !process.env.USC_DB_PASSWORD) {
  console.warn('USC_DB_USER/USC_DB_PASSWORD not set. API auth routes DB access may fail.');
}

// Environment variables for JWT
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key'; // IMPORTANT: Set this in production
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // Token expires in 7 days

// Signup endpoint
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  
  try {
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }
    
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user
    const newUser = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name, email, hashedPassword]
    );
    
    // Generate JWT token
    const token = jwt.sign(
      { id: newUser.rows[0].id, email: newUser.rows[0].email }, 
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Return user info and token
    res.status(201).json({
      message: 'User created successfully',
      user: newUser.rows[0],
      token
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    // Find user by email
    const user = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (user.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Remove password from user object
    const { password: _, ...userWithoutPassword } = user.rows[0];
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.rows[0].id, email: user.rows[0].email }, 
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Return user info and token
    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ user: user.rows[0] });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN format
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Request password reset endpoint
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }
  
  try {
    // Check if user exists
    const user = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (user.rows.length === 0) {
      // We don't want to reveal that the email doesn't exist for security reasons
      return res.status(200).json({ 
        message: 'If a user with that email exists, a password reset link has been sent' 
      });
    }
    
    // Generate a random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const userId = user.rows[0].id;
    
  // Set token expiration (15 minutes from now)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    
    console.log('Current time:', new Date());
    console.log('Expiration time:', expiresAt);
    
    // Delete any existing tokens for this user
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [userId]
    );
    
    // Save token to database
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, resetToken, expiresAt]
    );
    
    // Build reset link and send email (do not reveal account existence)
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const resetLink = `${appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(resetToken)}`;

    try {
      await sendPasswordResetEmail(email, resetLink);
    } catch (mailErr) {
      console.warn('sendPasswordResetEmail failed (continuing generic response):', mailErr.message);
    }

    res.status(200).json({ 
      message: 'If a user with that email exists, a password reset link has been sent'
    });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error during password reset request' });
  }
});

// Reset password endpoint
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ message: 'Token and password are required' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  
  try {
    // Find token in database - not using NOW() to avoid timezone issues
    const currentTime = new Date().toISOString();
    console.log('Current time for comparison:', currentTime);
    
    const tokenResult = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1',
      [token]
    );
    
    console.log('Token search result:', tokenResult.rows);
    
    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid reset token' });
    }
    
    // Check if token is expired
    const tokenData = tokenResult.rows[0];
    const expiryTime = new Date(tokenData.expires_at).getTime();
    const currentTimeMs = new Date().getTime();
    
    console.log('Token expiry time:', new Date(tokenData.expires_at));
    console.log('Current time:', new Date());
    console.log('Expiry timestamp:', expiryTime);
    console.log('Current timestamp:', currentTimeMs);
    
    if (currentTimeMs > expiryTime) {
      console.log('Token is expired');
      return res.status(400).json({ message: 'Reset token has expired' });
    }
    
    const userId = tokenResult.rows[0].user_id;
    
    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Update user's password
    await pool.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );
    
    // Delete the used token
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE token = $1',
      [token]
    );
    
    res.status(200).json({ message: 'Password has been reset successfully' });
    
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error during password reset' });
  }
});

module.exports = router;
