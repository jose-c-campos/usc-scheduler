-- Scheduling data tables (ETL-owned): courses, sections, professors,
-- prof_course_ratings, reviews.
--
-- RECONSTRUCTED, NOT DUMPED FROM PRODUCTION. These tables were created by hand
-- on the production box and no DDL for them was ever committed. This file is
-- rebuilt from the code that reads and writes them:
--   - ingestion/database/load_courses.py  (courses, sections)
--   - ingestion/database/load_profs.py    (professors, reviews, prof_course_ratings)
--   - server/server.js, scheduler/database.cpp (read queries)
-- Verified 2026-11-13: courses/sections by loading the full Fall 2025 catalog
-- with load_courses.py (4,769 courses, 9,562 sections) and running the app and
-- the API test suite against it. professors/reviews/prof_course_ratings are
-- checked against the SQL in load_profs.py and server.js only; load_profs.py
-- was not run (it calls RateMyProfessors). Column types may differ from
-- production where the code doesn't pin them down (e.g. NUMERIC vs REAL).
-- Before relying on this to rebuild prod, diff it against
-- `pg_dump --schema-only` of the production DB.
--
-- Not mounted by docker-compose.yml (only create_users_table.sql is), so it
-- has no effect on any existing database. Safe to re-run: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS courses (
  id       SERIAL PRIMARY KEY,
  code     TEXT NOT NULL,              -- e.g. 'CSCI 102'
  title    TEXT,
  semester TEXT NOT NULL,              -- USC term code, e.g. '20253'
  UNIQUE (code, semester)              -- load_courses.py upsert target
);

CREATE TABLE IF NOT EXISTS sections (
  id                    SERIAL PRIMARY KEY,
  course_id             INTEGER NOT NULL REFERENCES courses(id),
  section_number        TEXT NOT NULL,
  units                 NUMERIC[],     -- [3.0], or [min, max] for a range
  type                  TEXT,          -- 'Lecture', 'Lab', 'Discussion', 'Quiz', ...
  schedule              TEXT,          -- raw schedule string from the scraper
  location              TEXT,
  d_clearance           BOOLEAN DEFAULT false,
  days_of_week          TEXT[],        -- e.g. {Mon,Wed}; parsed by the C++ engine
  start_time            TEXT,          -- e.g. '10:00am'
  end_time              TEXT,
  instructors           TEXT[],
  num_students_enrolled INTEGER,
  num_seats             INTEGER,
  bundle_key            TEXT,
  parent_section_id     INTEGER REFERENCES sections(id), -- set for labs/discussions
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (course_id, section_number)   -- load_courses.py upsert target
);

CREATE TABLE IF NOT EXISTS professors (
  id                       SERIAL PRIMARY KEY,
  name                     TEXT NOT NULL UNIQUE, -- load_profs.py upsert target
  rmp_id                   TEXT,
  rmp_school_id            TEXT,
  rmp_school_name          TEXT,
  avg_rating               NUMERIC,    -- 0-5
  avg_difficulty           NUMERIC,    -- 0-5
  would_take_again_percent NUMERIC,    -- 0-100
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Denormalized: recomputed from reviews on every load_profs.py run.
CREATE TABLE IF NOT EXISTS prof_course_ratings (
  professor_id   INTEGER REFERENCES professors(id),
  course_code    TEXT,
  avg_quality    NUMERIC,
  avg_difficulty NUMERIC,
  num_reviews    INTEGER,
  UNIQUE (professor_id, course_code)
);

CREATE TABLE IF NOT EXISTS reviews (
  professor_id      INTEGER REFERENCES professors(id),
  course_code       TEXT,              -- class tag from RMP; may be null
  quality_rating    NUMERIC,
  difficulty_rating NUMERIC,
  review_text       TEXT,
  date              TEXT,              -- as returned by RMP
  UNIQUE (professor_id, date, review_text)
);

-- Indexes the production DB is documented to have (created by hand there).
CREATE INDEX IF NOT EXISTS idx_courses_code        ON courses (code);
CREATE INDEX IF NOT EXISTS idx_sections_course_id  ON sections (course_id);
CREATE INDEX IF NOT EXISTS idx_professors_name     ON professors (name);
