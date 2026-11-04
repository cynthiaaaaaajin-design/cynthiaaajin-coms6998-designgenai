-- Read-only evidence for the two additional named E2E trips. No credentials.
select jsonb_build_object(
 'active_publication_id',(select active_version_id from public.studio_integration_config where slot='trip-planning'),
 'trips',(select jsonb_agg(jsonb_build_object('id',id::text,'title',title,'destination',destination,'start_date',start_date,'end_date',end_date) order by id) from public.trips where id in (22,23)),
 'public_runs',(select jsonb_agg(jsonb_build_object(
  'run_id',r.id,'trip_id',r.trip_id::text,'operation',r.operation,'status',r.status,'error',r.error,
  'base_version_id',r.base_version_id,'itinerary_version_id',r.version_id,'itinerary_version',v.version_number,'proposal_id',r.proposal_id,
  'publication_id',p.id,'chain_version',p.version_number,'saved_steps',jsonb_array_length(r.outputs),
  'item_count',(select count(*) from public.itinerary_items i where i.version_id=r.version_id),
  'response_matches_final_step',v.response_text=(r.outputs->-1->>'text'),
  'elapsed_ms',round(extract(epoch from (r.finished_at-r.created_at))*1000),
  'models',(select jsonb_agg(jsonb_build_object('step',o->'step','model',o->>'model','duration_ms',o->'duration_ms')) from jsonb_array_elements(r.outputs) o)
 ) order by r.created_at) from public.studio_trip_runs r join public.studio_chain_versions p on p.id=r.publication_id left join public.itinerary_versions v on v.id=r.version_id where r.trip_id in (22,23)),
 'feedback',(select jsonb_agg(jsonb_build_object('trip_id',v.trip_id::text,'version_id',f.version_id,'rating',f.rating,'comment',f.comment) order by v.trip_id,v.version_number) from public.itinerary_feedback f join public.itinerary_versions v on v.id=f.version_id where v.trip_id in (22,23)),
 'studio_tests',(select jsonb_agg(jsonb_build_object('publication_id',p.id,'chain_version',p.version_number,'draft_revision',p.revision,'test_run_id',p.test_run_id,'status',r.status,'saved_steps',jsonb_array_length(r.outputs)) order by p.version_number) from public.studio_chain_versions p join public.studio_runs r on r.id=p.test_run_id where p.snapshot->>'id'='38569d3f-5e3d-443a-a1d8-f6d9dc99efa9' and p.version_number in (3,4)),
 'version_counts',(select jsonb_object_agg(trip_id::text,n) from (select trip_id,count(*) n from public.itinerary_versions where trip_id in (22,23) group by trip_id) counts)
) as additional_e2e_evidence;
