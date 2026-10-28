insert into storage.buckets (id, name, public) values ('logos', 'logos', true);

create policy "logos_public_read" on storage.objects
  for select using (bucket_id = 'logos');

create policy "logos_authenticated_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'logos');

create policy "logos_authenticated_update" on storage.objects
  for update to authenticated using (bucket_id = 'logos');

create policy "logos_authenticated_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'logos');