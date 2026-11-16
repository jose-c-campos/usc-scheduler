// Set env vars before any require() so pool connections pick them up
process.env.USC_DB_HOST     = process.env.USC_DB_HOST     || 'localhost';
process.env.USC_DB_PORT     = process.env.USC_DB_PORT     || '5432';
process.env.USC_DB_NAME     = process.env.USC_DB_NAME     || 'usc_sched_test';
process.env.USC_DB_USER     = process.env.USC_DB_USER     || 'ci_user';
process.env.USC_DB_PASSWORD = process.env.USC_DB_PASSWORD || 'ci_password';
process.env.JWT_SECRET      = process.env.JWT_SECRET      || 'ci-test-jwt-secret';
process.env.NODE_ENV        = 'test';
// Deliberately NOT the server's built-in fallback ('20253'), so the
// active-semester test proves the env var drives the value.
process.env.SEMESTER        = '20261';

const request = require('supertest');
const { app, pool } = require('../server');

afterAll(async () => {
  await pool.end();
});

// ─── Health ───────────────────────────────────────────────────────────────────

describe('Health check', () => {
  it('GET /api/test returns 200 with status message', async () => {
    const res = await request(app).get('/api/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('API is working!');
  });
});

// ─── Active semester ──────────────────────────────────────────────────────────

describe('Active semester', () => {
  it('GET /api/active-semester returns the SEMESTER env var', async () => {
    const res = await request(app).get('/api/active-semester');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ semester: '20261' });
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  const email = `ci_test_${Date.now()}@example.com`;
  let token;

  it('POST /api/auth/signup creates a user and returns a token', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'CI Test User', email, password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe(email);
    token = res.body.token;
  });

  it('POST /api/auth/signup rejects duplicate email with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'CI Test User', email, password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/login succeeds with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('POST /api/auth/login returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login returns 401 for unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/profile returns 401 with no token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/profile returns 403 for an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', 'Bearer notavalidtoken');
    expect(res.status).toBe(403);
  });

  it('GET /api/auth/profile returns user data with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });
});

// ─── Schedule auth guard ──────────────────────────────────────────────────────

describe('Schedule routes (auth guard)', () => {
  it('GET /api/schedules/user returns 401 without a token', async () => {
    const res = await request(app).get('/api/schedules/user');
    expect(res.status).toBe(401);
  });

  it('POST /api/schedules returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: 'My Schedule', semester: '20253', schedule_data: {} });
    expect(res.status).toBe(401);
  });
});
