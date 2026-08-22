(()=>{
  const $=id=>document.getElementById(id),section=$('netResultSection'),out=$('netResult');
  const show=d=>{section.style.display='block';out.textContent=JSON.stringify(d,null,2);section.scrollIntoView({behavior:'smooth',block:'start'});};
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-net]');if(!b)return;const a=b.dataset.net;b.disabled=true;const old=b.textContent;b.textContent='Loading…';try{let d;
    if(a==='dns') d=await api('/api/util/dns?host='+encodeURIComponent($('dnsHost').value.trim()));
    else if(a==='http') d=await api('/api/util/http-check',{method:'POST',body:{url:$('httpUrl').value.trim()}});
    else if(a==='tcp') d=await api('/api/util/tcp-check',{method:'POST',body:{host:$('tcpHost').value.trim(),port:Number($('tcpPort').value)}});
    else if(a==='tls') d=await api('/api/util/tls?host='+encodeURIComponent($('tlsHost').value.trim())+'&port='+encodeURIComponent($('tlsPort').value));
    else {const u=new URL($('parseUrl').value.trim());d={ok:true,protocol:u.protocol,username:u.username||null,hostname:u.hostname,port:u.port||null,pathname:u.pathname,search:u.search,query:Object.fromEntries(u.searchParams.entries()),hash:u.hash};}
    show(d);if(!d.ok)toast(d.error||'Checker gagal','bad');else toast('Selesai');
  }catch(err){show({ok:false,error:err.message});toast(err.message||'Error','bad');}finally{b.disabled=false;b.textContent=old;}});
  $('netClear').addEventListener('click',()=>{section.style.display='none';out.textContent='';});
})();
