// User schedule related routes
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

console.log('Schedules routes module loaded');

// Initialize database connection pool (reusing your existing config)
const pool = new Pool({
  host:     process.env.USC_DB_HOST     || 'localhost', // Docker container is mapped to localhost
  port:     Number(process.env.USC_DB_PORT) || 5432,
  database: process.env.USC_DB_NAME     || 'usc_sched',
  user:     process.env.USC_DB_USER,
  password: process.env.USC_DB_PASSWORD
});

if (!process.env.USC_DB_USER || !process.env.USC_DB_PASSWORD) {
  console.warn('USC_DB_USER/USC_DB_PASSWORD not set. Schedules routes DB access may fail.');
}

// Middleware to authenticate JWT token (reused from auth.js)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN format
  
  console.log('Auth header:', authHeader);
  console.log('Token:', token);
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }
  
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key'; // IMPORTANT: Set this in production
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('Token verification error:', err);
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Debug endpoint - no authentication required
router.get('/debug', (req, res) => {
  res.json({ message: 'Schedules routes are working!' });
});

// Get all saved schedules for the current user
router.get('/user', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const { rows } = await pool.query(
      'SELECT * FROM user_schedules WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    
    res.json({ schedules: rows });
  } catch (error) {
    console.error('Error fetching user schedules:', error);
    res.status(500).json({ message: 'Server error fetching saved schedules' });
  }
});

// Get a specific saved schedule by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.user.id;
    
    const { rows } = await pool.query(
      'SELECT * FROM user_schedules WHERE id = $1 AND user_id = $2',
      [scheduleId, userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    
    res.json({ schedule: rows[0] });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ message: 'Server error fetching schedule' });
  }
});

// Save a new schedule
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, semester, schedule_data } = req.body;
    const userId = req.user.id;
    
    if (!name || !semester || !schedule_data) {
      return res.status(400).json({ message: 'Name, semester, and schedule data are required' });
    }
    
    try {
      // Ensure schedule_data is properly formatted as JSON for PostgreSQL
      const jsonData = typeof schedule_data === 'string' 
        ? JSON.parse(schedule_data) 
        : schedule_data;
      
      console.log('Saving schedule with data:', {
        userId,
        name,
        semester,
        dataType: typeof jsonData
      });
      
      const { rows } = await pool.query(
        'INSERT INTO user_schedules (user_id, name, semester, schedule_data) VALUES ($1, $2, $3, $4) RETURNING *',
        [userId, name, semester, JSON.stringify(jsonData)]
      );
      
      res.status(201).json({ 
        message: 'Schedule saved successfully', 
        schedule: rows[0] 
      });
    } catch (jsonError) {
      console.error('Error processing JSON data:', jsonError);
      res.status(400).json({ message: 'Invalid schedule data format' });
    }
  } catch (error) {
    console.error('Error saving schedule:', error);
    res.status(500).json({ message: 'Server error saving schedule' });
  }
});

// Update a saved schedule
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.user.id;
    const { name, schedule_data } = req.body;
    
    // Check if schedule exists and belongs to user
    const checkResult = await pool.query(
      'SELECT * FROM user_schedules WHERE id = $1 AND user_id = $2',
      [scheduleId, userId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    
    // Update the schedule
    const { rows } = await pool.query(
      'UPDATE user_schedules SET name = $1, schedule_data = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4 RETURNING *',
      [name, schedule_data, scheduleId, userId]
    );
    
    res.json({ 
      message: 'Schedule updated successfully', 
      schedule: rows[0] 
    });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ message: 'Server error updating schedule' });
  }
});

// Delete a saved schedule
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.user.id;
    
    // Check if schedule exists and belongs to user
    const checkResult = await pool.query(
      'SELECT * FROM user_schedules WHERE id = $1 AND user_id = $2',
      [scheduleId, userId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    
    // Delete the schedule
    await pool.query(
      'DELETE FROM user_schedules WHERE id = $1 AND user_id = $2',
      [scheduleId, userId]
    );
    
    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ message: 'Server error deleting schedule' });
  }
});

// Debug endpoint
router.get('/debug', (req, res) => {
  res.json({ message: 'Schedules routes are working!' });
});

module.exports = router;
