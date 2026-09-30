-- One-off, run as a superuser. Creates the database and its two roles.
--
--   psql -v owner_password=... -v web_password=... -f db/bootstrap.sql
--
-- tracker_owner runs migrations and the importer and is the role to edit data
-- with. tracker_web is what the site connects as: it can read the public
-- schema and nothing else, so the private schema (file links, raw sheet rows)
-- is unreachable from the site even by mistake.

create role tracker_owner login password :'owner_password';
create role tracker_web login password :'web_password';

create database martin_garrix_tracker owner tracker_owner;
revoke all on database martin_garrix_tracker from public;
grant connect on database martin_garrix_tracker to tracker_web;
