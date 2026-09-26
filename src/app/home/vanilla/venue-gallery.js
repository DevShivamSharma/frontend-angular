const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};

// Callers supply a display name and an array of validated photo URLs.
export function createPhotoGallery({name,photos}){
  const gallery=el('div','room-gallery');gallery.setAttribute('role','region');gallery.setAttribute('aria-label',name+' photos');
  const placeholder=el('span','room-photo-placeholder',photos.length?'Loading photo…':'Photos not available');gallery.append(placeholder);
  if(photos.length){
    const img=el('img');img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
    let index=0,start;
    const counter=el('span','room-photo-count');counter.setAttribute('aria-live','polite');
    function update(delta=0){index=(index+delta+photos.length)%photos.length;img.hidden=false;placeholder.hidden=false;placeholder.textContent='Loading photo…';img.alt=name+' · photo '+(index+1)+' of '+photos.length;img.src=photos[index];counter.textContent=(index+1)+' / '+photos.length;}
    img.onload=()=>{placeholder.hidden=true;};img.onerror=()=>{img.hidden=true;placeholder.hidden=false;placeholder.textContent='Photo unavailable';};
    gallery.append(img);
    if(photos.length>1){
      for(const [delta,label,symbol] of [[-1,'Previous','‹'],[1,'Next','›']]){
        const button=el('button','room-photo-arrow '+(delta<0?'previous':'next'),symbol);button.type='button';button.setAttribute('aria-label',label+' photo of '+name);button.onclick=()=>update(delta);gallery.append(button);
      }
      gallery.append(counter);gallery.tabIndex=0;
      gallery.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();update(e.key==='ArrowRight'?1:-1);}};
      gallery.addEventListener('pointerdown',e=>{start=[e.clientX,e.clientY];});
      gallery.addEventListener('pointerup',e=>{if(start){const dx=e.clientX-start[0],dy=e.clientY-start[1];if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))update(dx<0?1:-1);}start=null;});
      gallery.addEventListener('pointercancel',()=>{start=null;});
    }
    update();
  }
  return gallery;
}
