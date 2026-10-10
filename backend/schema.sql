-- Run once in a dedicated Supabase project's SQL Editor.
begin;
create table public.community_wallpapers (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 120), description text not null default '' check(length(description)<=2000),
 creator text not null check(length(creator) between 1 and 80), tags text[] not null default '{}' check(cardinality(tags)<=8 and char_length(array_to_string(tags,','))<=263),
 extension text not null check(extension in ('gif','mp4','webm')), bytes bigint not null check(bytes between 1 and 52428800),
 width integer not null check(width between 1 and 8192),height integer not null check(height between 1 and 8192),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), media_path text not null unique,thumbnail_path text not null unique,
 status text not null default 'draft' check(status in ('draft','pending','published','rejected')),created_at timestamptz not null default now(),
 check(media_path=owner_id::text||'/'||id::text||'/wallpaper.'||extension),check(thumbnail_path=owner_id::text||'/'||id::text||'/thumbnail.webp')
);
create index community_recent on public.community_wallpapers(created_at desc) where status='published';
alter table public.community_wallpapers enable row level security;
revoke all on public.community_wallpapers from anon,authenticated;
grant select on public.community_wallpapers to anon,authenticated;
grant insert(id,owner_id,title,description,creator,tags,extension,bytes,width,height,sha256,media_path,thumbnail_path) on public.community_wallpapers to authenticated;
grant delete on public.community_wallpapers to authenticated;
create policy catalog_read on public.community_wallpapers for select to anon,authenticated using(status='published' or owner_id=(select auth.uid()));
create policy creator_insert on public.community_wallpapers for insert to authenticated with check(owner_id=(select auth.uid()) and status='draft');
create policy remove_draft on public.community_wallpapers for delete to authenticated using(owner_id=(select auth.uid()) and status='draft');
create function public.wallpaper_quota() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
 if (select count(*) from public.community_wallpapers where owner_id=new.owner_id)>=20 or
 (select coalesce(sum(bytes),0) from public.community_wallpapers where owner_id=new.owner_id)+new.bytes>209715200 then raise exception 'Upload quota reached (20 submissions / 200 MB)';end if;
 return new;
end;$$;
create trigger wallpaper_quota before insert on public.community_wallpapers for each row execute function public.wallpaper_quota();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('silk-wallpapers','silk-wallpapers',false,52428800,array['image/gif','video/mp4','video/webm','image/webp']);
create policy upload_declared_asset on storage.objects for insert to authenticated with check(bucket_id='silk-wallpapers' and exists(select 1 from public.community_wallpapers w where w.owner_id=(select auth.uid()) and w.status='draft' and (w.media_path=name or w.thumbnail_path=name)));
create policy read_approved_asset on storage.objects for select to anon,authenticated using(bucket_id='silk-wallpapers' and exists(select 1 from public.community_wallpapers w where (w.status='published' or w.owner_id=(select auth.uid())) and (w.media_path=name or w.thumbnail_path=name)));
create policy remove_draft_asset on storage.objects for delete to authenticated using(bucket_id='silk-wallpapers' and exists(select 1 from public.community_wallpapers w where w.owner_id=(select auth.uid()) and w.status='draft' and (w.media_path=name or w.thumbnail_path=name)));
create function public.submit_wallpaper(wallpaper_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare w public.community_wallpapers; m jsonb;t jsonb;
begin
 select * into w from public.community_wallpapers where id=wallpaper_id and owner_id=auth.uid() and status='draft' for update;
 if not found then raise exception 'Draft not found';end if;
 select metadata into m from storage.objects where bucket_id='silk-wallpapers' and name=w.media_path;
 select metadata into t from storage.objects where bucket_id='silk-wallpapers' and name=w.thumbnail_path;
 if m is null or t is null
    or (m->>'size')::bigint is distinct from w.bytes
    or coalesce((t->>'size')::bigint, 0) not between 1 and 1048576
    or (m->>'mimetype') is distinct from
       (case w.extension when 'gif' then 'image/gif' when 'mp4' then 'video/mp4' else 'video/webm' end)
    or (t->>'mimetype') is distinct from 'image/webp'
 then
   raise exception 'Uploaded assets are missing or invalid';
 end if;
 update public.community_wallpapers set status='pending' where id=w.id;
end;$$;
revoke all on function public.submit_wallpaper(uuid) from public;
grant execute on function public.submit_wallpaper(uuid) to authenticated;
create table public.community_reports(wallpaper_id uuid not null references public.community_wallpapers(id) on delete cascade,reporter_id uuid not null references auth.users(id) on delete cascade,reason text not null check(length(reason) between 1 and 1000),created_at timestamptz not null default now(),primary key(wallpaper_id,reporter_id));
alter table public.community_reports enable row level security;
revoke all on public.community_reports from anon,authenticated;
grant insert on public.community_reports to authenticated;
create policy own_report on public.community_reports for insert to authenticated with check(reporter_id=(select auth.uid()) and exists(select 1 from public.community_wallpapers w where w.id=wallpaper_id and w.status='published'));
commit;
-- Owner review in SQL Editor, after inspecting media and rights:
-- update public.community_wallpapers set status='published' where id='REVIEWED_UUID' and status='pending';
-- update public.community_wallpapers set status='rejected' where id='REVIEWED_UUID';
