const CALENDAR_URL='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const NEWS_CURRENCIES=['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD','CNY'];
function newsWeek(ms){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10)}
export function parseCalendar(raw,current=Date.now()){if(!Array.isArray(raw)||raw.length<1||raw.length>2000)throw Error('news_invalid_feed');const week=newsWeek(current);const events=raw.map(e=>{if(!e||typeof e.title!=='string'||typeof e.country!=='string'||!['High','Medium','Low','Holiday','Non-Economic'].includes(e.impact)||typeof e.date!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(e.date))throw Error('news_invalid_feed');const time=Date.parse(e.date);if(!Number.isFinite(time))throw Error('news_invalid_date');if(newsWeek(time)!==week)throw Error('news_wrong_week');return {title:e.title.slice(0,240),currency:e.country.toUpperCase(),impact:e.impact,time:new Date(time).toISOString(),forecast:typeof e.forecast==='string'?e.forecast.slice(0,80):'',previous:typeof e.previous==='string'?e.previous.slice(0,80):''}}).sort((a,b)=>a.time.localeCompare(b.time));return {source:'Forex Factory · Fair Economy weekly JSON',url:CALENDAR_URL,week,fetchedAt:new Date(current).toISOString(),events,actualResultsAvailable:false,coverage:NEWS_CURRENCIES,limitations:'Agenda semanal com impacto esperado, previsão e anterior. Sem valores divulgados em tempo real, manchetes, choques inesperados ou garantia de atualização.'}}
export function newsGuard(instrument,calendar,current=Date.now()){const deny=(reason,events=[])=>({allowed:false,reason,events});if(!calendar||calendar.week!==newsWeek(current)||!Number.isFinite(Date.parse(calendar.fetchedAt))||current-Date.parse(calendar.fetchedAt)>15*60000||Date.parse(calendar.fetchedAt)-current>5000)return deny('news_unavailable_or_stale');const currencies=instrument.split('_').map(c=>c==='CNH'?'CNY':c);if(currencies.length!==2||currencies.some(c=>!NEWS_CURRENCIES.includes(c)))return deny('news_currency_unsupported');const related=calendar.events.filter(e=>currencies.includes(e.currency)||e.currency==='ALL');const blocking=related.filter(e=>{const time=Date.parse(e.time);if(e.impact==='Holiday')return current>=time&&current<=time+24*3600000;if(e.impact!=='High')return false;const after=/speak|conference|testif/i.test(e.title)?60:30;return current>=time-30*60000&&current<=time+after*60000});return blocking.length?deny('high_impact_window',blocking):{allowed:true,reason:'no_scheduled_block_in_window',events:related.filter(e=>Date.parse(e.time)>=current&&Date.parse(e.time)<=current+24*3600000)}}
function calendarError(code,diagnostics={}){const error=new Error(code);error.diagnostics=diagnostics;return error}
function calendarErrorCode(error,stage){
  if(/^news_(?:invalid_feed|invalid_date|invalid_json|wrong_week|feed_too_large|upstream_http_[1-5]\d\d|upstream_timeout|upstream_network|cache_unavailable|unavailable)$/.test(error?.message||''))return error.message;
  if(error?.name==='TimeoutError'||error?.name==='AbortError')return 'news_upstream_timeout';
  return stage==='fetch'||stage==='body'?'news_upstream_network':stage==='persist'?'news_cache_unavailable':'news_unavailable';
}
export async function loadCalendar(env,current=Date.now(),upstream=fetch){
  // Keep the last successful validated calendar independent of negative cache entries.
  const lastGood=await env.DB.prepare("SELECT payload,fetched_at FROM crew_calendar WHERE id='ff_week_success'").bind().first();
  let validFallback=null;
  if(lastGood){try{const saved=JSON.parse(lastGood.payload);if(saved.week===newsWeek(current)&&Array.isArray(saved.events)&&saved.events.length&&saved.fetchedAt===lastGood.fetched_at)validFallback=saved}catch{/* Invalid backup cannot be used. */}}
  const row=await env.DB.prepare("SELECT payload,fetched_at FROM crew_calendar WHERE id='ff_week'").bind().first();
  const age=row?current-Date.parse(row.fetched_at):Infinity;
  if(Number.isFinite(age)&&age>=-5000&&age<15*60000){
    let saved;try{saved=JSON.parse(row.payload)}catch{/* A malformed cache must be refreshed from the source. */}
    if(saved?.error){if(age<(saved.error==='news_upstream_http_429'?15*60000:60000)){if(validFallback&&current-Date.parse(validFallback.fetchedAt)>=-5000&&current-Date.parse(validFallback.fetchedAt)<15*60000)return validFallback;throw calendarError(calendarErrorCode({message:saved.error},'cache'),saved.diagnostics||{})}}
    else if(saved?.week===newsWeek(current)&&Array.isArray(saved.events)&&saved.events.length&&saved.fetchedAt===row.fetched_at)return saved;
  }
  const diagnostics={stage:'fetch'};
  try{
    const response=await upstream(CALENDAR_URL,{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
    diagnostics.stage='response';diagnostics.status=response.status;
    // Store only the MIME token; never response bodies, redirect URLs, or arbitrary exception text.
    const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    diagnostics.contentType=/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)?type.slice(0,80):'unknown';
    if(!response.ok)throw calendarError('news_upstream_http_'+response.status);
    if(Number(response.headers.get('content-length')||0)>1000000)throw calendarError('news_feed_too_large');
    diagnostics.stage='body';const text=await response.text();diagnostics.bodyBytes=new TextEncoder().encode(text).byteLength;
    if(diagnostics.bodyBytes>1000000)throw calendarError('news_feed_too_large');
    diagnostics.stage='json';let raw;try{raw=JSON.parse(text)}catch{throw calendarError('news_invalid_json')}
    diagnostics.stage='calendar';diagnostics.eventCount=Array.isArray(raw)?raw.length:0;
    const calendar=parseCalendar(raw,current);
    diagnostics.stage='persist';
    await env.DB.prepare("INSERT INTO crew_calendar(id,payload,fetched_at) VALUES('ff_week',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at").bind(JSON.stringify(calendar),calendar.fetchedAt).run();
    await env.DB.prepare("INSERT INTO crew_calendar(id,payload,fetched_at) VALUES('ff_week_success',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at").bind(JSON.stringify(calendar),calendar.fetchedAt).run();
    return calendar;
  }catch(cause){
    const code=calendarErrorCode(cause,diagnostics.stage);
    diagnostics.errorType=['Error','TypeError','RangeError','SyntaxError','TimeoutError','AbortError'].includes(cause?.name)?cause.name:'Error';
    try{await env.DB.prepare("INSERT INTO crew_calendar(id,payload,fetched_at) VALUES('ff_week',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at").bind(JSON.stringify({error:code,diagnostics}),new Date(current).toISOString()).run()}
    catch{throw calendarError('news_cache_unavailable',diagnostics)}
    // A transient 429 must not invalidate still-fresh trusted data.
    // Retain its original timestamp; stale data NEVER authorizes orders.
    if(validFallback&&current-Date.parse(validFallback.fetchedAt)>=-5000&&current-Date.parse(validFallback.fetchedAt)<15*60000)return validFallback;
    throw calendarError(code,diagnostics);
  }
}
