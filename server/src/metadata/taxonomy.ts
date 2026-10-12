/**
 * Spec 17 — the curated genre taxonomy.
 *
 * Seeded, not hardcoded into query logic: every row is editable at runtime via
 * `PUT/POST/DELETE /api/genres`, and every provider string mapping lives in
 * `GenreMapping` so a bad mapping can be corrected without a code change.
 *
 * This file is the *seed*. It is idempotent: seeding twice updates names and
 * sort order rather than duplicating.
 */

export interface GenreSeed {
  slug: string;
  name: string;
  isCatchAll?: boolean;
  children?: GenreSeed[];
}

/**
 * Two levels only. Deeper hierarchies are better served by the taxonomy being
 * edited than by a guess baked into the seed.
 */
export const GENRE_TAXONOMY: GenreSeed[] = [
  {
    slug: "fiction",
    name: "Fiction",
    children: [
      { slug: "literary-fiction", name: "Literary Fiction" },
      { slug: "historical-fiction", name: "Historical Fiction" },
      { slug: "contemporary-fiction", name: "Contemporary Fiction" },
      { slug: "classics", name: "Classics" },
      { slug: "short-stories", name: "Short Stories" },
    ],
  },
  {
    slug: "mystery-thriller",
    name: "Mystery & Thriller",
    children: [
      { slug: "detective", name: "Detective" },
      { slug: "noir", name: "Noir" },
      { slug: "cozy", name: "Cozy" },
      { slug: "true-crime", name: "True Crime" },
      { slug: "police-procedural", name: "Police Procedural" },
      { slug: "crime", name: "Crime" },
      { slug: "thriller", name: "Thriller" },
    ],
  },
  {
    slug: "sci-fi-fantasy",
    name: "Science Fiction & Fantasy",
    children: [
      { slug: "science-fiction", name: "Science Fiction" },
      { slug: "hard-scifi", name: "Hard Science Fiction" },
      { slug: "space-opera", name: "Space Opera" },
      { slug: "dystopian", name: "Dystopian" },
      { slug: "fantasy", name: "Fantasy" },
      { slug: "epic-fantasy", name: "Epic Fantasy" },
      { slug: "urban-fantasy", name: "Urban Fantasy" },
      { slug: "horror", name: "Horror" },
      { slug: "gothic", name: "Gothic" },
    ],
  },
  {
    slug: "romance",
    name: "Romance",
    children: [
      { slug: "romantic-fiction", name: "Romantic Fiction" },
      { slug: "historical-romance", name: "Historical Romance" },
      { slug: "paranormal-romance", name: "Paranormal Romance" },
      { slug: "erotica", name: "Erotica" },
    ],
  },
  {
    slug: "history",
    name: "History",
    children: [
      { slug: "ancient-history", name: "Ancient History" },
      { slug: "medieval-history", name: "Medieval History" },
      { slug: "modern-history", name: "Modern History" },
      { slug: "military-history", name: "Military History" },
      { slug: "world-war", name: "World War" },
      { slug: "history-other", name: "History & Other" },
    ],
  },
  {
    slug: "biography-memoir",
    name: "Biography & Memoir",
    children: [
      { slug: "autobiography", name: "Autobiography" },
      { slug: "memoir", name: "Memoir" },
      { slug: "biography", name: "Biography" },
    ],
  },
  {
    slug: "children-ya",
    name: "Children & Young Adult",
    children: [
      { slug: "picture-books", name: "Picture Books" },
      { slug: "childrens", name: "Children's" },
      { slug: "middle-grade", name: "Middle Grade" },
      { slug: "young-adult", name: "Young Adult" },
      { slug: "nursery-rhymes", name: "Nursery Rhymes & Fairy Tales" },
    ],
  },
  {
    slug: "business",
    name: "Business",
    children: [
      { slug: "business-memo", name: "Business & Money" },
      { slug: "management", name: "Management & Leadership" },
      { slug: "economics", name: "Economics" },
      { slug: "marketing", name: "Marketing" },
    ],
  },
  {
    slug: "self-help",
    name: "Self Help",
    children: [
      { slug: "self-improvement", name: "Self-Improvement" },
      { slug: "motivational", name: "Motivational" },
      { slug: "spirituality", name: "Spirituality & Religion" },
      { slug: "health-wellness", name: "Health & Wellness" },
    ],
  },
  {
    slug: "science",
    name: "Science",
    children: [
      { slug: "science-general", name: "Science & Technology" },
      { slug: "mathematics", name: "Mathematics" },
      { slug: "nature", name: "Nature" },
    ],
  },
  {
    slug: "poetry-drama",
    name: "Poetry & Drama",
    children: [
      { slug: "poetry", name: "Poetry" },
      { slug: "drama", name: "Drama" },
      { slug: "plays", name: "Plays" },
    ],
  },
  {
    slug: "reference",
    name: "Reference",
    children: [
      { slug: "education", name: "Education" },
      { slug: "dictionaries", name: "Dictionaries" },
      { slug: "humor", name: "Humor" },
    ],
  },
  {
    slug: "language",
    name: "Language",
    children: [
      { slug: "language-learning", name: "Language Learning" },
      { slug: "linguistics", name: "Linguistics" },
    ],
  },
  {
    slug: "politics-law",
    name: "Politics & Law",
    children: [
      { slug: "politics", name: "Politics" },
      { slug: "current-affairs", name: "Current Affairs" },
      { slug: "law", name: "Law" },
    ],
  },
  // Catch-all. Spec 17 requires an unmapped provider genre to land somewhere
  // visible rather than being dropped.
  { slug: "misc", name: "Miscellaneous", isCatchAll: true },
];

/**
 * Provider genre strings mapped onto the taxonomy seed.
 *
 * Audnexus emits Amazon-style names ("Mystery, Thriller & Suspense",
 * "Literary Fiction"); LibriVox emits its own catalogue names ("Detective
 * Fiction", "Horror"). Keyed case-insensitively at match time so a casing
 * difference does not create an unmapped genre.
 */
export const PROVIDER_GENRE_MAPPING: Record<string, Record<string, string>> = {
  audnexus: {
    "literary fiction": "literary-fiction",
    fiction: "fiction",
    "science fiction": "science-fiction",
    "science fiction & fantasy": "sci-fi-fantasy",
    fantasy: "fantasy",
    "fantasy & paranormal": "fantasy",
    adventure: "fiction",
    "mystery, thriller & suspense": "mystery-thriller",
    "mystery": "mystery-thriller",
    thriller: "thriller",
    suspense: "thriller",
    "crime": "crime",
    "police procedural": "police-procedural",
    "detective": "detective",
    "true crime": "true-crime",
    horror: "horror",
    gothic: "gothic",
    "dark fantasy": "urban-fantasy",
    "epic fantasy": "epic-fantasy",
    "space opera": "space-opera",
    "hard science fiction": "hard-scifi",
    dystopian: "dystopian",
    romance: "romance",
    "romantic fiction": "romantic-fiction",
    "historical romance": "historical-romance",
    "erotica": "erotica",
    biography: "biography",
    "biography & memoir": "biography-memoir",
    memoir: "memoir",
    autobiography: "autobiography",
    history: "history",
    "world history": "modern-history",
    "military history": "military-history",
    "ancient history": "ancient-history",
    "middle grade": "middle-grade",
    "young adult": "young-adult",
    "children's": "childrens",
    "picture books": "picture-books",
    "business & money": "business-memo",
    economics: "economics",
    "self help": "self-help",
    "health & wellness": "health-wellness",
    spirituality: "spirituality",
    "science & technology": "science-general",
    mathematics: "mathematics",
    poetry: "poetry",
    drama: "drama",
    humor: "humor",
    "current affairs": "current-affairs",
    politics: "politics",
    law: "law",
    "language learning": "language-learning",
    classics: "classics",
  },
  librivox: {
    "detective fiction": "detective",
    "mystery fiction": "mystery-thriller",
    "crime/non-fiction": "true-crime",
    horror: "horror",
    "science fiction": "science-fiction",
    fantasy: "fantasy",
    "fairy tales": "nursery-rhymes",
    "children's fiction": "childrens",
    "children's": "childrens",
    "poetry": "poetry",
    "drama": "drama",
    "biography": "biography",
    "autobiography": "autobiography",
    history: "history",
    "philosophy": "self-improvement",
    "religion": "spirituality",
    "essays": "literary-fiction",
  },
  googlebooks: {
    fiction: "fiction",
    mystery: "mystery-thriller",
    "science fiction": "science-fiction",
    fantasy: "fantasy",
    biography: "biography",
    history: "history",
    "young adult": "young-adult",
    poetry: "poetry",
    drama: "drama",
  },
  openlibrary: {
    fiction: "fiction",
    "science fiction": "science-fiction",
    fantasy: "fantasy",
    mystery: "mystery-thriller",
    biography: "biography",
    history: "history",
  },
};