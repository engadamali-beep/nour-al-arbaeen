/* تطبيق نور الأربعين النووية - يعمل Offline بالكامل */
(function(){
  const list = document.getElementById('list');
  const q = document.getElementById('q');
  const bar = document.getElementById('bar');
  const countDone = document.getElementById('countDone');
  const pct = document.getElementById('pct');
  const viewer = document.getElementById('viewer');
  const vNum = document.getElementById('vNum');
  const vTitle = document.getElementById('vTitle');
  const vRawi = document.getElementById('vRawi');
  const vMatn = document.getElementById('vMatn');
  const vTakhrij = document.getElementById('vTakhrij');
  const paneSharh = document.getElementById('pane-sharh');
  const vWords = document.getElementById('vWords');
  const vFawaid = document.getElementById('vFawaid');
  let done = new Set(JSON.parse(localStorage.getItem('nour40_done')||'[]'));
  let showDoneOnly = false;
  let fontSize = parseFloat(localStorage.getItem('nour40_font')||'1.18');
  let current = null;
  let deferredPrompt = null;

  const H = window.HADITHS || [];
  document.getElementById('countAll').textContent = H.length;

  function save(){ localStorage.setItem('nour40_done', JSON.stringify([...done])); }
  function updateStats(){
    countDone.textContent = done.size;
    const p = H.length ? Math.round(done.size/H.length*100) : 0;
    pct.textContent = p+'%'; bar.style.width = p+'%';
  }
  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

  function render(filter=''){
    list.innerHTML='';
    const f = filter.trim();
    H.forEach(h=>{
      if(showDoneOnly && !done.has(h.id)) return;
      if(f && !(h.title.includes(f)||h.matn.includes(f)||(h.rawi||'').includes(f))) return;
      const d = document.createElement('article');
      d.className='card'+(done.has(h.id)?' done':'');
      d.innerHTML = `<div class="num"><div class="badge">${h.id}</div><h3>${esc(h.title)}</h3></div>
        <div class="meta">🎙 ${esc(h.rawi)}</div>
        <div class="matn-preview">${esc(h.matn.slice(0,120))}…</div>
        <div class="row">
          <button class="btn small primary" data-open="${h.id}">📖 اقرأ والشرح</button>
          <button class="btn small" data-done="${h.id}">${done.has(h.id)?'✅ تم':'⬜ إتمام'}</button>
        </div>`;
      list.appendChild(d);
    });
    if(!list.children.length) list.innerHTML='<p class="meta">لا نتائج — جرّب كلمة أخرى.</p>';
    updateStats();
  }

  list.addEventListener('click',e=>{
    const o = e.target.closest('[data-open]');
    const dn = e.target.closest('[data-done]');
    if(o) openH(+o.dataset.open);
    if(dn){ const id=+dn.dataset.done; done.has(id)?done.delete(id):done.add(id); save(); render(q.value); }
  });

  function openH(id){
    current = H.find(x=>x.id===id); if(!current) return;
    vNum.textContent = current.id;
    vTitle.textContent = current.id+'. '+current.title;
    vRawi.textContent = 'راوي الحديث: '+current.rawi;
    vMatn.textContent = 'قال رسول الله ﷺ: «'+current.matn+'»';
    vMatn.style.fontSize = fontSize+'rem';
    vTakhrij.textContent = 'التخريج: '+current.takhrij;
    paneSharh.innerHTML = '<p>'+esc(current.sharh).replace(/\. /g,'.</p><p>')+'</p>';
    vWords.innerHTML = (current.words||[]).map(w=>'<li>'+esc(w)+'</li>').join('');
    vFawaid.innerHTML = (current.fawaid||[]).map(w=>'<li>'+esc(w)+'</li>').join('');
    document.getElementById('vDone').textContent = done.has(id)?'✅ تم — إلغاء الإتمام':'✅ أتممت حفظه/قراءته';
    setTab('matn');
    if(typeof viewer.showModal==='function') viewer.showModal(); else viewer.setAttribute('open','');
  }
  function setTab(t){
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.t===t));
    document.getElementById('pane-matn').hidden = t!=='matn';
    paneSharh.hidden = t!=='sharh';
    document.getElementById('pane-fawaid').hidden = t!=='fawaid';
  }
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.t));
  document.getElementById('vClose').onclick=()=>viewer.close();
  document.getElementById('vDone').onclick=()=>{
    if(!current) return;
    done.has(current.id)?done.delete(current.id):done.add(current.id);
    save(); render(q.value);
    document.getElementById('vDone').textContent = done.has(current.id)?'✅ تم — إلغاء الإتمام':'✅ أتممت حفظه/قراءته';
    updateStats();
  };
  document.getElementById('vCopy').onclick=async()=>{
    if(!current) return;
    const t = `الحديث ${current.id}: ${current.title}\nقال رسول الله ﷺ: «${current.matn}»\nالراوي: ${current.rawi} | ${current.takhrij}\n— من تطبيق نور الأربعين النووية`;
    try{ await navigator.clipboard.writeText(t); alert('تم النسخ ✅'); }catch{ alert(t); }
  };
  document.getElementById('vShare').onclick=async()=>{
    if(!current) return;
    const t = `الحديث ${current.id}: ${current.title} — ${current.matn}`;
    if(navigator.share){ try{ await navigator.share({title:current.title,text:t}); }catch{} }
    else{ try{ await navigator.clipboard.writeText(t); alert('تم النسخ للمشاركة ✅'); }catch{ alert(t); } }
  };
  document.getElementById('vSpeak').onclick=()=>{
    if(!current) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(current.matn);
    u.lang='ar-SA'; u.rate=0.9; speechSynthesis.speak(u);
  };

  q.addEventListener('input',()=>render(q.value));
  document.getElementById('filterDone').onclick=(e)=>{
    showDoneOnly=!showDoneOnly;
    e.currentTarget.textContent = showDoneOnly?'📚 كل الأحاديث':'✅ المنجزة فقط';
    render(q.value);
  };
  document.getElementById('themeBtn').onclick=()=>{
    const r=document.documentElement;
    const dark = r.getAttribute('data-theme')==='dark';
    if(dark){ r.removeAttribute('data-theme'); localStorage.setItem('nour40_theme','light'); }
    else{ r.setAttribute('data-theme','dark'); localStorage.setItem('nour40_theme','dark'); }
  };
  if(localStorage.getItem('nour40_theme')==='dark') document.documentElement.setAttribute('data-theme','dark');
  document.getElementById('aPlus').onclick=()=>{ fontSize=Math.min(1.8,fontSize+0.1); localStorage.setItem('nour40_font',fontSize); if(current) vMatn.style.fontSize=fontSize+'rem'; };
  document.getElementById('aMinus').onclick=()=>{ fontSize=Math.max(0.9,fontSize-0.1); localStorage.setItem('nour40_font',fontSize); if(current) vMatn.style.fontSize=fontSize+'rem'; };
  document.getElementById('resetBtn').onclick=()=>{ if(confirm('تصفير كل التقدم؟')){ done.clear(); save(); render(q.value); } };
  document.getElementById('exportBtn').onclick=()=>{
    const blob = new Blob([JSON.stringify(H,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ahadith-nawawiya-42.json'; a.click();
  };

  // PWA install
  window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); deferredPrompt=e; document.getElementById('installBar').style.display='flex'; });
  async function doInstall(){
    if(deferredPrompt){ deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; document.getElementById('installBar').style.display='none'; }
    else alert('للتثبيت على أندرويد: افتح الموقع في Chrome ← القائمة ⋮ ← تثبيت التطبيق / إضافة إلى الشاشة الرئيسية. وهو يعمل بعدها بدون إنترنت.');
  }
  document.getElementById('installBtn').onclick=doInstall;
  document.getElementById('installBtn2').onclick=doInstall;
  document.getElementById('installClose').onclick=()=>document.getElementById('installBar').style.display='none';

  // net status
  function net(){ const on=navigator.onLine; document.getElementById('netTxt').textContent = on?'متصل — المحتوى محفوظ offline':'وضع عدم الاتصال — يعمل offline ✅'; }
  window.addEventListener('online',net); window.addEventListener('offline',net); net();

  render();
})();
