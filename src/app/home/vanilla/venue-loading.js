const weights={venue:80,rooms:10,halls:10};

// Opening the explorer requires all three sources, independent of finish order.
export function createReadinessGate({onChange=()=>{},onReady=()=>{}}={}){
  const entries=Object.fromEntries(Object.keys(weights).map(id=>[id,{state:'loading',progress:0,task:null,pending:null}]));
  let opened=false;
  const snapshot=()=>({stages:Object.fromEntries(Object.entries(entries).map(([id,e])=>[id,{state:e.state,progress:e.progress}])),percent:Math.floor(Object.entries(entries).reduce((sum,[id,e])=>sum+weights[id]*e.progress,0)),ready:Object.values(entries).every(e=>e.state==='ready')});
  function publish(){const state=snapshot();onChange(state);if(state.ready&&!opened){opened=true;onReady();}}
  function run(id,task){
    const entry=entries[id];if(!entry)throw new Error('Unknown loading stage');
    if(entry.pending)return entry.pending;
    if(entry.state==='ready')return Promise.resolve();
    entry.task=task;entry.state='loading';entry.progress=0;publish();
    entry.pending=Promise.resolve().then(task).then(()=>{entry.state='ready';entry.progress=1;},()=>{entry.state='error';entry.progress=0;}).finally(()=>{entry.pending=null;publish();});
    return entry.pending;
  }
  return {run,snapshot,progress(id,value){const entry=entries[id];if(entry?.state==='loading'&&Number.isFinite(value)){entry.progress=Math.max(entry.progress,Math.min(.98,Math.max(0,value)));publish();}},retry(){return Promise.all(Object.entries(entries).filter(([,e])=>e.state==='error').map(([id,e])=>run(id,e.task)));}};
}

export function createLoadingScreen(root, signal){
  const $=selector=>root.querySelector(selector),overlay=$('#loading');
  const background=[...root.children].filter(node=>node!==overlay&&node.tagName!=='SCRIPT').map(node=>[node,node.inert]);
  background.forEach(([node])=>{node.inert=true;});
  const gate=createReadinessGate({
    onChange({stages,percent,ready}){
      if(signal.aborted)return;
      for(const [id,entry]of Object.entries(stages)){
        const node=$('#loading-stage-'+id);node.dataset.state=entry.state;
        node.textContent={loading:'Loading…',ready:'Ready',error:'Try again'}[entry.state];
      }
      const failed=Object.values(stages).some(entry=>entry.state==='error');
      $('#loading-retry').hidden=!failed;overlay.setAttribute('aria-busy',String(!failed&&!ready));
      $('#load-bar').style.width=percent+'%';$('#progress').textContent=percent+'%';
      $('#loading-progressbar').setAttribute('aria-valuenow',String(percent));
      $('#loading-status').textContent=failed?'We couldn’t finish loading your experience. Please try again.':ready?'Your experience is ready.':stages.venue.state==='ready'?'Preparing your halls and meeting rooms…':'Loading Bharat Mandapam…';
    },
    onReady(){if(signal.aborted)return;overlay.hidden=true;background.forEach(([node,inert])=>{node.inert=inert;});}
  });
  $('#loading-retry').onclick=()=>{if(gate.snapshot().stages.venue.state==='error')location.reload();else gate.retry();};
  return gate;
}
