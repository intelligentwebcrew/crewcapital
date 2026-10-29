import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
export const SITE='https://luiz-agent-trading-office.intelligentwebcrew.chatgpt.site';
export function analysisIntervalMs(state){
 const value=state.analysisIntervalMinutes;
 return (Number.isInteger(value)&&value>=1&&value<=60?value:5)*60000;
}
export function eligible(state,now=Date.now()){
 if(state.environment!=='practice'||!state.autonomous||!state.aiConfigured||!state.brokerConfigured)return false;
 const usage=state.dailyUsage;
 if(usage&&(usage.day!==new Date(now).toISOString().slice(0,10)||usage.analyses>=state.maxDailyAnalyses||!usage.aiCanReserve))return false;
 const last=state.latest;
 if(!last)return true;
 if(last.status==='running'||['submitting','uncertain'].includes(last.order_state))return false;
 // Current persisted usage decides eligibility after budget edits or UTC rollover.
 // Legacy servers without usage data remain blocked until the next UTC day.
 if(!usage&&last.error==='ai_daily_budget'&&last.started_at.slice(0,10)===new Date(now).toISOString().slice(0,10))return false;
 return now-Date.parse(last.started_at)>=analysisIntervalMs(state);
}
export async function main(){
 const token=process.env.CREW_RUNNER_TOKEN;
 if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('runner_secret_missing');
 let stopped=false,cycleBusy=false,state=null,lastStatus=0,lastLog=0,nextAttempt=0,lastAttempt=0,lastSettings=null,failures=0;
 process.once('SIGTERM',()=>{stopped=true});process.once('SIGINT',()=>{stopped=true});
 const request=async(action)=>{
  const res=await fetch(SITE+'/api/runner/'+action,{method:action==='cycle'?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(action==='cycle'?{body:'{}'}:{}),redirect:'error',signal:AbortSignal.timeout(action==='cycle'?300000:20000)});
  const data=await res.json();if(!res.ok){const e=Error('request_failed');e.status=res.status;e.code=/^[a-z0-9_]+$/.test(data.error||'')?data.error:'request_failed';throw e}return data;
 };
 const log=(event,details={})=>console.log(JSON.stringify({time:new Date().toISOString(),event,...details}));
 log('runner_started',{environment:'practice',pricePollingTargetMs:1000,analysisIntervalSource:'persisted_preferences'});
 while(!stopped){
  const start=Date.now();
  try{
   if(start-lastStatus>=10000||!state){state=await request('status');lastStatus=Date.now();if(state.environment!=='practice')throw Error('environment_rejected')}
   const currentState=state;
   const interval=analysisIntervalMs(currentState);
   const settings=JSON.stringify({minutes:interval/60000,dailyAIBudget:currentState.dailyAIBudget,maxDailyAnalyses:currentState.maxDailyAnalyses});
   if(settings!==lastSettings){log('analysis_settings_updated',JSON.parse(settings));lastSettings=settings;}
   if(currentState.autonomous&&currentState.brokerConfigured){
    const market=await request('market');
    if(market.status!=='paused'){
     if(market.source!=='OANDA Practice'||!Array.isArray(market.instruments))throw Error('market_rejected');
     const fresh=market.instruments.filter(x=>x.quote?.status==='tradeable'&&Number.isFinite(Date.parse(x.quote.time))&&Date.now()-Date.parse(x.quote.time)<15000&&Date.parse(x.quote.time)<=Date.now()+5000);
     if(Date.now()-lastLog>=60000){log('market_observed',{instruments:market.count,fresh: fresh.length});lastLog=Date.now()}
     if(fresh.length&&!cycleBusy&&Date.now()>=nextAttempt&&Date.now()-lastAttempt>=interval&&eligible(currentState)){
      cycleBusy=true;lastAttempt=Date.now();
      // Monitoring continues while a cycle runs. Server enforces shared D1 locks and all limits.
      request('cycle').then(r=>log('cycle_returned',{runId:r.runId||null,status:r.status||null})).catch(e=>log('cycle_unconfirmed',{code:e.code||'transport_error'})).finally(()=>{cycleBusy=false;state=null});
     }
    }
   }
   failures=0;
  }catch(e){
   failures++;state=null;
   log('runner_blocked',{status:e.status||null,code:e.code||'transport_or_validation_error'});
   // Do not follow redirects, retry uncertain orders, or bypass expired/revoked credentials.
   if(e.status===401||e.status===403)nextAttempt=Date.now()+300000;
  }
  await delay(Math.max(failures?Math.min(60000,1000*2**Math.min(failures,6)):1000-(Date.now()-start),50));
 }
 log('runner_stopping');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Runner stopped: configuration or runtime error');process.exitCode=1});
