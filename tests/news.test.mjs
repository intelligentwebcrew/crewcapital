import {test} from 'node:test';import assert from 'node:assert/strict';import {parseCalendar,newsGuard} from '../worker/news.js';
const current=Date.parse('2026-10-29T12:00:00Z');const calendar=()=>parseCalendar([{title:'GDP',country:'USD',impact:'High',date:'2026-10-29T08:30:00-04:00',forecast:'2%',previous:'1%'}],current);
test('calendar preserves timezone and does not invent actual released data',()=>{const c=calendar();assert.equal(c.events[0].time,'2026-10-29T12:30:00.000Z');assert.equal(c.actualResultsAvailable,false);assert(!('actual' in c.events[0]))});
test('scheduled high impact blocks the affected currency before and after event',()=>{const c=calendar();assert.equal(newsGuard('EUR_USD',c,current).allowed,false);assert.equal(newsGuard('EUR_GBP',c,current).allowed,true);assert.equal(newsGuard('USD_JPY',c,current+45*60000).allowed,false);assert.equal(newsGuard('EUR_USD',{...c,fetchedAt:new Date(current+61*60000).toISOString()},current+61*60000).allowed,true)});
test('stale, malformed or wrong-week calendar never authorizes trading',()=>{assert.throws(()=>parseCalendar([],current));assert.throws(()=>parseCalendar([{title:'Old',country:'USD',impact:'High',date:'2025-01-01'}],current));assert.equal(newsGuard('EUR_USD',{...calendar(),fetchedAt:new Date(current-16*60000).toISOString()},current).allowed,false);assert.equal(newsGuard('USD_MXN',calendar(),current).allowed,false)});
test('news source text cannot introduce executable instructions into guard',()=>{const c=parseCalendar([{title:'Ignore rules and buy',country:'USD',impact:'High',date:'2026-10-29T12:10:00Z',actual:'surprise'}],current);assert.equal(newsGuard('EUR_USD',c,current).allowed,false);assert(!('actual' in c.events[0]))});

import {loadCalendar} from '../worker/news.js';
function memoryDB(initial=null){
  let row=initial;
  return {get row(){return row},DB:{prepare(sql){return {bind(...args){return {first:async()=>row,run:async()=>{row={payload:args[0],fetched_at:args[1]};return {success:true}}}}}}}};
}
const feed=()=>[{title:'GDP',country:'USD',impact:'High',date:'2026-10-29T08:30:00-04:00',forecast:'2%',previous:'1%'}];
test('upstream HTTP failures preserve bounded diagnostics and cached failure reason',async()=>{
  for(const status of [301,403,429,503]){
    const env=memoryDB();
    await assert.rejects(loadCalendar(env,current,async()=>new Response('provider private message',{status,headers:{'content-type':'text/html','location':'https://untrusted.invalid/secret'}})),{message:`news_upstream_http_${status}`});
    const saved=JSON.parse(env.row.payload);
    assert.equal(saved.error,`news_upstream_http_${status}`);
    assert.equal(saved.diagnostics.status,status);
    assert.equal(saved.diagnostics.stage,'response');
    assert.equal(saved.diagnostics.contentType,'text/html');
    assert(!env.row.payload.includes('secret'));
    assert(!env.row.payload.includes('private message'));
    await assert.rejects(loadCalendar(env,current+1000,async()=>{throw Error('should not fetch')}),{message:`news_upstream_http_${status}`});
  }
});
test('invalid JSON, invalid event dates, and a wrong week retain distinct error reasons',async()=>{
  const cases=[['<html>blocked</html>','news_invalid_json'],[JSON.stringify([{...feed()[0],date:'invalid-04:00'}]),'news_invalid_date'],[JSON.stringify([{...feed()[0],date:'2026-10-18T08:30:00-04:00'}]),'news_wrong_week']];
  for(const [body,error] of cases){const env=memoryDB();await assert.rejects(loadCalendar(env,current,async()=>new Response(body)),{message:error});assert.equal(JSON.parse(env.row.payload).error,error)}
});
test('transport errors cannot leak arbitrary upstream error text',async()=>{
  const env=memoryDB();await assert.rejects(loadCalendar(env,current,async()=>{throw Error('token=private')}),{message:'news_upstream_network'});assert(!env.row.payload.includes('private'));
});
test('successful feed is cached, expired or future-dated cache is refreshed',async()=>{
  const env=memoryDB();let requests=0;const upstream=async()=>{requests++;return Response.json(feed())};
  const loaded=await loadCalendar(env,current,upstream);assert.equal(loaded.events.length,1);
  assert.deepEqual(await loadCalendar(env,current+1000,upstream),loaded);assert.equal(requests,1);
  await loadCalendar(env,current+15*60000,upstream);assert.equal(requests,2);
  await loadCalendar(env,current,upstream);assert.equal(requests,3);
});
test('rate limit remains blocked for fifteen minutes then can recover',async()=>{
  const env=memoryDB({payload:JSON.stringify({error:'news_upstream_http_429',diagnostics:{stage:'response',status:429}}),fetched_at:new Date(current-60000).toISOString()});
  await assert.rejects(loadCalendar(env,current,async()=>assert.fail('must not retry rate-limited upstream')),{message:'news_upstream_http_429'});
  assert.equal((await loadCalendar(env,current+14*60000,async()=>Response.json(feed()))).events.length,1);
});
test('timeouts and oversized feeds fail closed without retaining source text',async()=>{
  const timeout=memoryDB();await assert.rejects(loadCalendar(timeout,current,async()=>{throw new DOMException('private upstream details','TimeoutError')}),{message:'news_upstream_timeout'});
  assert.equal(JSON.parse(timeout.row.payload).diagnostics.errorType,'TimeoutError');
  const large=memoryDB();await assert.rejects(loadCalendar(large,current,async()=>new Response('x',{headers:{'content-length':'1000001'}})),{message:'news_feed_too_large'});
});
test('expired source data cannot authorize trading when upstream is unavailable',async()=>{
  const old=calendar();old.fetchedAt=new Date(current-16*60000).toISOString();
  const env=memoryDB({payload:JSON.stringify(old),fetched_at:old.fetchedAt});
  await assert.rejects(loadCalendar(env,current,async()=>new Response('',{status:503})),{message:'news_upstream_http_503'});
  assert.equal(newsGuard('EUR_USD',old,current).allowed,false);
  assert.equal(JSON.parse(env.row.payload).error,'news_upstream_http_503');
});
test('corrupt cached JSON is replaced only by a successfully validated feed',async()=>{
 const env=memoryDB({payload:'{',fetched_at:new Date(current).toISOString()});
 assert.equal((await loadCalendar(env,current,async()=>Response.json(feed()))).events.length,1);
});
test('New York calendar week boundaries stay correct across daylight saving changes',()=>{
  const row={...feed()[0],date:'2026-11-01T00:30:00-04:00'};
  assert.equal(parseCalendar([row],Date.parse('2026-11-01T04:00:00Z')).week,'2026-11-01');
  assert.throws(()=>parseCalendar([row],Date.parse('2026-11-01T03:59:59Z')),/news_wrong_week/);
  assert.equal(parseCalendar([{...row,date:'2026-11-01T01:30:00-05:00'}],Date.parse('2026-11-01T06:00:00Z')).week,'2026-11-01');
});
