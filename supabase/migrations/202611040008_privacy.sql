-- Anonymised enquiries remain reportable even though hidden from working lists.
alter table public.deals add column anonymised_at timestamptz;
alter table public.businesses add column anonymised_at timestamptz;
create index deals_anonymous_cohort_idx on public.deals(created_at) where anonymised_at is not null and merged_into_id is null;

create function public.redact_contact_capabilities() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.anonymised_at is not null and old.anonymised_at is null then
    update public.deals set anonymised_at=new.anonymised_at where contact_id=new.id;
    -- Revocation is atomic with redaction; a previously shared quote link stops working.
    update public.quotes set public_token=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_'),deleted_at=coalesce(deleted_at,now())
      where deal_id in (select id from public.deals where contact_id=new.id);
    if new.business_id is not null and not exists(select 1 from public.contacts where business_id=new.business_id and id<>new.id and anonymised_at is null) then
      update public.businesses set anonymised_at=new.anonymised_at where id=new.business_id;
    end if;
  end if;
  return new;
end $$;
create trigger redact_contact_capabilities after update of anonymised_at on public.contacts for each row execute function public.redact_contact_capabilities();

create function public.retention_candidates(p_before timestamptz,p_limit integer default 100) returns setof uuid language plpgsql security definer set search_path='' as $$
declare minimum_months integer;
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  select greatest(1,coalesce((config->>'retention_months')::integer,12)) into minimum_months from public.settings where singleton;
  if p_before>now()-make_interval(months=>minimum_months) then raise exception 'Retention cutoff exceeds the configured period' using errcode='22023'; end if;
  return query select c.id from public.contacts c where c.anonymised_at is null
    and exists(select 1 from public.deals d where d.contact_id=c.id and d.merged_into_id is null and d.outcome in ('lost','noreply') and coalesce(d.closed_at,d.created_at)<p_before)
    and not exists(select 1 from public.deals d where d.contact_id=c.id and d.merged_into_id is null and
      (d.outcome in ('open','won') or coalesce(d.closed_at,d.created_at)>=p_before))
    order by c.created_at limit greatest(1,least(p_limit,500));
end $$;

create function public.restore_deleted(p_entity text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare row_data jsonb; deleted_time timestamptz;
begin
  if not public.has_role(array['owner']) then raise exception 'Only an owner can restore deleted records' using errcode='42501'; end if;
  if p_entity not in ('contacts','businesses','deals','activities','tasks','appointments','demos','projects','quotes','quote_items','subscriptions','invoices','invoice_items','payments','files','tags','taggings','saved_views','message_drafts') then
    raise exception 'This record type cannot be restored here' using errcode='22023';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 for update',p_entity) into row_data using p_id;
  if row_data is null then raise exception 'Record not found' using errcode='P0002'; end if;
  if row_data->>'anonymised_at' is not null then raise exception 'Personal data was permanently removed and cannot be restored' using errcode='23514'; end if;
  if row_data->>'merged_into_id' is not null then raise exception 'Merged records cannot be restored as duplicate enquiries' using errcode='23514'; end if;
  deleted_time:=(row_data->>'deleted_at')::timestamptz;
  if deleted_time is null then return row_data; end if;
  if deleted_time<now()-interval '30 days' then raise exception 'This record is outside the 30-day bin period' using errcode='23514'; end if;
  execute format('update public.%I set deleted_at=null where id=$1 returning to_jsonb(%I.*)',p_entity,p_entity) into row_data using p_id;
  return row_data;
end $$;
revoke all on function public.redact_contact_capabilities(),public.retention_candidates(timestamptz,integer),public.restore_deleted(text,uuid) from public,anon,authenticated;
grant execute on function public.retention_candidates(timestamptz,integer) to service_role;
grant execute on function public.restore_deleted(text,uuid) to authenticated;
