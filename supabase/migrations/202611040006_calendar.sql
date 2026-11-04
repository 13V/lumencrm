alter table public.calendar_tokens add constraint calendar_token_hash_length check(length(token_hash)=64);

create function public.calendar_feed(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if length(p_hash)<>64 or not exists(select 1 from public.calendar_tokens t join public.profiles p on p.user_id=t.user_id where t.token_hash=p_hash and t.revoked_at is null and t.deleted_at is null and p.deleted_at is null and p.role in ('owner','staff')) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'ics_uid',a.ics_uid,'starts_at',a.starts_at,'ends_at',a.ends_at,'status',a.status,'kind',a.kind,'updated_at',a.updated_at,'name',concat_ws(' ',c.first_name,c.last_name),'business',b.name,'notes',a.notes)), '[]'::jsonb) into result
    from public.appointments a left join public.contacts c on c.id=a.contact_id left join public.businesses b on b.id=c.business_id
    where a.deleted_at is null and a.starts_at between now()-interval '90 days' and now()+interval '1 year';
  return result;
end $$;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon,authenticated,service_role;
