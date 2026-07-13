-- Migration: Álbum de Figurinhas (sticker album unlocked with seeds)
-- Run this in the Supabase SQL editor for project pswmbqlafywaxphsrloe.

alter table child_profiles
  add column if not exists unlocked_stickers jsonb not null default '[]'::jsonb;
