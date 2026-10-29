import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import * as preferences from '../worker/preferences.js';
import * as mcp from '../worker/mcp.js';

function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const name of ['0000_agents.sql','0001_measurement.sql','0003_preferences.sql']) sql.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  const DB={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)||null},async all(){return {results:sql.prepare(q).all(...args)}},async run(){return sql.prepare(q).run(...args)}}}}}};
  return {sql,DB,CREW_AUTH_OWNER:'crew-owner',CREW_MCP_OWNER_EMAIL:'infowebcrew@gmail.com'};
}
const call=(name,args={},headers={'oai-authenticated-user-id':'native-owner','oai-authenticated-user-email':'infowebcrew@gmail.com'})=>new Request('https://crew.test/mcp',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
const result=async response=>JSON.parse((await response.json()).result.content[0].text);

test('first read persists defaults and updates survive subsequent reads',async()=>{
  const e=fixture(); const initial=await preferences.readPreferences(e,'crew-owner');
  assert.equal(initial.autonomous,true);assert.equal(initial.executeDemo,true);assert.equal(initial.reportEmail,'luizlz@gmail.com');
  assert.equal(e.sql.prepare('SELECT count(*) n FROM crew_preferences').get().n,1);
  assert.deepEqual(await preferences.readPreferences(e,'crew-owner'),initial);
  const updated=await preferences.updatePreferences(e,'crew-owner',{soundEnabled:false,autonomous:false});
  assert.equal(updated.version,initial.version+1);assert.equal(updated.soundEnabled,false);
  assert.equal((await preferences.readPreferences(e,'crew-owner')).autonomous,false);e.sql.close();
});
test('invalid preferences never partially write and cannot redirect reports',async()=>{
  const e=fixture();const before=await preferences.readPreferences(e,'crew-owner');
  for(const patch of [{soundEnabled:'false'},{executeDemo:1},{reportEmail:'other@example.com'},{reportTimezone:'Moon/Base'},{reportHour:24},{unknown:true},{autonomous:false,reportEmail:'other@example.com'}]) await assert.rejects(preferences.updatePreferences(e,'crew-owner',patch));
  assert.deepEqual(await preferences.readPreferences(e,'crew-owner'),before);e.sql.close();
});
test('preferences API enforces owner, origin and persists valid changes',async()=>{
  const e=fixture();const req=(headers,body)=>new Request('https://crew.test/api/crew/preferences',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await preferences.preferencesApi(req({origin:'https://crew.test'},{soundEnabled:false}),e)).status,401);
  assert.equal((await preferences.preferencesApi(req({'oai-authenticated-user-id':'crew-owner',origin:'https://evil.test'},{soundEnabled:false}),e)).status,403);
  assert.equal((await preferences.preferencesApi(req({'oai-authenticated-user-id':'crew-owner',origin:'https://crew.test'},{soundEnabled:false}),e)).status,200);
  assert.equal((await preferences.readPreferences(e,'crew-owner')).soundEnabled,false);e.sql.close();
});
test('MCP actual calls reject missing or mismatched native owner identity without invoking API',async()=>{
  const e=fixture();const handler=mcp.createCrewMcp({agentApi:async()=>assert.fail('unauthorized request reached API')});
  for(const headers of [{},{'oai-authenticated-user-id':'native-owner'},{'oai-authenticated-user-email':'infowebcrew@gmail.com'},{'oai-authenticated-user-id':'native-owner','oai-authenticated-user-email':'attacker@example.com'}]){
    const response=await handler(call('crew_run_demo_cycle',{},headers),e);assert.equal(response.status,403);
  }
  assert.equal((await handler(call('crew_daily_report'),{...e,CREW_MCP_OWNER_EMAIL:undefined})).status,403);
  assert.equal(e.sql.prepare('SELECT count(*) n FROM crew_preferences').get().n,0);e.sql.close();
});
test('paused autonomy makes no broker or AI requests',async()=>{
  const e=fixture();await preferences.updatePreferences(e,'crew-owner',{autonomous:false});
  const handler=mcp.createCrewMcp({agentApi:async()=>assert.fail('paused automation reached API')});
  assert.equal((await result(await handler(call('crew_run_demo_cycle'),e))).reason,'automation_paused');e.sql.close();
});
test('MCP never accepts execution overrides and uses only stored owner and demo mode',async()=>{
  const e=fixture();await preferences.updatePreferences(e,'crew-owner',{executeDemo:false});
  const handler=mcp.createCrewMcp({agentApi:async r=>{
    assert.equal(r.headers.get('oai-authenticated-user-id'),'crew-owner');assert.equal(r.headers.get('origin'),'https://crew.test');
    assert.equal(new URL(r.url).pathname,'/api/crew/run');assert.deepEqual(await r.json(),{execute:false});
    return Response.json({runId:'real-run'});
  }});
  assert.equal((await result(await handler(call('crew_run_demo_cycle',{execute:true}),e))).error,'invalid_arguments');
  assert.equal((await result(await handler(call('crew_run_demo_cycle'),e))).runId,'real-run');e.sql.close();
});
test('missing AI key is reported as blocked without pretending a cycle ran',async()=>{
  const e=fixture();const handler=mcp.createCrewMcp({agentApi:async()=>Response.json({error:'ai_not_configured'},{status:503})});
  const r=await result(await handler(call('crew_run_demo_cycle'),e));assert.equal(r.status,'blocked');assert.equal(r.reason,'ai_not_configured');assert.equal(r.runId,undefined);e.sql.close();
});
test('daily report excludes old and other-owner rows and withholds net for unknown AI costs',async()=>{
  const e=fixture(),now=new Date(Date.now()-1000).toISOString(),old=new Date(Date.now()-2*86400000).toISOString();
  for(const [id,owner,time,net] of [['1','crew-owner',now,5],['2','crew-owner',old,100],['3','other-owner',now,500]]) e.sql.prepare("INSERT INTO crew_trades(trade_id,owner,account_id,run_id,arm,state,closed_at,net_broker,instrument) VALUES(?,?, 'SECRET-ACCOUNT','run','ai','CLOSED',?,?, 'EUR_USD')").run(id,owner,time,net);
  e.sql.prepare("INSERT INTO crew_calls(id,owner,run_id,agent,model,status,cost_usd,created_at) VALUES('call','crew-owner','run','research','model','unknown',NULL,?)").run(now);
  const handler=mcp.createCrewMcp({agentApi:async r=>new URL(r.url).pathname.endsWith('/market')?Response.json({balance:'500',nav:'501',currency:'USD',openTradeCount:1,unrealizedPL:'1'}):Response.json({sampleComplete:false})});
  const report=await result(await handler(call('crew_daily_report'),e));assert.equal(report.recipient,'luizlz@gmail.com');assert.equal(report.closedTrades,1);assert.equal(report.brokerNet,5);assert.equal(report.netAfterAI,null);assert.equal(report.unknownCostCalls,1);assert.equal(report.account.balance,500);assert.ok(!JSON.stringify(report).includes('SECRET-ACCOUNT'));
  e.sql.prepare("UPDATE crew_calls SET status='priced',cost_usd=0.02").run();
  const priced=await result(await handler(call('crew_daily_report'),e));assert.equal(priced.netAfterAI,4.98);
  await preferences.updatePreferences(e,'crew-owner',{dailyReport:false});
  const disabled=mcp.createCrewMcp({agentApi:async()=>assert.fail('disabled report reached API')});assert.equal((await result(await disabled(call('crew_daily_report'),e))).reason,'daily_report_disabled');e.sql.close();
});
test('MCP discovery and tool listing are public but expose no settings or secrets',async()=>{
  const handler=mcp.createCrewMcp({agentApi:async()=>assert.fail('discovery reached API')});
  for(const method of ['server/discover','tools/list']){
    const r=await handler(new Request('https://crew.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method})}),{});
    assert.equal(r.status,200);const body=await r.json();if(method==='tools/list')assert.equal(body.result.tools.length,3);else assert.deepEqual(body.result.supportedVersions,['2026-07-28']);
    assert.ok(!JSON.stringify(body).includes('luizlz@gmail.com'));
  }
});
