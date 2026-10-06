create table if not exists public.playlist_collaborators (
  id bigint primary key,
  playlist_id bigint not null,
  user_id bigint not null,
  role text not null default 'editor',
  created_at timestamp not null default now(),
  unique (playlist_id, user_id)
);
create index if not exists playlist_collaborators_playlist_idx on public.playlist_collaborators(playlist_id);
create index if not exists playlist_collaborators_user_idx on public.playlist_collaborators(user_id);
