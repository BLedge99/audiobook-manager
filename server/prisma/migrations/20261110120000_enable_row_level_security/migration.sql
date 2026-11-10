-- Spec 35 / ADR 026 -- Row-Level Security on the production PostgreSQL database.
--
-- The server talks to PostgreSQL directly with Prisma and owns its own session
-- auth (ADR 016, ADR 023). It never uses Supabase Auth, PostgREST, or the
-- project's public anon key. Supabase nevertheless grants every table in the
-- `public` schema to the `anon` and `authenticated` roles by default, and
-- with RLS disabled that makes the whole library readable and writable
-- through https://<project-ref>.supabase.co/rest/v1/<table> with the public
-- anon key -- including profiles, e-mail addresses, password hashes and
-- session hashes.
--
-- The fix is deny-by-default: enable RLS and take the blanket grants away.
-- With RLS on and no policies, `anon` and `authenticated` see zero rows and
-- may write nothing. The server is unaffected because it connects as the table
-- owner, which is exempt from RLS (and Supabase's `postgres` role carries
-- BYPASSRLS as well).
--
-- Deliberately NOT used: FORCE ROW LEVEL SECURITY. It would also bind the
-- owner, and the owner is exactly the role the server uses.
--
-- Every statement is idempotent, so it is safe to run by hand in the Supabase
-- SQL editor first and let `prisma migrate deploy` record it afterwards. A
-- table that does not exist yet is skipped rather than failing the run.

-- 1. Every table this application owns. The names are listed one per line so
--    the list can be checked against `prisma/schema.prisma`; the server test
--    suite fails when a model is added and this list is not.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'LibraryRoot',
    'MediaItem',
    'Track',
    'Contributor',
    'ContributorMediaItem',
    'MetadataCandidate',
    'FieldOverride',
    'Genre',
    'GenreMapping',
    'MediaItemGenre',
    'Favourite',
    'ProfileLibraryEntry',
    'Tag',
    'MediaItemTag',
    'WishlistItem',
    'Series',
    'EnrichmentRun',
    'EnrichmentItem',
    'ListeningHistory',
    'Profile',
    'Session',
    'AdminCredential',
    'AdminSession',
    'DeviceCredential',
    'WebAuthnCredential',
    'WebAuthnChallenge',
    'PlaySession',
    'ScanState'
  ] LOOP
    IF to_regclass(format('public.%I', target)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    END IF;
  END LOOP;
END $$;

-- 2. Sweep the rest of the schema, so a table created through the Supabase
--    dashboard (or by Supabase itself) is never left unprotected. This is the
--    part that cannot be expressed as one entry per model.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.name);
  END LOOP;
END $$;

-- 3. Take back the blanket grants Supabase applies to the `public` schema, on
--    the tables that exist now and on the ones created later. `service_role`
--    keeps its grants: the optional Storage sync uses the service-role key,
--    which bypasses RLS.
--
--    The default privileges are revoked for the role running this migration --
--    the role that owns and creates the tables -- so a table added by a later
--    Prisma migration is not handed to `anon` and `authenticated` again.
DO $$
DECLARE
  target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', target_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', target_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', target_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', target_role);
    END IF;
  END LOOP;
END $$;
