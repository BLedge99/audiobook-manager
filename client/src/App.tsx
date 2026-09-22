import { useState, useEffect } from 'react';
import { BookOpen, Home, Library, Search } from 'lucide-react';

// Types matching our Prisma schema
interface MediaItem {
  id: number;
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverImagePath?: string;
  duration: number;
}

// Mock data for development until API is connected
const mockAudiobooks: MediaItem[] = [
  { id: 1, title: 'Dune', author: 'Frank Herbert', narrator: 'Scott Brick', description: 'In the vast desert of Arrakis...', duration: 3600 },
  { id: 2, title: 'Project Hail Mary', author: 'Andy Weir', narrator: 'Ray Porter', description: 'Rymer Wilson wakes up on a spaceship...', duration: 4800 },
  { id: 3, title: 'The Hobbit', author: 'J.R.R. Tolkien', narrator: 'Robbie Coltrane', description: 'Bilbo Baggins sets out on an adventure...', duration: 5100 },
];

function App() {
  const [audiobooks, setAudiobooks] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Replace with actual API call when server is ready
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        console.log('Server status:', data.status);
        setAudiobooks(mockAudiobooks);
        setLoading(false);
      })
      .catch(() => {
        setAudiobooks(mockAudiobooks);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="fixed top-0 w-full bg-slate-950/90 backdrop-blur-sm z-50 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={28} className="text-blue-500" />
            <h1 className="text-xl font-bold text-white">Audiobook Manager</h1>
          </div>
          <nav className="flex items-center gap-6 text-slate-300">
            <button className="hover:text-white transition-colors flex items-center gap-2">
              <Home size={20} /> Home
            </button>
            <button className="hover:text-white transition-colors flex items-center gap-2">
              <Library size={20} /> Library
            </button>
            <button className="hover:text-white transition-colors flex items-center gap-2">
              <Search size={20} /> Search
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-16 px-4 max-w-7xl mx-auto">
        {loading ? (
          <p className="text-slate-400 text-center py-20">Loading...</p>
        ) : audiobooks.length > 0 ? (
          <>
            {/* Featured Row */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4 text-white">Featured</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {audiobooks.slice(0, 3).map(book => (
                  <div key={book.id} className="bg-slate-800 rounded-lg overflow-hidden hover:bg-slate-700 transition-colors cursor-pointer group">
                    <img 
                      src="/placeholder-cover.jpg" 
                      alt={book.title}
                      className="w-full h-48 object-cover group-hover:opacity-90 transition-opacity"
                    />
                    <div className="p-4">
                      <h3 className="font-semibold text-white mb-1">{book.title}</h3>
                      <p className="text-sm text-slate-400">by {book.author}</p>
                      {book.narrator && (
                        <p className="text-xs text-slate-500 mt-1">Narrated by {book.narrator}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* All Audiobooks Row */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4 text-white">All Audiobooks</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {audiobooks.map(book => (
                  <div key={book.id} className="bg-slate-800 rounded-lg overflow-hidden hover:bg-slate-700 transition-colors cursor-pointer group">
                    <img 
                      src="/placeholder-cover.jpg" 
                      alt={book.title}
                      className="w-full h-32 object-cover group-hover:opacity-90 transition-opacity"
                    />
                    <div className="p-2">
                      <h3 className="text-sm font-medium text-white truncate">{book.title}</h3>
                      <p className="text-xs text-slate-400 truncate">{book.author}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <p className="text-slate-400 text-center py-20">No audiobooks found. Scan your library to get started.</p>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16 pt-8 pb-4 px-4 text-center text-slate-500 text-sm">
        Audiobook Manager v0.1.0 — Local-first audiobook management
      </footer>
    </div>
  );
}

export default App;
