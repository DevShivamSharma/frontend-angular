import {createPhotoGallery} from './venue-gallery.js';

export const ROOMS_API='https://api.indiatradefair.com/cc/itpo/api/v1/rooms/usr/room/all';

export function normalizeRooms(payload){
  if(payload?.header?.error || !Array.isArray(payload?.data?.list))throw new Error('Invalid room response');
  const seen=new Set();
  return payload.data.list.flatMap(room=>{
    const level=Number(/^level\s*([123])$/i.exec(String(room.level).trim())?.[1]);
    if(!level || room.isActive===false || !room.name || seen.has(room.id))return [];
    seen.add(room.id);
    const number=value=>value!==null && value!=='' && Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : null;
    const photos=[...new Set((Array.isArray(room.roomDocs)?room.roomDocs:[]).filter(src=>{
      try {const url=new URL(src);return url.protocol==='https:' && /\.(jpe?g|png|webp|avif)(?:$)/i.test(url.pathname);}catch{return false;}
    }))];
    return [{id:room.id,name:String(room.name),level,area:number(room.area),capacity:number(room.seatingCapacity),photos}];
  });
}

export function createRoomBrowser(container, signal){
  let generation=0,pending,cache;
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const load=()=>{
    if(cache)return Promise.resolve(cache);
    if(!pending)pending=(async()=>{
      const response=await fetch(ROOMS_API,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),credentials:'omit'});
      if(!response.ok)throw new Error('Room service unavailable');
      cache=normalizeRooms(await response.json());return cache;
    })().finally(()=>{pending=null;});
    return pending;
  };
  function card(room){
    const article=el('article','room-card');article.dataset.roomId=room.id;
    const gallery=createPhotoGallery(room);
    const info=el('div','room-info');info.append(el('h3',null,room.name));
    const facts=el('dl','room-facts');
    for(const [label,value] of [['Floor area',room.area===null?'Not listed':room.area.toLocaleString('en-IN')+' m²'],['Capacity',room.capacity===null?'Not listed':room.capacity.toLocaleString('en-IN')+' people']]){
      const pair=el('div');pair.append(el('dt',null,label),el('dd',null,value));facts.append(pair);
    }
    info.append(facts);article.append(gallery,info);return article;
  }
  async function show(level,onLevel){
    const ticket=++generation;container.replaceChildren();
    const tabs=el('div','room-level-tabs');tabs.setAttribute('aria-label','Convention Centre levels');
    for(let n=1;n<=3;n++){const b=el('button',n===level?'active':'','Level '+n);b.setAttribute('aria-pressed',String(n===level));b.onclick=()=>onLevel(n);tabs.append(b);}
    const status=el('p','room-list-status','Loading rooms…');status.setAttribute('role','status');
    container.append(tabs,status);container.setAttribute('aria-busy','true');
    try{
      const all=await load();if(ticket!==generation)return;
      const rooms=all.filter(room=>room.level===level);
      status.textContent=rooms.length?rooms.length+' spaces · photos & details':'No rooms listed for this level.';
      const list=el('div','room-list');rooms.forEach(room=>list.append(card(room)));container.append(list);
      const source=el('p','room-source','Room information and photos · ITPO');container.append(source);
    }catch{
      if(ticket!==generation)return;
      status.textContent='Room details could not be loaded. Please try again.';
      const retry=el('button','room-retry','Retry');retry.onclick=()=>show(level,onLevel);container.append(retry);
    }finally{if(ticket===generation)container.setAttribute('aria-busy','false');}
  }
  return {show,preload:load,cancel(){generation++;container.setAttribute('aria-busy','false');}};
}
