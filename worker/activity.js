// Only persisted events enter this policy. There are no simulated speech timers.
const eventTime=event=>Date.parse(event?.created_at);
function eventData(event){
  if(typeof event?.data==='string'){try{return JSON.parse(event.data)||{}}catch{return {}}}
  return event?.data||{};
}
export function isConfirmedFill(event){
  const data=eventData(event);
  return event?.agent==='execution'&&event.state==='completed'&&
    /^\d+$/.test(String(data.tradeId??''))&&/^\d+$/.test(String(data.transactionId??''));
}

export class ActivityFeed{
  constructor({now=()=>Date.now(),maxAgeMs=30000,maxBubbles=2,maxSeen=2048}={}){
    this.now=now;this.maxAgeMs=maxAgeMs;this.maxBubbles=Math.max(0,Math.min(2,maxBubbles));
    this.maxSeen=Math.max(1,maxSeen);this.started=false;this.seen=new Map();this.filled=new Map();
    this.latest=new Map();this.floor=-Infinity;
  }
  latestFor(agent){return this.latest.get(agent)||null}
  ingest(rows){
    const initial=!this.started;this.started=true;const now=this.now();
    const events=[],fills=[],bubbles=new Map();
    const ordered=(Array.isArray(rows)?rows:[]).filter(e=>e&&e.id!=null).slice().sort((a,b)=>(eventTime(a)||0)-(eventTime(b)||0));
    for(const event of ordered){
      const time=eventTime(event),id=String(event.id);
      if(this.seen.has(id)||!Number.isFinite(time)||time<=this.floor)continue;
      this.seen.set(id,time);
      const latest=this.latest.get(event.agent);
      if(!latest||time>=eventTime(latest))this.latest.set(event.agent,event);
      const data=eventData(event),fillKey=isConfirmedFill(event)?String(data.transactionId):null;
      const newFill=fillKey&&!this.filled.has(fillKey);
      if(fillKey)this.filled.set(fillKey,time);
      const live=time<=now&&now-time<this.maxAgeMs;
      if(!initial&&live){
        events.push(event);
        if(typeof event.message==='string'&&event.message.trim()){
          bubbles.delete(event.agent);bubbles.set(event.agent,event);
        }
        if(newFill)fills.push(event);
      }
    }
    // Advancing the floor when pruning means an evicted event cannot play again.
    while(this.seen.size>this.maxSeen){const [id,time]=this.seen.entries().next().value;this.seen.delete(id);this.floor=Math.max(this.floor,time)}
    for(const [id,time]of this.filled)if(time<=this.floor||now-time>=this.maxAgeMs)this.filled.delete(id);
    return {initial,events,bubbles:this.maxBubbles?[...bubbles.values()].slice(-this.maxBubbles):[],fills};
  }
}

// Local browser APIs only. Activation belongs in a user click handler; a blocked
// or muted notification is discarded rather than replayed after activation.
export function createOrderFillAudio({scope=globalThis,muted=true}={}){
  let enabled=false,context=null,isMuted=Boolean(muted),lastPlayed=-Infinity;
  const synth=scope.speechSynthesis;
  return {
    get muted(){return isMuted},get activated(){return enabled},
    async activate(){
      enabled=true;
      try{
        const Audio=scope.AudioContext||scope.webkitAudioContext;
        if(Audio&&!context)context=new Audio();
        if(context?.state==='suspended')await context.resume();
      }catch{/* Speech synthesis can still work when Web Audio is unavailable. */}
      return enabled;
    },
    setMuted(value){isMuted=Boolean(value);if(isMuted){try{synth?.cancel()}catch{}}return isMuted},
    playFilled(){
      const now=Date.now();
      if(!enabled||isMuted||scope.document?.hidden||now-lastPlayed<1800||synth?.speaking)return false;
      let played=false;
      try{
        if(context?.state==='running'){
          const gain=context.createGain();gain.connect(context.destination);
          gain.gain.setValueAtTime(0.0001,context.currentTime);
          gain.gain.exponentialRampToValueAtTime(.08,context.currentTime+.025);
          gain.gain.exponentialRampToValueAtTime(.0001,context.currentTime+.45);
          for(const [frequency,delay]of [[660,0],[880,.12]]){
            const tone=context.createOscillator();tone.type='sine';tone.frequency.value=frequency;tone.connect(gain);
            tone.start(context.currentTime+delay);tone.stop(context.currentTime+delay+.3);
            tone.onended=()=>tone.disconnect();
          }
          setTimeout(()=>gain.disconnect(),700);played=true;
        }
      }catch{/* An unavailable audio device must not interrupt event processing. */}
      try{
        if(synth&&scope.SpeechSynthesisUtterance){
          const speech=new scope.SpeechSynthesisUtterance('Order Filled');speech.lang='en-US';speech.rate=.94;speech.volume=.8;
          const voice=synth.getVoices().find(v=>v.lang==='en-US');if(voice)speech.voice=voice;
          synth.speak(speech);played=true;
        }
      }catch{/* Browsers without speech synthesis still receive the chime. */}
      if(played)lastPlayed=now;return played;
    }
  };
}
