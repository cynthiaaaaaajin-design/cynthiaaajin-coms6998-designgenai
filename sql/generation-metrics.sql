begin;
create function public.finish_observed_generation_metrics(p_id uuid,p_response text,p_error text,p_metrics jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare request public.admin_resources; field text; cleaned jsonb;
begin
 select * into request from public.admin_resources where id=p_id and resource='generation-requests' for update;
 if request.id is null or auth.uid() is null or request.data->>'user_id' is distinct from auth.uid()::text or request.data->>'status'<>'pending' then raise exception 'Generation not available' using errcode='42501'; end if;
 if p_metrics is null or jsonb_typeof(p_metrics)<>'object' or octet_length(p_metrics::text)>4000 or jsonb_typeof(p_metrics->'model') is distinct from 'string' or length(btrim(p_metrics->>'model')) not between 1 and 200 then raise exception 'Invalid generation metrics' using errcode='22023'; end if;
 if p_metrics->'model_version' is not null and p_metrics->'model_version'<>'null'::jsonb and (jsonb_typeof(p_metrics->'model_version')<>'string' or length(p_metrics->>'model_version')>200) then raise exception 'Invalid model version' using errcode='22023'; end if;
 foreach field in array array['duration_ms','input_tokens','output_tokens','total_tokens','thinking_tokens','cached_input_tokens'] loop
  if p_metrics->field is not null and p_metrics->field<>'null'::jsonb then
   if jsonb_typeof(p_metrics->field)<>'number' then raise exception 'Metrics must be nonnegative integers' using errcode='22023'; end if;
   if (p_metrics->>field)::numeric<0 or (p_metrics->>field)::numeric<>trunc((p_metrics->>field)::numeric) or (p_metrics->>field)::numeric>(case when field='duration_ms' then 86400000 else 1000000000 end) then raise exception 'Metric out of range' using errcode='22023'; end if;
  end if;
 end loop;
 cleaned:=jsonb_build_object('model',p_metrics->>'model','model_version',p_metrics->'model_version','duration_ms',p_metrics->'duration_ms','input_tokens',p_metrics->'input_tokens','output_tokens',p_metrics->'output_tokens','total_tokens',p_metrics->'total_tokens','thinking_tokens',p_metrics->'thinking_tokens','cached_input_tokens',p_metrics->'cached_input_tokens');
 perform public.finish_observed_generation(p_id,p_response,p_error);
 update public.admin_resources set data=data||jsonb_build_object('configured_model',request.data->>'model','model',p_metrics->>'model','metrics',cleaned,'metrics_version',1) where id=p_id;
 update public.admin_resources set data=data||jsonb_build_object('metrics',cleaned,'metrics_version',1) where resource in ('llm-responses','generated-media') and data->>'request_id'=p_id::text;
end; $$;
revoke all on function public.finish_observed_generation_metrics(uuid,text,text,jsonb) from public,anon;
grant execute on function public.finish_observed_generation_metrics(uuid,text,text,jsonb) to authenticated;
commit;
