import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import { bungie } from '../helpers/bungie';

// Runs in each worker BEFORE test files (and their imports) load, so lib/db/client
// reads the container URL when its Pool is constructed.
process.env.DATABASE_URL = inject('databaseUrl');

// MSW lifecycle for Bungie — unhandled Bungie calls fail loudly.
beforeAll(() => bungie.listen({ onUnhandledRequest: 'error' }));
afterEach(() => bungie.resetHandlers());
afterAll(() => bungie.close());
