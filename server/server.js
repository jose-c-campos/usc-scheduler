/* ─────────────────────────────  server.js  ───────────────────────────── */
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs');
const { spawn }  = require('child_process');
const { Pool }   = require('pg');

const app       = express();
const PORT      = process.env.PORT || 3001;
const SEMESTER  = '20253';                                              // ← adjust if needed
const schedulerPath = path.resolve(__dirname, '../scheduler/build/scheduler');

/* ───────── middleware ───────── */
app.use(cors());
app.use(bodyParser.json());

/* ───────── Postgres pool ───────── */
const pool = new Pool({
  host:     process.env.USC_DB_HOST     || 'localhost',
  port:     process.env.USC_DB_PORT     || 5432,
  database: process.env.USC_DB_NAME     || 'usc_sched',
  user:     process.env.USC_DB_USER     || 'REDACTED',
  password: process.env.USC_DB_PASSWORD || 'REDACTED'
});

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
/*  POST /api/generate‑schedules   (existing JSON endpoint)               */
/* --------------------------------------------------------------------- */
app.post('/api/generate-schedules', async (req, res) => {
  /* left unchanged – use the body‑based flow as you had before */
  res.status(404).json({ error: 'Not re‑implemented in this snippet.' });
});

/* --------------------------------------------------------------------- */
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
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




// import express  from 'express';
// import path     from 'path';
// import { spawn } from 'child_process';
// import fs       from 'fs/promises';

// const express = require('express');
// const { exec } = require('child_process');
// const bodyParser = require('body-parser');
// const cors = require('cors');
// const path = require('path');
// const fs = require('fs');
// const { promisify } = require('util');
// const writeFileAsync = promisify(fs.writeFile);
// const execAsync = promisify(exec);

// const schedulerPath = path.join(__dirname, '../scheduler/build/scheduler');
// const app = express();
// const PORT = process.env.PORT || 3001;

// // Middleware
// app.use(express.json());
// app.use(cors());
// app.use(bodyParser.json());

// // API endpoint for schedule generation
// app.post('/api/generate-schedules', async (req, res) => {
//   const { classSpots, preferences } = req.body;

//   console.log('Received request for schedule generation:');
//   console.log('Class spots:', JSON.stringify(classSpots));
//   console.log('Preferences:', JSON.stringify(preferences));

//   if (!classSpots || classSpots.length === 0) {
//     return res.status(400).json({ error: 'No class spots provided' });
//   }

//   // Format the input for the C++ program: each spot is a group, separated by '|'
//   const formattedSpots = classSpots
//     .map(spot =>
//       spot.classes
//         .filter(cls => cls.classCode && cls.classCode.trim() !== "")
//         .map(cls => cls.classCode.trim())
//         .join(',')
//     )
//     .filter(group => group.length > 0)
//     .join('|');

//   console.log('Properly formatted class spots:', formattedSpots);

//   // Format preferences
//   const formattedPreferences = [
//     Array.isArray(preferences.timeOfDay) && preferences.timeOfDay.length ? preferences.timeOfDay.join(',') : 'no-preference',
//     Array.isArray(preferences.daysOff) && preferences.daysOff.length ? preferences.daysOff.join(',') : 'none',
//     preferences.classLength === 'shorter-frequent' ? 'shorter' :
//       (preferences.classLength === 'longer-less-frequent' ? 'longer' : 'no-preference'),
//     preferences.avoidLabs ? '1' : '0',
//     preferences.avoidDiscussions ? '1' : '0',
//     preferences.excludeFullSections !== false ? '1' : '0'
//   ].join('|');

//   console.log('Sending preferences to scheduler:', formattedPreferences);

//   const semester = "20253";

//   // Check if scheduler executable exists
//   if (!fs.existsSync(schedulerPath)) {
//     console.error(`Scheduler executable not found at: ${schedulerPath}`);
//     return res.status(500).json({ error: 'Scheduler executable not found' });
//   }

//   // Check if scheduler is executable
//   try {
//     fs.accessSync(schedulerPath, fs.constants.X_OK);
//   } catch (err) {
//     console.error(`Scheduler is not executable: ${err.message}`);
//     return res.status(500).json({ error: 'Scheduler is not executable' });
//   }

//   // Build the shell command
//   const command = `./build/scheduler --class-spots "${formattedSpots}" --preferences "${formattedPreferences}" --semester ${semester} --json`;
//   console.log('Executing command:', command);

//   try {
//     // Use the new helper function
//     const { stdout, stderr } = await executeSchedulerWithScript(
//       command,
//       formattedSpots,
//       formattedPreferences,
//       semester
//     );
//     console.log('Scheduler stderr:', stderr);

//     try {
//       // Simplified JSON extraction
//       const jsonStartIndex = stdout.indexOf('{"schedules":');
//       if (jsonStartIndex === -1) {
//         throw new Error('No schedules data found in output');
//       }

//       const jsonStr = stdout.substring(jsonStartIndex);
//       const endBracketPos = findMatchingBracket(jsonStr);
//       const cleanJson = jsonStr.substring(0, endBracketPos + 1);

//       console.log('Extracted JSON (first 100 chars):', cleanJson.substring(0, 10000));
//       const schedulesData = JSON.parse(cleanJson);
//       res.json(schedulesData);
//     } catch (error) {
//       console.error('Error parsing scheduler output:', error);
//       res.status(500).json({
//         error: 'Error parsing scheduler output',
//         details: error.message,
//         rawOutput: stdout.substring(0, 500)
//       });
//     }
//   } catch (error) {
//     console.error('Error executing scheduler:', error);

//     // Fallbacks for specific errors
//     if (error.code === 139 || error.stderr?.includes('Segmentation fault')) {
//       console.log('Scheduler crashed with segmentation fault, using fallback');
//       const allClasses = formattedSpots.split('|').map(s => s.split(',')).flat();
//       const fallbackSchedules = createFallbackSchedules(allClasses);
//       return res.json({ schedules: fallbackSchedules });
//     }

//     if (error.code === 127 || error.stderr?.includes('No such file or directory')) {
//       console.log('Scheduler executable not found, using fallback');
//       const allClasses = formattedSpots.split('|').map(s => s.split(',')).flat();
//       const fallbackSchedules = createFallbackSchedules(allClasses);
//       return res.json({ schedules: fallbackSchedules });
//     }

//     res.status(500).json({
//       error: 'Error executing scheduler',
//       details: error.message
//     });
//   }
// });

// // Get available classes
// app.get('/api/available-classes', async (req, res) => {
//   try {
//     const { Pool } = require('pg');
//     const pool = new Pool({
//       user: 'REDACTED',
//       host: 'localhost',
//       database: 'usc_sched',
//       password: 'REDACTED',
//       port: 5432,
//     });

//     const result = await pool.query(
//       "SELECT DISTINCT code FROM courses WHERE semester = '20253' ORDER BY code"
//     );

//     res.json({ classes: result.rows.map(row => row.code) });
//   } catch (error) {
//     console.error('Error fetching available classes:', error);
//     res.status(500).json({ error: 'Failed to fetch class list' });
//   }
// });

// // Get sections for a specific class
// app.get('/api/class-sections/:classCode', async (req, res) => {
//   try {
//     const { classCode } = req.params;
//     const { Pool } = require('pg');
//     const pool = new Pool({
//       user: 'REDACTED',
//       host: 'localhost',
//       database: 'usc_sched',
//       password: 'REDACTED',
//       port: 5432,
//     });

//     const result = await pool.query(
//       `SELECT s.id, s.section_number, s.type, s.days_of_week, 
//               s.start_time, s.end_time, s.location, 
//               s.num_students_enrolled, s.num_seats, 
//               s.instructors, p.section_number AS parent_section_number
//        FROM sections s
//        LEFT JOIN sections p ON s.parent_section_id = p.id
//        JOIN courses c ON s.course_id = c.id
//        WHERE c.code = $1 AND c.semester = '20253'
//        ORDER BY s.type, s.section_number`,
//       [classCode]
//     );

//     // Group sections by type
//     const sectionsByType = {};
//     result.rows.forEach(section => {
//       const type = section.type.toLowerCase();
//       if (!sectionsByType[type]) {
//         sectionsByType[type] = [];
//       }

//       sectionsByType[type].push({
//         id: section.section_number,
//         professor: formatProfessorName(section.instructors) || 'Unknown',
//         days: section.days_of_week ?
//           (typeof section.days_of_week === 'string' ?
//             section.days_of_week.replace(/{|}/g, '') :
//             String(section.days_of_week)) : '',
//         time: `${section.start_time || 'TBA'} - ${section.end_time || 'TBA'}`,
//         seats: `${section.num_students_enrolled || 0}/${section.num_seats || 0}`,
//         parent_section_number: section.parent_section_number
//       });
//     });

//     res.json(sectionsByType);
//   } catch (error) {
//     console.error(`Error fetching sections for ${req.params.classCode}:`, error);
//     res.status(500).json({ error: 'Failed to fetch class sections' });
//   }
// });

// app.get('/api/generate-schedules-stream', async (req, res) => {
//   res.writeHead(200, {
//     'Content-Type':  'text/event-stream',
//     'Cache-Control': 'no-cache',
//     Connection:      'keep-alive'
//   });

//   const payload          = JSON.parse(req.query.payload);
//   const { formattedSpots, formattedPrefs } = formatForCli(payload);
//   const semester         = '20253';  // or use req.query.semester

//   const cpp = spawn(
//     schedulerPath,
//     [
//       '--class-spots', `"${formattedSpots}"`,
//       '--preferences', `"${formattedPrefs}"`,
//       '--semester', semester,
//       '--json',
//       '--db-name',      process.env.USC_DB_NAME,
//       '--db-user',      process.env.USC_DB_USER,
//       '--db-password',  process.env.USC_DB_PASSWORD,
//       '--db-host',      process.env.USC_DB_HOST,
//       '--db-port',      process.env.USC_DB_PORT
//     ],
//     { shell: true, env: process.env }
//   );

//   let jsonTail = '';

//   cpp.stdout.on('data', chunk => {
//     const txt = chunk.toString();
//     // forward every line so the client can parse it
//     txt.split(/\r?\n/).forEach(line => {
//       if (line.trim().length) {
//         res.write(`event: log\ndata: ${line.replace(/[\r\n]+/g, ' ')}\n\n`);
//       }
//     });

//     // accumulate possible JSON
//     if (txt.includes('{"schedules":')) jsonTail += txt;
//   });

//   cpp.stderr.on('data', err => {
//     res.write(`event: error\ndata: ${err.toString()}\n\n`);
//   });

//   cpp.on('close', () => {
//     const start = jsonTail.indexOf('{"schedules":');
//     const end   = jsonTail.lastIndexOf(']}') + 2;
//     const json  = jsonTail.slice(start, end);
//     res.write(`event: done\ndata: ${json}\n\n`);
//     res.end();
//   });
// });

// // Start server
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

// function formatForCli({ classSpots, preferences }) {
//   const formattedSpots = classSpots
//     .map(s => s.classes.map(c => c.classCode.trim()).join('|'))
//     .filter(Boolean)
//     .join('|');

//   const {
//     timeOfDay, daysOff, classLength,
//     avoidLabs, avoidDiscussions, excludeFullSections
//   } = preferences;

//   const formattedPrefs = [
//     timeOfDay.length ? timeOfDay.join(',') : 'no-preference',
//     daysOff.length   ? daysOff.join(',')   : 'none',
//     classLength      || 'no-preference',
//     avoidLabs        ? '1' : '0',
//     avoidDiscussions ? '1' : '0',
//     excludeFullSections ? '1' : '0'
//   ].join('|');

//   return { formattedSpots, formattedPrefs };
// }

// // Helper: Execute scheduler with a temp script
// async function executeSchedulerWithScript(command, classCodesParam, preferencesParam, semesterParam) {
//   const scriptPath = path.join(__dirname, 'temp_scheduler_runner.sh');
//   const absoluteSchedulerPath = path.resolve(__dirname, '../scheduler/build/scheduler');
//   console.log('Using absolute scheduler path:', absoluteSchedulerPath);

//   const scriptContent = `#!/bin/bash
//   export USC_DB_NAME=usc_sched
//   export USC_DB_USER=REDACTED
//   export USC_DB_PASSWORD=REDACTED
//   export USC_DB_HOST=localhost
//   export USC_DB_PORT=5432

//   "${absoluteSchedulerPath}" --class-spots "${classCodesParam}" --preferences "${preferencesParam}" --semester ${semesterParam} --json --db-name usc_sched --db-user REDACTED --db-password REDACTED --db-host localhost --db-port 5432 2>&1
//   `;

//   try {
//     await writeFileAsync(scriptPath, scriptContent, { mode: 0o755 });
//     console.log('Created temporary script:', scriptPath);
//     console.log('Script content:', scriptContent);

//     const { stdout, stderr } = await execAsync(`bash ${scriptPath}`, { maxBuffer: 1024 * 1024 * 10 });
//     return { stdout, stderr };
//   } catch (error) {
//     console.error('Error executing scheduler script:', error);
//     throw error;
//   } finally {
//     fs.unlink(scriptPath, err => {
//       if (err) console.error('Error cleaning up script file:', err);
//     });
//   }
// }

// // Utility: Format professor names
// function formatProfessorName(profName) {
//   if (typeof profName === 'string' && (profName.startsWith('{') || profName.startsWith('['))) {
//     try {
//       const parsed = JSON.parse(profName);
//       if (Array.isArray(parsed)) {
//         return parsed.join(', ');
//       }
//       if (typeof parsed === 'object') {
//         return Object.values(parsed).join(', ');
//       }
//       return parsed.toString();
//     } catch (e) {
//       return profName.replace(/[{}[\]"]/g, '');
//     }
//   }
//   return profName;
// }

// // Utility: Find matching bracket for JSON extraction
// function findMatchingBracket(jsonStr) {
//   let bracketCount = 0;
//   let inQuotes = false;

//   for (let i = 0; i < jsonStr.length; i++) {
//     const char = jsonStr[i];
//     if (char === '"' && jsonStr[i - 1] !== '\\') {
//       inQuotes = !inQuotes;
//     }
//     if (!inQuotes) {
//       if (char === '{') bracketCount++;
//       else if (char === '}') {
//         bracketCount--;
//         if (bracketCount === 0) {
//           return i;
//         }
//       }
//     }
//   }
//   return -1;
// }

// // Utility: Fallback schedule
// function createFallbackSchedules(classCodes) {
//   return [
//     {
//       id: 1,
//       score: 3.5,
//       avgProfRating: 4.2,
//       avgDifficulty: 2.8,
//       classes: classCodes.map(code => ({
//         code,
//         sections: [
//           {
//             type: "Lecture",
//             days: "Mon, Wed",
//             time: "10:00 am-11:50 am",
//             instructor: "Staff",
//             section_number: "12345",
//             location: "TBA",
//             seats_registered: 30,
//             seats_total: 50,
//             ratings: {
//               quality: 4.0,
//               difficulty: 3.0,
//               would_take_again: 80.0
//             }
//           }
//         ]
//       }))
//     }
//   ];
// }