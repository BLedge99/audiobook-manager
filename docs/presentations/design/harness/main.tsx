// Era capture harness: mocks the fetch layer with canned data, then loads the
// client module tree of any extracted client/ onto this port. Usage:
//   git archive -o /tmp/era.tar <sha> client && tar -xf /tmp/era.tar -C .
//   cp <this harness>/* client/scratch-era-ish  (see README)
//   cd scratch && npx vite dev --port 4560
// Tabs via ?tab= library|browse|discover|favourites|server-library (current app).
import { BOOKS, ROOTS } from './fixtures';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

window.localStorage.setItem('profileId', '1');
window.localStorage.setItem('serverUrl', 'http://books.home.arpa:3000');

const GENRES = [
  { id: 1, slug: 'mystery', name: 'Mystery', parentId: null, isCatchAll: false, count: 2, children: [] },
  { id: 2, slug: 'classics', name: 'Classics', parentId: null, isCatchAll: false, count: 2, children: [] },
  { id: 3, slug: 'horror', name: 'Horror', parentId: null, isCatchAll: false, count: 2, children: [] },
  { id: 4, slug: 'science-fiction', name: 'Science Fiction', parentId: null, isCatchAll: false, count: 2, children: [] },
];

const DISCOVER = {
  status: 'ok',
  recommendations: [
    { title: 'The Hound of the Baskervilles', author: 'Arthur Conan Doyle', narrators: ['LibriVox volunteers'], description: 'A moorland curse falls on the Baskerville family; Holmes is summoned.', coverUrl: null, genres: ['Mystery'], seriesName: 'Sherlock Holmes', publisher: 'LibriVox', publishedYear: 1902, provider: 'openlibrary', providerKey: 'hound', score: 0.91, reason: 'Like A Study in Scarlet' },
    { title: 'Dracula', author: 'Bram Stoker', narrators: ['LibriVox volunteers'], description: 'Jonathan Harker travels east and meets the Count.', coverUrl: null, genres: ['Horror'], seriesName: null, publisher: 'LibriVox', publishedYear: 1897, provider: 'openlibrary', providerKey: 'dracula', score: 0.84, reason: 'Like Frankenstein' },
    { title: 'The Invisible Man', author: 'H. G. Wells', narrators: ['LibriVox volunteers'], description: 'A stranger takes rooms at the inn at Iping.', coverUrl: null, genres: ['Science Fiction'], seriesName: null, publisher: 'LibriVox', publishedYear: 1897, provider: 'openlibrary', providerKey: 'invisible', score: 0.79, reason: 'Like The Time Machine' },
  ],
  seedTitle: 'A Study in Scarlet',
  seededFrom: { genres: ['Mystery'], authors: ['Arthur Conan Doyle'], series: ['Sherlock Holmes'], bookCount: 2 },
  page: 1,
  pageSize: 5,
  hasMore: false,
  total: 3,
};

const TAGSUITE = { id: 1, title: 'The Art of War', subtitle: null, author: 'Sun Tzu', description: '', publisher: null, publishedYear: null, language: null, unabridged: false, isbn: null, series: null, genres: [], contributors: [], metadataSource: null, enrichmentStatus: null, overriddenFields: [] };

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.startsWith('http') ? new URL(url).pathname : url;

  if (path === '/api/audiobooks' && (!init || !init.method || init.method === 'GET')) return json(BOOKS);
  if (path === '/api/server-library') return json(BOOKS.map((b) => ({ ...b, inLibrary: true })));
  if (path === '/api/config') return json({ accountExperience: 'household', oauthProviders: [] });
  if (path === '/api/me') return json({ id: 1, name: 'Sam', color: '#ff5c8a', role: 'member' });
  if (path === '/api/auth/session') return json({ profile: { id: 1, name: 'Sam', color: '#ff5c8a' }, role: 'member', expiresAt: '2026-12-17T00:00:00.000Z' });
  if (path === '/api/profiles') return json([{ id: 1, name: 'Sam', color: '#ff5c8a' }, { id: 2, name: 'Alex', color: '#f6c453' }]);
  if (path === '/api/library-roots') return json(ROOTS);
  if (path === '/api/genres') return json(GENRES);
  if (path === '/api/tags') return json([]);
  if (path === '/api/history') return json([]);
  if (path === '/api/favourites') return json(BOOKS.filter((b) => b.favourited));
  if (path === '/api/favourites/ids') return json(BOOKS.filter((b) => b.favourited).map((b) => b.id));
  if (path === '/api/wishlist') return json([]);
  if (path === '/api/discover/for-me') return json(DISCOVER);
  if (path.startsWith('/api/discover/similar')) return json({ ...DISCOVER, seedTitle: 'The Sign of the Four' });
  if (path.startsWith('/api/enrichment/review-queue')) return json([]);
  if (path.startsWith('/api/enrichment')) return json({ runId: null, status: 'idle', queued: 0, processed: 0, applied: 0, review: 0, failed: 0, skipped: 0, message: null });
  if (path.startsWith('/api/auth/sessions')) return json({ devices: [{ key: 'dev-pixel4a', label: 'Pixel 4a', createdAt: '2026-10-20T09:00:00.000Z', lastActiveAt: '2026-11-17T09:12:00.000Z', current: true, sessions: 2 }] });
  if (path.startsWith('/api/auth/devices')) return json({ devices: [{ id: 'dev-1', label: 'Pixel 4a' }] });
  if (path.startsWith('/api/auth')) return json({});
  if (path.startsWith('/api/audiobooks/') && path.endsWith('/cover')) return new Response('not found', { status: 404 });
  if (path.startsWith('/api/audiobooks/') && path.endsWith('/progress')) return json({ position: 0, completed: false, lastPlayed: null });
  if (path.startsWith('/api/audiobooks/') && path.endsWith('/tags')) return json(TAGSUITE);
  if (init?.method && init.method !== 'GET') return json({ ok: true });
  return json([]);
}) as typeof fetch;

// Now load the client module tree with the mock in place.
await import('./client/src/main.tsx');
