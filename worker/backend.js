const BASE = 'https://api-fxpractice.oanda.com';
const json = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function api(request, env, upstream=fetch) {
  const path = new URL(request.url).pathname;
  // Sites dispatch enforces owner-private access. Never expose broker data anonymously.
  if (!request.headers.get('oai-authenticated-user-id')) return json({error:'authentication_required'},401);
  if (request.method !== 'GET') return json({error:'method_not_allowed'},405);
  if (!['/api/oanda/status','/api/oanda/summary','/api/oanda/prices'].includes(path)) return json({error:'not_found'},404);
  if (path.endsWith('/status')) return json({environment:'practice',configured:!!(env.OANDA_DEMO_TOKEN && env.OANDA_DEMO_ACCOUNT_ID),tradingEnabled:false});
  if (!env.OANDA_DEMO_TOKEN || !env.OANDA_DEMO_ACCOUNT_ID) return json({error:'not_configured',environment:'practice'},503);
  if (!/^101-\d{3}-\d+-\d{3}$/.test(env.OANDA_DEMO_ACCOUNT_ID)) return json({error:'invalid_demo_account'},503);
  const account = encodeURIComponent(env.OANDA_DEMO_ACCOUNT_ID);
  const suffix = path.endsWith('/summary') ? '/summary' : '/pricing?instruments=EUR_USD,GBP_USD,USD_JPY';
  let response;
  try {
    response = await upstream(`${BASE}/v3/accounts/${account}${suffix}`, {method:'GET',headers:{Authorization:`Bearer ${env.OANDA_DEMO_TOKEN}`},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if (!response.ok) return json({error:response.status===401 || response.status===403?'broker_authentication_failed':'broker_unavailable'},502);
    const data = await response.json();
    if (path.endsWith('/summary')) {
      const a=data.account;
      if (!a || !a.currency || a.balance===undefined || a.NAV===undefined) return json({error:'invalid_broker_response'},502);
      return json({environment:'practice',source:'OANDA',receivedAt:new Date().toISOString(),currency:a.currency,balance:a.balance,nav:a.NAV,unrealizedPL:a.unrealizedPL,realizedPL:a.pl,openTradeCount:a.openTradeCount,openPositionCount:a.openPositionCount,tradingEnabled:false});
    }
    if (!Array.isArray(data.prices)) return json({error:'invalid_broker_response'},502);
    return json({environment:'practice',source:'OANDA',receivedAt:new Date().toISOString(),prices:data.prices.map(p=>({instrument:p.instrument,time:p.time,status:p.status,bid:p.bids?.[0]?.price,ask:p.asks?.[0]?.price}))});
  } catch { return json({error:'broker_connection_failed'},502); }
}
