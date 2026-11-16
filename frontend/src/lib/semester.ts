import { useEffect, useState } from 'react';
import api from '../services/api';

/*
 * The active semester belongs to the API: it is the `SEMESTER` env var, served
 * at GET /api/active-semester, and it is the same value the API uses to look
 * up classes and to run the C++ engine. The frontend never hardcodes a term
 * code, so changing semester means setting `SEMESTER` in .env and restarting
 * the api container. No frontend rebuild.
 */

// USC term codes are YYYYS, where S is 1 = Spring, 2 = Summer, 3 = Fall.
const TERM_CODE = /^\d{5}$/;
const SEASONS: Record<string, string> = { '1': 'Spring', '2': 'Summer', '3': 'Fall' };

// One request per page load, shared by every caller (and by StrictMode's
// double-mount in dev). It is cleared on failure so the next caller, such as
// a press of the save button, retries instead of reusing the error.
let inflight: Promise<string> | null = null;

export function fetchActiveSemester(): Promise<string> {
  if (!inflight) {
    inflight = api
      .get<{ semester?: unknown }>('/api/active-semester')
      .then(({ data }) => {
        const semester = data?.semester;
        if (typeof semester !== 'string' || !TERM_CODE.test(semester)) {
          throw new Error(`Unexpected semester from API: ${JSON.stringify(semester)}`);
        }
        return semester;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

/** '20261' → 'Spring 2026'. Returns the code unchanged if the suffix is not a known season. */
export function formatSemester(code: string): string {
  const season = TERM_CODE.test(code) ? SEASONS[code[4]] : undefined;
  return season ? `${season} ${code.slice(0, 4)}` : code;
}

/**
 * The active semester code, or null while loading or if the API is unreachable.
 *
 * Use it for display only. Anything that stores a semester should call
 * `await fetchActiveSemester()` and handle the rejection, so a stale or guessed
 * value can never be written.
 */
export function useActiveSemester(): string | null {
  const [semester, setSemester] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchActiveSemester()
      .then((s) => {
        if (!cancelled) setSemester(s);
      })
      .catch((err) => console.error('Could not load the active semester:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  return semester;
}
