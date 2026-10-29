export const DEFAULT_PREFERENCES=Object.freeze({autonomous:true,executeDemo:true,soundEnabled:true,dailyReport:true,reportEmail:'luizlz@gmail.com',reportTimezone:'America/New_York',reportHour:18});
const preferenceColumns={autonomous:'autonomous',executeDemo:'execute_demo',soundEnabled:'sound_enabled',dailyReport:'daily_report',reportEmail:'report_email',reportTimezone:'report_timezone',reportHour:'report_hour'};
const booleanPreferences=new Set(['autonomous','executeDemo','soundEnabled','dailyReport']);
const preferenceReply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
function preferenceError(code){throw new Error(code)}
function preferenceOwner(env,owner){if(!env.DB)preferenceError('storage_not_configured');if(!env.CREW_AUTH_OWNER||owner!==env.CREW_AUTH_OWNER)preferenceError('authentication_required')}
function preferenceValue(row){return {autonomous:row.autonomous===1,executeDemo:row.execute_demo===1,soundEnabled:row.sound_enabled===1,dailyReport:row.daily_report===1,reportEmail:row.report_email,reportTimezone:row.report_timezone,reportHour:row.report_hour,version:row.version,updatedAt:row.updated_at}}
export async function readPreferences(env,owner){
  preferenceOwner(env,owner);
  await env.DB.prepare('INSERT OR IGNORE INTO crew_preferences(owner,updated_at) VALUES(?,?)').bind(owner,new Date().toISOString()).run();
  const row=await env.DB.prepare('SELECT * FROM crew_preferences WHERE owner=?').bind(owner).first();
  if(!row)preferenceError('preferences_unavailable');
  return preferenceValue(row);
}
export async function updatePreferences(env,owner,patch){
  preferenceOwner(env,owner);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length)preferenceError('invalid_preferences');
  const fields=Object.entries(patch);
  for(const [key,value] of fields){
    if(!Object.hasOwn(preferenceColumns,key))preferenceError('invalid_preferences');
    if(booleanPreferences.has(key)&&typeof value!=='boolean')preferenceError('invalid_preferences');
    if(key==='reportEmail'&&value!==DEFAULT_PREFERENCES.reportEmail)preferenceError('invalid_report_email');
    if(key==='reportHour'&&(!Number.isInteger(value)||value<0||value>23))preferenceError('invalid_report_hour');
    if(key==='reportTimezone'){
      if(typeof value!=='string'||value.length>100||!(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(value)||value==='UTC'))preferenceError('invalid_report_timezone');
      try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format()}catch{preferenceError('invalid_report_timezone')}
    }
  }
  await readPreferences(env,owner);
  // Apply only supplied fields in one statement, so simultaneous audio and automation updates do not overwrite each other.
  const assignments=fields.map(([key])=>preferenceColumns[key]+'=?').join(',');
  await env.DB.prepare('UPDATE crew_preferences SET '+assignments+',version=version+1,updated_at=? WHERE owner=?').bind(...fields.map(([key,value])=>booleanPreferences.has(key)?Number(value):value),new Date().toISOString(),owner).run();
  return readPreferences(env,owner);
}
// The router must first validate the password session and replace incoming identity headers.
export async function preferencesApi(request,env){
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner||!env.CREW_AUTH_OWNER||owner!==env.CREW_AUTH_OWNER)return preferenceReply({error:'authentication_required'},401);
  if(!env.DB)return preferenceReply({error:'storage_not_configured'},503);
  if(new URL(request.url).pathname!=='/api/crew/preferences')return preferenceReply({error:'not_found'},404);
  if(!['GET','POST'].includes(request.method))return preferenceReply({error:'method_not_allowed'},405);
  if(request.method==='POST'&&(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json')))return preferenceReply({error:'invalid_origin_or_content_type'},403);
  try{
    if(request.method==='GET')return preferenceReply({preferences:await readPreferences(env,owner)});
    if(Number(request.headers.get('content-length')||0)>2048)return preferenceReply({error:'body_too_large'},413);
    const raw=await request.text();if(raw.length>2048)return preferenceReply({error:'body_too_large'},413);
    let patch;try{patch=JSON.parse(raw)}catch{return preferenceReply({error:'invalid_json'},400)}
    return preferenceReply({preferences:await updatePreferences(env,owner,patch)});
  }catch(error){const code=/^invalid_/.test(error.message)?error.message:'preferences_unavailable';return preferenceReply({error:code},code==='preferences_unavailable'?503:400)}
}
