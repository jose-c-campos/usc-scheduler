/* ─────────────────────────────  server.js  ───────────────────────────── */
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs');
const { spawn }  = require('child_process');
const { Pool }   = require('pg');

// Import routes
const authRoutes = require('./routes/auth');
const scheduleRoutes = require('./routes/schedules');

const app       = express();
const PORT      = process.env.PORT || 3001;
const SEMESTER  = process.env.SEMESTER || '20253';                      // allow override via env
const schedulerPath = path.resolve(__dirname, '../scheduler/build/scheduler');

// Do not force NODE_ENV here; respect container/platform setting

/* ───────── middleware ───────── */
// Robust CORS setup for both development and production
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests)
    if (!origin) return callback(null, true);

    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      // In development, allow any localhost origin
      if (origin.match(/^https?:\/\/localhost:[0-9]+$/) ||
          origin.match(/^https?:\/\/127\.0\.0\.1:[0-9]+$/)) {
        return callback(null, true);
      }
    }

    // In production, allow list from env ALLOWED_ORIGINS (comma-separated)
    const envOrigins = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (envOrigins.length > 0 && envOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ───────── Routes ───────── */
app.use('/api/auth', authRoutes);
app.use('/api/schedules', scheduleRoutes);

// Simple test endpoint directly in server.js
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// Direct debug endpoint to test schedules route
app.get('/api/schedules-test', (req, res) => {
  res.json({ message: 'Schedules test endpoint in server.js' });
});

/* ───────── Postgres pool ───────── */
const pool = new Pool({
  host:     process.env.USC_DB_HOST     || 'localhost', // Docker container is mapped to localhost
  port:     process.env.USC_DB_PORT     || 5432,
  database: process.env.USC_DB_NAME     || 'usc_sched',
  user:     process.env.USC_DB_USER     || 'REDACTED',
  password: process.env.USC_DB_PASSWORD || 'REDACTED'
});

// If a custom schema is provided, set search_path when clients connect
const customSchema = process.env.USC_DB_SCHEMA;
if (customSchema) {
  pool.on('connect', client => {
    const schemas = String(customSchema)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .join(', ');
    if (schemas) {
      client.query(`SET search_path TO ${schemas}, public`).catch(() => {/* ignore */});
    }
  });
}

/* ───────── helpers ───────── */
const formatProfessor = raw =>
  !raw ? 'TBA'
       : Array.isArray(raw)
         ? raw.join(', ')
         : String(raw).replace(/[{}"]/g, '').split(',')[0].trim();

const timeRange = (start, end) => (start && end ? `${start} - ${end}` : 'TBA');

/* --------------------------------------------------------------------- */
/*  GET  /api/available‑classes                                           */
/* --------------------------------------------------------------------- */
app.get('/api/available-classes', async (req, res) => {
  try {
    const q    = (req.query.q || '').trim().toUpperCase();
    const like = q ? `${q}%` : '%';

    const { rows } = await pool.query(
      `SELECT DISTINCT code
         FROM courses
        WHERE semester = $1
          AND code ILIKE $2
        ORDER BY code`,
      [SEMESTER, like]
    );

    res.json({ classes: rows.map(r => r.code) });
  } catch (err) {
    console.error('available-classes:', err);
    res.status(500).json({ error: 'Failed to fetch class list' });
  }
});

/* --------------------------------------------------------------------- */
/*  GET  /api/class-sections/:code                                       */
/* --------------------------------------------------------------------- */
app.get('/api/class-sections/:code', async (req, res) => {
  try {
    const code = decodeURIComponent(req.params.code).trim().toUpperCase();
    if (!code) return res.json({});

    const { rows } = await pool.query(
      `SELECT s.section_number,
              s.type,
              s.days_of_week,
              s.start_time,
              s.end_time,
              s.location,
              s.num_students_enrolled,
              s.num_seats,
              s.instructors,
              p.section_number AS parent_section_number
         FROM sections s
    LEFT JOIN sections p ON p.id = s.parent_section_id
         JOIN courses  c ON c.id = s.course_id
        WHERE c.code     = $1
          AND c.semester = $2
        ORDER BY s.type, s.section_number`,
      [code, SEMESTER]
    );

    /* group rows by section type for the React component */
    const grouped = {};
    rows.forEach(r => {
      const typeKey = (r.type || 'other').toLowerCase();
      const days =
        Array.isArray(r.days_of_week)
          ? r.days_of_week.join('')
          : (r.days_of_week || '').replace(/[{}"]/g, '');

      if (!grouped[typeKey]) grouped[typeKey] = [];
      grouped[typeKey].push({
        id:   r.section_number,
        professor: formatProfessor(r.instructors),
        days,
        time:  timeRange(r.start_time, r.end_time),
        seats: `${r.num_students_enrolled || 0}/${r.num_seats || 0}`,
        parent_section_number: r.parent_section_number
      });
    });

    res.json(grouped);
  } catch (err) {
    console.error(`class-sections (${req.params.code}):`, err);
    res.status(500).json({ error: 'Failed to fetch class sections' });
  }
});

/* --------------------------------------------------------------------- */
/*  GET  /api/generate‑schedules‑stream   (Server‑Sent Events)            */
/* --------------------------------------------------------------------- */
app.get('/api/generate-schedules-stream', (req, res) => {
  const writeLogLine = (line) => {
    const clean = String(line).replace(/\r/g, '');
    if (!clean.trim()) 
      return;          // ignore blank lines
    console.log('[scheduler]', clean);  // keep a copy in the server log
    res.write(`event: log\ndata: ${clean}\n\n`);
  };
  /*  SSE headers  */
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection:      'keep-alive'
  });

  try {
    const payload = JSON.parse(decodeURIComponent(req.query.payload || '%7B%7D'));
    const { formattedSpots, formattedPrefs } = formatForCli(payload);
    const args = [
      '--class-spots',  formattedSpots,
      '--preferences',  formattedPrefs,
      '--semester',     SEMESTER,
      '--json'
    ];

    const cpp = spawn(schedulerPath, args, { env: process.env });

    let jsonTail = '';
    let seenJson = false;
    cpp.stdout.on('data', chunk => {
      const txt = chunk.toString();
      if (!seenJson) {
        const idx = txt.indexOf('{"schedules":');
        if (idx !== -1) {
          seenJson = true;
          // only log everything BEFORE the JSON starts
          txt.slice(0, idx).split(/\r?\n/).forEach(writeLogLine);
          jsonTail += txt.slice(idx);
        } else {
          txt.split(/\r?\n/).forEach(writeLogLine);
        }
      } else {
        jsonTail += txt;          // we’re inside the JSON block now
      }
    });


    cpp.stderr.on('data', data =>
      data.toString()
      .split(/\r?\n/)
      .forEach(l => writeLogLine(`[stderr] ${l}`))
    );

    cpp.on('close', () => {
      const start = jsonTail.indexOf('{\"schedules\":');
      const end   = jsonTail.lastIndexOf(']}') + 2;
      const raw   = start > -1 ? jsonTail.slice(start, end) : '{}';
      const compact = JSON.stringify(JSON.parse(raw));
      res.write(`event: done\ndata: ${compact}\n\n`);
      res.end();
    });
  } catch (err) {
    res.write(`event: error\\ndata: ${err.message}\\n\\n`);
    res.end();
  }
});

/* --------------------------------------------------------------------- */
/*  GET  /api/professor-ratings                                          */
/* --------------------------------------------------------------------- */
app.get('/api/professor-ratings', async (req, res) => {
  try {
    const professors = req.query.professors;
    const courseCodes = req.query.courses;
    
    if (!professors) {
      return res.status(400).json({ error: 'No professors specified' });
    }
    
    // Split the comma-separated lists
    const professorList = decodeURIComponent(professors).split(',').map(p => p.trim());
    const courseList = courseCodes ? decodeURIComponent(courseCodes).split(',').map(c => c.trim()) : [];
    
    // Use the exact same query structure that the C++ code uses
    const ratings = {};
    
    // For each professor-course combination, get ratings
    for (let i = 0; i < professorList.length; i++) {
      const profName = professorList[i];
      const courseCode = i < courseList.length ? courseList[i] : '';
      
      // Skip empty professor names
      if (!profName || profName.toLowerCase() === 'tba') {
        continue;
      }
      
      // Clean the professor name (strip curls/quotes) similar to C++ code
      let cleanName = profName.replace(/[{}"]/g, '').trim();
      
      try {
          // First try course-specific ratings if we have a course code
        let courseSpecificRatings = null;
        
        if (courseCode) {
          // Use exactly the same query as the C++ code
          const courseQuery = `
            SELECT 
              COALESCE(pcr.avg_quality, 0) as course_quality,
              COALESCE(pcr.avg_difficulty, 0) as course_difficulty,
              COALESCE(p.would_take_again_percent, 0) as would_take_again,
              COALESCE(p.avg_rating, 0) as quality,
              COALESCE(p.avg_difficulty, 0) as difficulty
            FROM professors p
            JOIN prof_course_ratings pcr ON p.id = pcr.professor_id
            WHERE 
              lower(regexp_replace(p.name, '[^A-Za-z0-9]', '', 'g')) = 
              lower(regexp_replace($1, '[^A-Za-z0-9]', '', 'g'))
              AND
              lower(regexp_replace(pcr.course_code, '[^A-Za-z0-9]', '', 'g')) = 
              lower(regexp_replace($2, '[^A-Za-z0-9]', '', 'g'))
            ORDER BY pcr.num_reviews DESC
            LIMIT 1
          `;
          
          const courseResult = await pool.query(courseQuery, [cleanName, courseCode]);
          
          if (courseResult.rows.length > 0) {
            courseSpecificRatings = courseResult.rows[0];
          }
        }
        
        // If we couldn't get course-specific ratings, get general professor ratings
        if (!courseSpecificRatings) {
          // Match the C++ implementation more closely - using ILIKE with %name%
          const professorQuery = `
            SELECT 
              avg_rating as quality, 
              avg_difficulty as difficulty, 
              would_take_again_percent as would_take_again,
              0 as course_quality,
              0 as course_difficulty
            FROM professors
            WHERE name ILIKE $1
            LIMIT 1
          `;
          
          const professorResult = await pool.query(professorQuery, [`%${cleanName}%`]);
          
          if (professorResult.rows.length > 0) {
            ratings[profName] = {
              quality: parseFloat(professorResult.rows[0].quality) || 0,
              difficulty: parseFloat(professorResult.rows[0].difficulty) || 0,
              would_take_again: parseFloat(professorResult.rows[0].would_take_again) || 0,
              course_quality: parseFloat(professorResult.rows[0].course_quality) || 0,
              course_difficulty: parseFloat(professorResult.rows[0].course_difficulty) || 0
            };
          } else {
            // If no ratings in database, use mock data
            ratings[profName] = getMockProfessorRating(profName);
          }
        } else {
          // Use course-specific ratings
          ratings[profName] = {
            quality: parseFloat(courseSpecificRatings.quality) || 0,
            difficulty: parseFloat(courseSpecificRatings.difficulty) || 0,
            would_take_again: parseFloat(courseSpecificRatings.would_take_again) || 0,
            course_quality: parseFloat(courseSpecificRatings.course_quality) || 0,
            course_difficulty: parseFloat(courseSpecificRatings.course_difficulty) || 0
          };
        }
      } catch (err) {
        console.error(`Error fetching ratings for ${profName}:`, err);
        ratings[profName] = getMockProfessorRating(profName);
      }
    }
    
    res.json(ratings);
  } catch (err) {
    console.error('professor-ratings:', err);
    res.status(500).json({ error: 'Failed to fetch professor ratings' });
  }
});

// Helper function to get mock professor ratings
function getMockProfessorRating(profName) {
  // Mock ratings database as fallback
  const mockRatingsDB = {
    'Victor Adamchik': {
      quality: 4.2,
      difficulty: 3.5,
      would_take_again: 85,
      course_quality: 4.1,
      course_difficulty: 3.6
    },
    'David Crombecque': {
      quality: 4.5,
      difficulty: 3.2,
      would_take_again: 90,
      course_quality: 4.3,
      course_difficulty: 3.1
    },
    'Jesus Fuentes': {
      quality: 4.0,
      difficulty: 3.0,
      would_take_again: 80,
      course_quality: 3.9,
      course_difficulty: 3.2
    },
    'Andrew Goodney': {
      quality: 4.3,
      difficulty: 2.8,
      would_take_again: 88,
      course_quality: 4.2,
      course_difficulty: 2.9
    },
    'Aaron Cote': {
      quality: 3.9,
      difficulty: 3.3,
      would_take_again: 82,
      course_quality: 4.0,
      course_difficulty: 3.4
    },
    'Marco Papa': {
      quality: 4.1,
      difficulty: 3.1,
      would_take_again: 85,
      course_quality: 4.0,
      course_difficulty: 3.2
    },
    'Michael Shindler': {
      quality: 4.4,
      difficulty: 3.3,
      would_take_again: 87,
      course_quality: 4.3,
      course_difficulty: 3.4
    },
    'Tracie Mayfield': {
      quality: 4.6,
      difficulty: 2.9,
      would_take_again: 92,
      course_quality: 4.5,
      course_difficulty: 3.0
    }
  };
  
  return mockRatingsDB[profName] || {
    quality: 3.5,
    difficulty: 3.0,
    would_take_again: 70,
    course_quality: 3.5,
    course_difficulty: 3.0
  };
}

/* --------------------------------------------------------------------- */
/*  GET  /api/mock-professor                                             */
/* --------------------------------------------------------------------- */
app.get('/api/mock-professor', (req, res) => {
  console.log('Mock professor API hit');
  const mockData = {
    'Tracie Mayfield': {
      quality: 4.6,
      difficulty: 2.9,
      would_take_again: 92,
      course_quality: 4.5,
      course_difficulty: 3.0
    }
  };
  res.json(mockData);
});

/* --------------------------------------------------------------------- */
/*  POST /api/generate‑schedules   (existing JSON endpoint)               */
/* --------------------------------------------------------------------- */
app.post('/api/generate-schedules', async (req, res) => {
  /* left unchanged – use the body‑based flow as you had before */
  res.status(404).json({ error: 'Not re‑implemented in this snippet.' });
});

/* --------------------------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`=================================================================`);
  console.log(`✅ Server listening on http://localhost:${PORT}`);
  console.log(`=================================================================`);
  console.log('Available routes:');
  console.log(`- GET /api/test                     (test server connection)`);
  console.log(`- GET /api/available-classes        (get list of classes)`);
  console.log(`- GET /api/class-sections/:code     (get sections for a class)`);
  console.log(`- GET /api/professor-ratings        (get professor ratings)`);
  console.log(`- GET /api/generate-schedules-stream (generate schedules via SSE)`);
  console.log(`- POST /api/auth/signup             (create a new user account)`);
  console.log(`- POST /api/auth/login              (login with email/password)`);
  console.log(`- GET /api/auth/profile             (get user profile, requires token)`);
  console.log(`- POST /api/auth/forgot-password    (request a password reset)`);
  console.log(`- POST /api/auth/reset-password     (reset password with token)`);
  console.log(`- GET /api/schedules/user           (get user's saved schedules, requires token)`);
  console.log(`- POST /api/schedules               (save a new schedule, requires token)`);
  console.log(`- GET /api/schedules/:id            (get a specific schedule, requires token)`);
  console.log(`- PUT /api/schedules/:id            (update a saved schedule, requires token)`);
  console.log(`- DELETE /api/schedules/:id         (delete a saved schedule, requires token)`);
  console.log(`=================================================================`);
});
/* ────────────────────────────────────────────────────────────────────── */

/* ---------- helpers for the SSE route ---------- */
function formatForCli({ classSpots = [], preferences = {} }) {
  /* class spots */
  const formattedSpots = classSpots
    .map(spot => spot.classes
      .filter(c => c.classCode && c.classCode.trim())
      .map(c => c.classCode.trim())
      .join(','))
    .filter(Boolean)
    .join('|');

  /* prefs */
  const {
    timeOfDay = [], daysOff = [], classLength = '',
    avoidLabs = false, avoidDiscussions = false, excludeFullSections = true
  } = preferences;

  const formattedPrefs = [
    timeOfDay.length ? timeOfDay.join(',') : 'no-preference',
    daysOff.length   ? daysOff.join(',')   : 'none',
    classLength || 'no-preference',
    avoidLabs          ? '1' : '0',
    avoidDiscussions   ? '1' : '0',
    excludeFullSections !== false ? '1' : '0'
  ].join('|');

  return { formattedSpots, formattedPrefs };
}


