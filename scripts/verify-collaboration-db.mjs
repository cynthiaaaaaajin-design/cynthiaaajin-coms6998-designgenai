// Real PostgreSQL RLS/constraint execution in an isolated in-memory PGlite instance.
// Uses a representative existing schema, NOT the connected Supabase project.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const version = '44444444-4444-4444-8444-444444444444';
const otherVersion = '55555555-5555-4555-8555-555555555555';
const item = '66666666-6666-4666-8666-666666666666';
const otherItem = '77777777-7777-4777-8777-777777777777';
const nextVersion = '88888888-8888-4888-8888-888888888888';
await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon;
 grant execute on function auth.uid() to authenticated, anon;
 create table public.profiles(id uuid primary key,first_name text,last_name text);
 create table public.trips(id bigint primary key,user_id uuid references profiles(id));
 create table public.trip_members(trip_id bigint references trips(id),user_id uuid references profiles(id),primary key(trip_id,user_id));
 create table public.itinerary_versions(id uuid primary key,trip_id bigint references trips(id),version_number integer,unique(trip_id,version_number));
 create table public.itinerary_items(id uuid primary key,version_id uuid references itinerary_versions(id));
 create table public.activity_votes(id bigint generated always as identity,item_id uuid references itinerary_items(id),user_id uuid references profiles(id),value integer,comment text);
 insert into profiles values('${owner}','Owner','Traveler'),('${member}','Member','Traveler'),('${outsider}','Other','Traveler');
 insert into trips values(1,'${owner}'),(2,'${outsider}');
 insert into trip_members values(1,'${member}');
 insert into itinerary_versions values('${version}',1,1),('${otherVersion}',2,1);
 insert into itinerary_items values('${item}','${version}'),('${otherItem}','${otherVersion}');
 insert into activity_votes(item_id,user_id,value,comment) values('${item}','${member}',1,'Original'),('${item}','${member}',-1,'Latest');
 grant select on public.trips,public.trip_members,public.itinerary_versions,public.itinerary_items to authenticated;
`);
await db.exec(readFileSync(new URL('../sql/trip-collaboration.sql',import.meta.url),'utf8'));
// Exercise new policies with representative private-trip SELECT policies too.
await db.exec(`
 alter table trips enable row level security;
 create policy private_trip on trips for select to authenticated using(public.collaboration_participant(id,auth.uid()));
 alter table itinerary_versions enable row level security;
 create policy private_version on itinerary_versions for select to authenticated using(public.collaboration_participant(trip_id,auth.uid()));
`);
async function as(user, sql, params = [], role = 'authenticated') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user ?? '']);
  return db.query(sql, params);
}
async function denied(user, sql, params = [], role) {
  await assert.rejects(() => as(user,sql,params,role));
}
const save = `insert into trip_preferences(trip_id,user_id,budget_amount,budget_currency,budget_scope,travel_pace,interests,hard_constraints)
 values(1,$1,100,'USD','per_person_total','balanced',array['Art'],array['No stairs'])
 on conflict(trip_id,user_id) do update set budget_amount=excluded.budget_amount,budget_currency=excluded.budget_currency,budget_scope=excluded.budget_scope,travel_pace=excluded.travel_pace,interests=excluded.interests,hard_constraints=excluded.hard_constraints,trip_id=excluded.trip_id,user_id=excluded.user_id returning *`;
await as(owner,save,[owner]);
await as(member,save,[member]);
await as(member,save,[member]); // exact upsert column grants used by the API
assert.equal((await as(owner,'select * from trip_preferences')).rows.length,2);
assert.equal((await as(member,"update trip_preferences set travel_pace='relaxed' where user_id=$1 returning travel_pace",[member])).rows[0].travel_pace,'relaxed');
assert.equal((await as(member,"select travel_pace from trip_preferences where user_id=$1",[member])).rows[0].travel_pace,'relaxed');
assert.equal((await as(member,"update trip_preferences set travel_pace='packed' where user_id=$1 returning *",[owner])).rows.length,0);
await denied(member,save,[owner]);
await denied(outsider,save,[outsider]);
assert.equal((await as(outsider,'select * from trip_preferences')).rows.length,0);
await denied(null,'select * from trip_preferences',[],'anon');
await denied(null,save,[owner]);
await denied(member,"update trip_preferences set budget_amount=-1 where user_id=$1",[member]);
await denied(member,"update trip_preferences set interests=array[repeat('x',301)] where user_id=$1",[member]);
await denied(member,"update trip_preferences set budget_scope='unspecified' where user_id=$1",[member]);
await denied(member,"update trip_preferences set user_id=$1 where user_id=$2",[owner,member]);
await denied(member,"update trip_preferences set trip_id=2 where user_id=$1",[member]);
assert.equal((await as(member,'select * from collaboration_people(1)')).rows.length,2);
await denied(outsider,'select * from collaboration_people(1)');
assert.equal((await as(outsider,'select collaboration_participant(1,$1) as allowed',[owner])).rows[0].allowed,false,'Outsiders cannot probe membership');
const insert = `insert into activity_change_requests(trip_id,version_id,item_id,created_by,request_type,comment) values($1,$2,$3,$4,'too_expensive','Cheaper please') returning *`;
const first = (await as(member,insert,[1,version,item,member])).rows[0];
assert.equal(first.status,'pending');
await denied(member,insert,[1,version,item,owner]);
await denied(outsider,insert,[1,version,item,outsider]);
await denied(null,insert,[1,version,item,owner], 'anon');
await denied(member,insert,[1,otherVersion,otherItem,member]);
await denied(member,insert,[1,version,otherItem,member]);
await denied(member,insert,[2,version,item,member]);
assert.equal((await as(member,"update activity_change_requests set status='resolved' where id=$1 returning *",[first.id])).rows.length,0);
await denied(member,"update activity_change_requests set comment='Forged' where id=$1",[first.id]);
const resolved=(await as(owner,"update activity_change_requests set status='resolved' where id=$1 returning *",[first.id])).rows[0];
assert.equal(resolved.resolved_by,owner); assert.ok(resolved.resolved_at);
assert.equal((await as(owner,"update activity_change_requests set status='declined' where id=$1 returning *",[first.id])).rows.length,0);
const second=(await as(owner,insert,[1,version,item,owner])).rows[0];
assert.equal((await as(owner,"update activity_change_requests set status='declined' where id=$1 returning status",[second.id])).rows[0].status,'declined');
const pending=(await as(member,insert,[1,version,item,member])).rows[0];
await db.exec('reset role');
await db.exec(`insert into itinerary_versions values('${nextVersion}',1,2)`);
assert.equal((await as(member,'select status from activity_change_requests where id=$1',[pending.id])).rows[0].status,'pending');
await denied(member,insert,[1,version,item,member]);
assert.equal((await as(owner,'select * from activity_change_requests where version_id=$1',[version])).rows.length,3);
assert.equal((await as(owner,'select * from activity_change_requests where version_id=$1',[nextVersion])).rows.length,0);
assert.equal((await as(outsider,'select * from activity_change_requests')).rows.length,0);
await db.exec('reset role');
await db.exec(`delete from trip_members where trip_id=1 and user_id='${member}'`);
assert.equal((await as(member,'select * from trip_preferences')).rows.length,0);
assert.equal((await as(member,'select * from activity_change_requests')).rows.length,0);
await denied(member,save,[member]);
assert.equal((await as(owner,'select * from trip_preferences')).rows.length,1,'Removed member preferences excluded from group');
assert.equal((await as(owner,'select * from activity_change_requests')).rows.length,3,'Removed member requests retained as history');
await db.exec('reset role');
assert.equal((await db.query('select * from activity_votes order by id')).rows.length,2,'Historical votes untouched');
assert.equal((await db.query('select value from activity_votes order by id desc limit 1')).rows[0].value,-1);
assert.equal((await db.query('select * from itinerary_versions where trip_id=1')).rows.length,2,'Version history untouched');
await db.close();
console.log('PASS: migration executed in isolated PostgreSQL; real RLS/grants, owner/member upsert, persistence, forgery/outsider/anonymous/removed-member denial, budget/list constraints, composite associations, owner status transitions/audit, old-version preservation, unchanged votes/version history. NOT live Supabase verification.');
