# Real agents implementation plan
Goal: persistent demo-only broker connection, real model-driven analysis and animated WebGL office.
Architecture: owner-private Worker, encrypted D1 credential, audited sequential agent cycles, fixed OANDA practice host. User requests direct implementation; execute inline.
Tasks:
- [ ] Add persistent configuration, encryption, run lock and events; test auth, origin and secret redaction.
- [ ] Add real OANDA candles/prices/account adapter and structured model calls; test stale input, malformed output and fail-closed behavior.
- [ ] Add risk-bounded demo execution: EUR_USD only, USD account, 500 USD budget, 2.50 USD planned risk, 10 USD daily loss, one trade maximum. Orders require explicit enabled runtime state. Reconcile uncertain submissions; never retry blindly.
- [ ] Build articulated WebGL office; drive work animation from persisted run events, idle movement separately labelled. Provide secure broker setup and model readiness without fictitious values.
- [ ] Run backend/security tests, browser interaction checks, package and publish. External calls remain unverified until new broker and model credentials supplied.
