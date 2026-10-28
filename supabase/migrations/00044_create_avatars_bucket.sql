insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);

create policy "avatars_select" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars_insert" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
create policy "avatars_update" on storage.objects for update to authenticated using (bucket_id = 'avatars');
create policy "avatars_delete" on storage.objects for delete to authenticated using (bucket_id = 'avatars');