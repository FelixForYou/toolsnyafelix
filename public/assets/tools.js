(async()=>{
  const grid=document.getElementById('toolGrid'),resultSection=document.getElementById('resultSection'),resultTitle=document.getElementById('resultTitle'),apiResult=document.getElementById('apiResult');
  const cfg={
    tiktok:{icon:'♪',desc:'Ambil video TikTok tanpa watermark.',placeholder:'https://www.tiktok.com/@user/video/...',kind:'tiktok',mode:'video'},
    tiktokaudio:{icon:'♫',desc:'Ambil audio/music dari video TikTok.',placeholder:'https://vt.tiktok.com/...',kind:'tiktok',mode:'audio'},
    tiktokcover:{icon:'▧',desc:'Ambil cover/thumbnail TikTok.',placeholder:'https://www.tiktok.com/@user/video/...',kind:'tiktok',mode:'cover'},
    gdrive:{icon:'△',desc:'Ubah link share Google Drive menjadi direct download link.',placeholder:'https://drive.google.com/file/d/.../view',kind:'convert'},
    githubzip:{icon:'GH',desc:'Buat link ZIP untuk repository/branch GitHub.',placeholder:'https://github.com/owner/repo',kind:'convert'},
    githubraw:{icon:'<>',desc:'Ubah link file GitHub /blob/ menjadi raw URL.',placeholder:'https://github.com/owner/repo/blob/main/file.js',kind:'convert'},
    directcheck:{icon:'↗',desc:'Cek apakah URL publik merespons dan lihat content-type/status.',placeholder:'https://example.com/file.mp4',kind:'check'}
  };
  const catalog=await api('/api/media/catalog');
  const tools=(catalog.tools||[]).filter(t=>cfg[t.id]);
  grid.innerHTML=tools.map(t=>{const c=cfg[t.id];return `<article class="tool-card"><div class="icon-box">${c.icon}</div><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(c.desc)}</p><div class="field" style="margin:0"><label>URL</label><input class="input" data-input="${t.id}" placeholder="${escapeHtml(c.placeholder)}"></div><button class="btn primary" data-run="${t.id}">Proses →</button></article>`}).join('');
  grid.addEventListener('click',async e=>{const b=e.target.closest('[data-run]');if(!b)return;const id=b.dataset.run,c=cfg[id],input=grid.querySelector(`[data-input="${id}"]`);if(!input.value.trim())return toast('URL masih kosong','warn');b.disabled=true;b.textContent='Loading…';let d;try{
    if(c.kind==='tiktok') d=await api('/api/media/tiktok',{method:'POST',body:{url:input.value.trim(),mode:c.mode}});
    else if(c.kind==='convert') d=await api('/api/media/convert',{method:'POST',body:{url:input.value.trim(),type:id}});
    else d=await api('/api/util/http-check',{method:'POST',body:{url:input.value.trim()}});
  }catch(err){d={ok:false,error:err.message||'Request gagal'}}
  b.disabled=false;b.textContent='Proses →';resultSection.style.display='block';resultTitle.textContent=(tools.find(x=>x.id===id)?.name||id)+' Result';renderApiResult(apiResult,d,c.mode==='audio'?'audio':c.mode==='video'?'video':'all');resultSection.scrollIntoView({behavior:'smooth',block:'start'});if(!d.ok)toast(d.error||'Gagal memproses','bad');else toast('Result diterima');});
  document.getElementById('clearResult').addEventListener('click',()=>{resultSection.style.display='none';apiResult.querySelector('.result').textContent='';apiResult.querySelector('.result-links').innerHTML='';});
})();
