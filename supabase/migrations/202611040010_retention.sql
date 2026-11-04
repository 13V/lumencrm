-- Troy confirmed the live privacy policy's 12-month retention period. Existing
-- custom periods remain unchanged; migrate only the original 24-month default.
update public.settings set config=jsonb_set(config,'{retention_months}','12'::jsonb)
where singleton and (not (config ? 'retention_months') or config->>'retention_months'='24');

create or replace function public.retention_candidates(p_before timestamptz,p_limit integer default 100) returns setof uuid language plpgsql security definer set search_path='' as $$
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
revoke all on function public.retention_candidates(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.retention_candidates(timestamptz,integer) to service_role;
