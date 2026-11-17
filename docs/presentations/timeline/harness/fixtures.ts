// Fixtures for the era capture harness. Public-domain LibriVox-style records,
// written for display only. No real library data.
export const ROOTS = [
  { id: 1, path: 'D:\\Audiobooks', label: 'My audiobooks', scanState: { status: 'complete', filesFound: 412, message: null } },
  { id: 2, path: 'D:\\LibriVox', label: 'LibriVox downloads', scanState: { status: 'idle', filesFound: 60, message: null } },
];

let id = 0;
const book = (title: string, author: string, narrator: string, duration: number, genres: string[], series = null, seriesPosition = null, progress: number | null = null) => {
  id += 1;
  const tracks = Math.ceil(duration / 1800);
  return {
    id,
    title,
    author,
    narrator,
    duration,
    fileFormat: 'mp3',
    chapters: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    progress: progress === null ? null : { position: Math.floor(duration * progress), completed: progress >= 1, lastPlayed: '2026-10-17T09:00:00.000Z' },
    enrichmentStatus: 'applied',
    metadataSource: 'embedded',
    genres: genres.map((name, i) => ({ id: i + 1, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, parentId: null, source: 'provider' })),
    series,
    seriesPosition,
    favourited: id % 3 === 0,
    tracks: Array.from({ length: tracks }, (_, i) => ({ id: id * 100 + i, title: `Part ${i + 1}`, duration: Math.min(1800, duration - i * 1800), trackNumber: i + 1 })),
  };
};

export const BOOKS = [
  book('The Art of War', 'Sun Tzu', 'LibriVox volunteers', 11520, ['Philosophy'], null, null, 1),
  book('Pride and Prejudice', 'Jane Austen', 'LibriVox volunteers', 36960, ['Classics'], null, null, 0.42),
  book('A Study in Scarlet', 'Arthur Conan Doyle', 'LibriVox volunteers', 14400, ['Mystery'], { id: 1, name: 'Sherlock Holmes' }, 1, 0.63),
  book('The Sign of the Four', 'Arthur Conan Doyle', 'LibriVox volunteers', 13500, ['Mystery'], { id: 1, name: 'Sherlock Holmes' }, 2, null),
  book('The Time Machine', 'H. G. Wells', 'LibriVox volunteers', 12960, ['Science Fiction'], null, null, null),
  book('Flatland', 'Edwin A. Abbott', 'LibriVox volunteers', 12600, ['Science Fiction', 'Satire'], null, null, 0.15),
  book('Dracula', 'Bram Stoker', 'LibriVox volunteers', 66600, ['Horror'], null, null, null),
  book('Frankenstein', 'Mary Shelley', 'LibriVox volunteers', 32400, ['Horror', 'Classics'], null, null, null),
];

// Local cover cache look-up: no covers in public/ for fixture books, so the
// grid's onError path resolves to the era's own placeholder-cover.svg.
