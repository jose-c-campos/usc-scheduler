// Unit tests for formatProfessor (server.js): the instructor label that
// /api/class-sections/:code gives each section. No database needed:
// requiring server.js builds the pg pool, but it only connects on a query.
const { formatProfessor, pool } = require('../server');

afterAll(async () => {
  await pool.end();
});

describe('formatProfessor', () => {
  // A section USC hasn't assigned an instructor to must read 'TBA',
  // never '' (which made the dropdown read ", MW, 5:00 pm…").
  it.each([
    ['null', null],
    ['an empty array', []],
    ['an array holding one blank name', ['']],
    ["the empty-array text '{}'", '{}'],
  ])('returns TBA for %s', (_label, raw) => {
    expect(formatProfessor(raw)).toBe('TBA');
  });

  it('returns a single instructor unchanged', () => {
    expect(formatProfessor(['Jane Doe'])).toBe('Jane Doe');
  });

  it('joins two instructors with a comma', () => {
    expect(formatProfessor(['Jane Doe', 'John Roe'])).toBe('Jane Doe, John Roe');
  });

  it('drops a blank entry next to a real name', () => {
    expect(formatProfessor(['', 'Jane Doe'])).toBe('Jane Doe');
  });
});
