(()=>{
  const $=id=>document.getElementById(id),out=(id,v)=>{$(id).textContent=typeof v==='string'?v:JSON.stringify(v,null,2)};
  const utf8ToB64=s=>btoa(unescape(encodeURIComponent(s))),b64ToUtf8=s=>decodeURIComponent(escape(atob(s.replace(/\s+/g,''))));
  const randomBytes=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return a};
  const uuid=()=>{if(crypto.randomUUID)return crypto.randomUUID();const a=randomBytes(16);a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=[...a].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;try{
    if(a==='jsonPretty'){out('jsonOut',JSON.stringify(JSON.parse($('jsonInput').value),null,2));}
    else if(a==='jsonMin'){out('jsonOut',JSON.stringify(JSON.parse($('jsonInput').value)));}
    else if(a==='b64Encode'){out('b64Out',utf8ToB64($('b64Input').value));}
    else if(a==='b64Decode'){out('b64Out',b64ToUtf8($('b64Input').value));}
    else if(a==='urlEncode'){out('urlOut',encodeURIComponent($('urlInput').value));}
    else if(a==='urlDecode'){out('urlOut',decodeURIComponent($('urlInput').value));}
    else if(a==='hash'){b.disabled=true;const d=await api('/api/util/hash',{method:'POST',body:{text:$('hashInput').value,algorithm:$('hashAlg').value}});b.disabled=false;if(!d.ok)throw new Error(d.error);out('hashOut',d.hash);}
    else if(a==='uuid'){const n=Math.max(1,Math.min(50,Number($('uuidCount').value)||1));out('uuidOut',Array.from({length:n},uuid).join('\n'));}
    else if(a==='password'){const n=Math.max(8,Math.min(128,Number($('passLen').value)||24)),chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'+($('passSymbols').checked?'!@#$%^&*_-+=?':'');const bytes=randomBytes(n);out('passOut',[...bytes].map(x=>chars[x%chars.length]).join(''));}
    else if(a==='timeNow'){const now=new Date();out('timeOut',`Unix seconds: ${Math.floor(now.getTime()/1000)}\nUnix ms: ${now.getTime()}\nISO: ${now.toISOString()}\nLocal: ${now.toLocaleString('id-ID')}`);}
    else if(a==='timeParse'){const v=$('timeInput').value.trim();let d;if(/^\d+$/.test(v)){let n=Number(v);if(v.length<=10)n*=1000;d=new Date(n);}else d=new Date(v);if(Number.isNaN(d.getTime()))throw new Error('Format waktu tidak valid');out('timeOut',`Unix seconds: ${Math.floor(d.getTime()/1000)}\nUnix ms: ${d.getTime()}\nISO: ${d.toISOString()}\nLocal: ${d.toLocaleString('id-ID')}`);}
    else if(a==='jwt'){const parts=$('jwtInput').value.trim().split('.');if(parts.length<2)throw new Error('JWT tidak valid');const dec=p=>JSON.parse(b64ToUtf8(p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=')));out('jwtOut',{header:dec(parts[0]),payload:dec(parts[1]),note:'Signature tidak diverifikasi'});}
    else if(a==='qr'){b.disabled=true;const d=await api('/api/util/qr',{method:'POST',body:{text:$('qrInput').value}});b.disabled=false;if(!d.ok)throw new Error(d.error);$('qrOut').innerHTML=`<img src="${d.dataUrl}" alt="QR" style="max-width:240px;width:100%;margin-top:12px;border:3px solid #111;border-radius:10px;background:#fff">`;}
    else if(a==='dns'){b.disabled=true;const d=await api('/api/util/dns?host='+encodeURIComponent($('dnsInput').value.trim()));b.disabled=false;if(!d.ok)throw new Error(d.error);out('dnsOut',d);}
    else if(a==='http'){b.disabled=true;const d=await api('/api/util/http-check',{method:'POST',body:{url:$('httpInput').value.trim()}});b.disabled=false;if(!d.ok)throw new Error(d.error);out('httpOut',d);}
  }catch(err){b.disabled=false;toast(err.message||'Error','bad');}
  });
})();
