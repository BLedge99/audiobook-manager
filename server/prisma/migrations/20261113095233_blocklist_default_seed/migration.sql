-- Spec 38: the default blocklist seeded once per installation, tracked by a
-- one-row marker so an admin who empties the blocklist does not watch the
-- defaults reappear on the next boot. Household configuration.
--
-- Additive: no column is removed or repurposed, and no row is rewritten.

-- CreateTable
CREATE TABLE "GenreBlocklistSeed" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenreBlocklistSeed_pkey" PRIMARY KEY ("id")
);

-- Row-Level Security (spec 35 / ADR 026): every table added after the
-- RLS migration protects itself in the same migration via a plain statement.
ALTER TABLE "GenreBlocklistSeed" ENABLE ROW LEVEL SECURITY;
