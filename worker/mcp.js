import {readPreferences} from './preferences.js';

const crewTools=[
  {name:'crew_automation_status',description:'Read persisted automation preferences and actual demo agent status. Does not assert a scheduler is active.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'crew_run_demo_cycle',description:'Run one authorized OANDA Practice cycle using stored autonomy and execution preferences and existing fixed risk/cost locks. Skips when paused.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'crew_daily_report',description:'Read the previous 24 hours of actual demo results and estimated AI costs for the fixed report recipient. Does not send email or place orders.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
const crewMcpReply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const crewMcpResult=(id,data,isError=false)=>crewMcpReply({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(data)}],isError}});
const crewMcpError=(id,code,message,status=200)=>crewMcpReply({jsonrpc:'2.0',id,error:{code,message}},status);
const finiteNumber=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null;

export function createCrewMcp({agentApi}){
  async function invoke(request,env,path,body){
    const origin=new URL(request.url).origin;
    const headers={'oai-authenticated-user-id':env.CREW_AUTH_OWNER,origin,'content-type':'application/json'};
    const response=await agentApi(new Request(origin+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    const data=await response.json();return {ok:response.ok,data};
  }
  async function dailyReport(request,env,prefs){
    if(!prefs.dailyReport)return {status:'skipped',reason:'daily_report_disabled'};
    const end=new Date().toISOString(),start=new Date(Date.parse(end)-86400000).toISOString();
    // This GET reconciles recorded trades against the broker; it never submits an order.
    const reconciliation=await invoke(request,env,'/api/crew/performance');
    const owner=env.CREW_AUTH_OWNER;
    const [trades,calls,runs,open,market]=await Promise.all([
      env.DB.prepare("SELECT trade_id,instrument,net_broker,sync_error,closed_at FROM crew_trades WHERE owner=? AND state='CLOSED' AND closed_at>=? AND closed_at<? ORDER BY closed_at").bind(owner,start,end).all(),
      env.DB.prepare('SELECT status,cost_usd FROM crew_calls WHERE owner=? AND created_at>=? AND created_at<?').bind(owner,start,end).all(),
      env.DB.prepare('SELECT id,status,error,order_state,started_at FROM crew_runs WHERE owner=? AND started_at>=? AND started_at<? ORDER BY started_at').bind(owner,start,end).all(),
      env.DB.prepare("SELECT trade_id,instrument,state,units,entry_price,opened_at,sync_error FROM crew_trades WHERE owner=? AND state!='CLOSED' ORDER BY opened_at").bind(owner).all(),
      invoke(request,env,'/api/crew/market')
    ]);
    const closed=trades.results||[],costs=calls.results||[],cycles=runs.results||[];
    const unknownCostCalls=costs.filter(c=>!['priced','cancelled'].includes(c.status)||finiteNumber(c.cost_usd)===null).length;
    const aiCostEstimate=costs.reduce((sum,c)=>sum+(finiteNumber(c.cost_usd)??0),0);
    const unreconciledClosed=closed.filter(t=>t.sync_error||finiteNumber(t.net_broker)===null).length;
    const brokerNet=unreconciledClosed||!reconciliation.ok?null:closed.reduce((sum,t)=>sum+Number(t.net_broker),0);
    const uncertainOrders=cycles.filter(r=>['submitting','uncertain'].includes(r.order_state)).length;
    const a=market.data;
    return {status:'report_ready',recipient:prefs.reportEmail,environment:'practice',period:{start,end,basis:'previous_24_hours'},reportTimezone:prefs.reportTimezone,reportHour:prefs.reportHour,
      closedTrades:closed.length,brokerNet,aiCostEstimate,unknownCostCalls,unreconciledClosed,uncertainOrders,
      netAfterAI:brokerNet===null||unknownCostCalls||uncertainOrders?null:brokerNet-aiCostEstimate,
      costBasis:'Estimated token costs using stored versioned rates; not the OpenAI invoice. Open unrealized P/L is excluded from closed net. Spread is already in broker P/L.',
      reconciliation:{ok:reconciliation.ok,error:reconciliation.ok?null:reconciliation.data.error||'reconciliation_unavailable'},
      account:market.ok?{receivedAt:a.receivedAt||null,currency:a.currency||null,balance:finiteNumber(a.balance),nav:finiteNumber(a.nav),unrealizedPL:finiteNumber(a.unrealizedPL),openTradeCount:finiteNumber(a.openTradeCount)}:null,
      accountError:market.ok?null:a.error||'market_unavailable',recordedOpenPositions:open.results||[],cycles,closedTradeDetails:closed,emailSent:false};
  }
  return async function crewMcp(request,env){
    if(request.method!=='POST')return crewMcpError(null,-32600,'POST required',405);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return crewMcpError(null,-32600,'JSON required',415);
    if(Number(request.headers.get('content-length')||0)>4096)return crewMcpError(null,-32600,'Request too large',413);
    const raw=await request.text();if(raw.length>4096)return crewMcpError(null,-32600,'Request too large',413);
    let body;try{body=JSON.parse(raw)}catch{return crewMcpError(null,-32700,'Parse error',400)}
    if(!body||Array.isArray(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string')return crewMcpError(null,-32600,'Invalid request',400);
    const id=body.id??null;
    if(body.method==='server/discover')return crewMcpReply({jsonrpc:'2.0',id,result:{supportedVersions:['2026-07-28'],capabilities:{tools:{}},serverInfo:{name:'crew-capital',version:'1.0.0'}}});
    if(body.method==='tools/list')return crewMcpReply({jsonrpc:'2.0',id,result:{tools:crewTools}});
    if(body.method!=='tools/call')return crewMcpError(id,-32601,'Method not found');
    // Sites supplies both headers only after native authentication; custom login cookies never grant MCP access.
    const userId=request.headers.get('oai-authenticated-user-id');
    const email=request.headers.get('oai-authenticated-user-email');
    if(!userId?.trim()||!email||!env.CREW_MCP_OWNER_EMAIL||email!==env.CREW_MCP_OWNER_EMAIL||!env.CREW_AUTH_OWNER)return crewMcpError(id,-32001,'Owner authentication required',403);
    const name=body.params?.name,args=body.params?.arguments??{};
    if(!crewTools.some(t=>t.name===name))return crewMcpResult(id,{error:'unknown_tool'},true);
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return crewMcpResult(id,{error:'invalid_arguments'},true);
    try{
      const prefs=await readPreferences(env,env.CREW_AUTH_OWNER);
      if(name==='crew_run_demo_cycle'){
        if(!prefs.autonomous)return crewMcpResult(id,{status:'skipped',reason:'automation_paused'});
        const run=await invoke(request,env,'/api/crew/run',{execute:prefs.executeDemo});
        return crewMcpResult(id,run.ok?run.data:{status:'blocked',reason:run.data.error||'cycle_unavailable'},!run.ok);
      }
      if(name==='crew_daily_report')return crewMcpResult(id,await dailyReport(request,env,prefs));
      const status=await invoke(request,env,'/api/crew/status');
      return crewMcpResult(id,{preferences:prefs,agent:status.data,scheduler:{state:'not_verified',browserRequired:false}},!status.ok);
    }catch{return crewMcpResult(id,{status:'blocked',reason:'automation_service_unavailable'},true)}
  };
}
