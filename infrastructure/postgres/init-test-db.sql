-- Creates the database the integration suite uses.
--
-- The suite truncates every table between test files, so it must never share a
-- database with development data. Creating it here means `docker compose up` produces
-- a checkout where `npm test` works without further setup.
SELECT 'CREATE DATABASE badminton_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'badminton_test')\gexec
