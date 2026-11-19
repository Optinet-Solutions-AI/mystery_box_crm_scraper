-- Accent-insensitive email search: "pokemon" also finds "Pokémon".
create extension if not exists unaccent;

-- unaccent() isn't marked immutable, so wrap it for use in a generated column.
create or replace function public.immutable_unaccent(text)
returns text language sql immutable parallel safe strict
as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

alter table emails add column if not exists search_text text
  generated always as (lower(public.immutable_unaccent(coalesce(subject, '') || ' ' || coalesce(preview_text, '')))) stored;
