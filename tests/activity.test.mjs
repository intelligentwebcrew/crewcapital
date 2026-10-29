import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityFeed,isConfirmedFill,createOrderFillAudio} from '../worker/activity.js';

const now=Date.parse('2026-10-29T12:00:00Z');
const event=(id,overrides={})=>({id,agent:'execution',state:'completed',message:'Ordem demo preenchida pela OANDA.',created_at:new Date(now-1000).toISOString(),run_id:'run-1',data:{tradeId:'101',transactionId:'102',instrument:'EUR_USD',price:'1.08'},...overrides});

test('first load records history without announcing even a recent fill',()=>{
  const feed=new ActivityFeed({now:()=>now});
  const result=feed.ingest([event('old')]);
  assert.equal(result.initial,true);
  assert.deepEqual(result.bubbles,[]);
  assert.deepEqual(result.fills,[]);
  assert.equal(feed.latestFor('execution').id,'old');
});
test('only completed execution with both broker IDs is a confirmed fill',()=>{
  assert.equal(isConfirmedFill(event('fill')),true);
  for(const bad of [{state:'running'},{state:'submitted'},{state:'not_filled'},{agent:'strategy'},{data:{tradeId:'101'}},{data:{transactionId:'102'}},{data:{tradeId:null,transactionId:null}},{data:{tradeId:'',transactionId:'102'}}])assert.equal(isConfirmedFill(event('bad',bad)),false);
});
test('new fill is emitted once across repeated polls and duplicate transaction events',()=>{
  const feed=new ActivityFeed({now:()=>now});feed.ingest([]);
  assert.equal(feed.ingest([event('new')]).fills.length,1);
  assert.deepEqual(feed.ingest([event('new')]).events,[]);
  assert.deepEqual(feed.ingest([event('another-id')]).fills,[]);
});
test('historical, invalid and future dates never play or appear as live speech',()=>{
  const feed=new ActivityFeed({now:()=>now});feed.ingest([]);
  const result=feed.ingest([event('old',{created_at:new Date(now-31000).toISOString()}),event('invalid',{created_at:'bad'}),event('future',{created_at:new Date(now+1000).toISOString()})]);
  assert.deepEqual(result.bubbles,[]);assert.deepEqual(result.fills,[]);
});
test('burst speech keeps only newest message per agent and at most two bubbles',()=>{
  const feed=new ActivityFeed({now:()=>now});feed.ingest([]);
  const rows=[event('1',{agent:'research'}),event('2',{agent:'research'}),event('3',{agent:'strategy'}),event('4',{agent:'risk'})];
  assert.deepEqual(feed.ingest(rows).bubbles.map(e=>e.id),['3','4']);
});
test('trimmed dedup history cannot replay an old persisted event',()=>{
  const feed=new ActivityFeed({now:()=>now,maxSeen:2});feed.ingest([]);
  feed.ingest([event('1'),event('2'),event('3')]);
  assert.deepEqual(feed.ingest([event('1')]).events,[]);
});
test('audio requires activation, respects mute and never queues a missed fill',async()=>{
  const spoken=[];
  const scope={SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{speaking:false,getVoices:()=>[{lang:'en-US',name:'English'}],speak:u=>spoken.push(u),cancel(){} }};
  const audio=createOrderFillAudio({scope,muted:false});
  assert.equal(audio.playFilled(),false);
  await audio.activate();assert.equal(spoken.length,0);
  assert.equal(audio.playFilled(),true);assert.equal(spoken[0].text,'Order Filled');assert.equal(spoken[0].lang,'en-US');
  audio.setMuted(true);assert.equal(audio.playFilled(),false);
  audio.setMuted(false);assert.equal(spoken.length,1);
});
