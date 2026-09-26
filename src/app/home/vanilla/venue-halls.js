import {createPhotoGallery} from './venue-gallery.js';

export const HALL_APIS=[1,2,3].map(category=>`https://api.indiatradefair.com/admin/itpo/api/v1/halls?hallCategory=${category}&size=100`);
const floorNames={GF:'Ground Floor',FF:'First Floor',details:'Hall details'};
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};

export function parseHallIdentity(value){
  const match=/^hall[\s_-]*(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)*)\s*(GF|FF)?$/i.exec(String(value).trim());
  if(!match)return null;
  return {halls:match[1].toUpperCase().split(/\s*[-–]\s*/),floor:match[2]?.toUpperCase()||null};
}

export function normalizeHalls(payloads){
  const records=[],seen=new Set();
  for(const payload of payloads){
    if(payload?.header?.error || !Array.isArray(payload?.data?.list))throw new Error('Invalid hall response');
    if(Number(payload.data.total)>payload.data.list.length)throw new Error('Incomplete hall response');
    for(const hall of payload.data.list){
      if(hall.isActive===false)continue;
      const identity=parseHallIdentity(hall.subHosterCode)||parseHallIdentity(hall.name);
      if(!identity)continue;
      const category=Number(hall.hallCategory?.id);
      const floor=identity.floor||({1:'GF',2:'FF'}[category])||'details';
      const id=String(hall.id??identity.halls.join('-')+'-'+floor);
      if(seen.has(id))continue;seen.add(id);
      const photos=[...new Set((Array.isArray(hall.imageHall)?hall.imageHall:[]).filter(doc=>doc.documentType!=='hallLayout').map(doc=>String(doc.documentUrl||'').trim()).filter(src=>{
        try{const url=new URL(src);return url.protocol==='https:'&&/\.(jpe?g|png|webp|avif)$/i.test(url.pathname);}catch{return false;}
      }))];
      const rawArea=hall.hallAreaCapacity;
      const area=rawArea!==null&&rawArea!==undefined&&rawArea!==''&&Number.isFinite(Number(rawArea))&&Number(rawArea)>=0?Number(rawArea):null;
      records.push({id,name:String(hall.name||'Hall '+identity.halls.join('–')),halls:identity.halls,floor,area,photos,category:String(hall.hallCategory?.name||'Exhibition hall')});
    }
  }
  return records.sort((a,b)=>({GF:0,FF:1,details:2}[a.floor])-({GF:0,FF:1,details:2}[b.floor])||a.name.localeCompare(b.name));
}

export function recordsForHall(records,hallNumber){
  return records.filter(record=>record.halls.includes(String(hallNumber).toUpperCase()));
}

export function createHallBrowser(container, signal){
  let generation=0,cache,pending;
  const load=()=>{
    if(cache)return Promise.resolve(cache);
    if(!pending)pending=Promise.allSettled(HALL_APIS.map(async url=>{
      const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),credentials:'omit'});
      if(!response.ok)throw new Error('Hall service unavailable');return response.json();
    })).then(results=>{
      const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
      return cache=normalizeHalls(results.map(result=>result.value));
    }).finally(()=>{pending=null;});
    return pending;
  };
  async function show(hallNumber){
    const ticket=++generation;container.replaceChildren();container.setAttribute('aria-busy','true');
    const status=element('p','room-list-status','Loading hall details…');status.setAttribute('role','status');container.append(status);
    try{
      const all=await load();if(ticket!==generation)return;
      const records=recordsForHall(all,hallNumber);
      if(!records.length){status.textContent='No details are currently listed for this hall.';return;}
      const floors=[...new Set(records.map(record=>record.floor))];
      const tabs=element('div','room-level-tabs hall-floor-tabs');tabs.setAttribute('aria-label','Hall '+hallNumber+' floors');
      const content=element('div','hall-floor-content');
      const render=floor=>{
        const focusWasInTabs=tabs.contains(container.getRootNode().activeElement);
        tabs.replaceChildren();content.replaceChildren();
        for(const key of floors){const button=element('button',key===floor?'active':'',floorNames[key]);button.type='button';button.setAttribute('aria-pressed',String(key===floor));button.onclick=()=>render(key);tabs.append(button);if(focusWasInTabs&&key===floor)button.focus();}
        status.textContent=floors.length>1?'Explore each floor’s photos and area.':floorNames[floor];
        for(const record of records.filter(item=>item.floor===floor)){
          const shared=record.halls.length>1;
          if(shared)content.append(element('p','hall-shared-note','Shared listing for Halls '+record.halls.join(', ')+'. Photos and area cover the combined halls.'));
          const card=element('article','room-card hall-card');card.dataset.hallRecord=record.id;card.dataset.floor=record.floor;
          const label=shared?'Halls '+record.halls.join('–'):'Hall '+hallNumber;
          const title=label+(record.floor==='details'?'':' · '+floorNames[record.floor]);
          card.append(createPhotoGallery({name:title,photos:record.photos}));
          const info=element('div','room-info');info.append(element('h3',null,title));
          const facts=element('dl','room-facts');
          for(const [name,value] of [[shared?'Combined floor area':'Floor area',record.area===null?'Not listed':record.area.toLocaleString('en-IN')+' m²'],['Floor',record.floor==='details'?'Not specified':floorNames[record.floor]]]){
            const pair=element('div');pair.append(element('dt',null,name),element('dd',null,value));facts.append(pair);
          }
          info.append(facts,element('p','hall-category',record.category));card.append(info);content.append(card);
        }
      };
      if(floors.length>1)container.prepend(tabs);
      container.append(content);render(floors[0]);
      container.append(element('p','room-source','Hall information and photos · ITPO'));
    }catch{
      if(ticket!==generation)return;
      status.textContent='Hall details could not be loaded. Please try again.';
      const retry=element('button','room-retry','Retry');retry.onclick=()=>show(hallNumber);container.append(retry);
    }finally{if(ticket===generation)container.setAttribute('aria-busy','false');}
  }
  return {show,preload:load,cancel(){generation++;container.setAttribute('aria-busy','false');}};
}
