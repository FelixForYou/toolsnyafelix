(async()=>{
  const $=id=>document.getElementById(id);
  const authType=$('authType'),passwordWrap=$('passwordWrap'),keyWrap=$('keyWrap');
  authType.addEventListener('change',()=>{const key=authType.value==='privateKey';passwordWrap.style.display=key?'none':'flex';keyWrap.style.display=key?'block':'none';});
  try{const saved=JSON.parse(localStorage.getItem('fxhl:ssh-host')||'null');if(saved){$('host').value=saved.host||'';$('port').value=saved.port||22;$('username').value=saved.username||'root';$('rememberHost').checked=true;}}catch{}

  const term=new Terminal({cursorBlink:true,fontSize:13,fontFamily:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',theme:{background:'#0d0d0d',foreground:'#f4f2eb',cursor:'#ffd342',selectionBackground:'#555'}});
  const fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open($('terminal'));fit.fit();window.addEventListener('resize',()=>{fit.fit();socket.emit('terminal:resize',{cols:term.cols,rows:term.rows});});
  const socket=io();
  socket.on('connect',()=>socket.emit('terminal:open'));
  socket.on('terminal:ready',d=>{$('termLabel').textContent=`${d.username}@${d.host}`;$('sshHeroStatus').textContent='ONLINE';term.focus();refreshStats();refreshGlobalStatus();});
  socket.on('terminal:data',d=>term.write(d));
  socket.on('terminal:error',e=>{term.writeln(`\r\n\x1b[31m${e}\x1b[0m`);});
  socket.on('terminal:closed',()=>{$('termLabel').textContent='closed';});
  term.onData(d=>socket.emit('terminal:input',d));

  $('connectBtn').addEventListener('click',async()=>{
    const btn=$('connectBtn');btn.disabled=true;btn.textContent='Connecting…';
    const body={host:$('host').value.trim(),port:Number($('port').value||22),username:$('username').value.trim(),authType:authType.value,password:$('password').value,privateKey:$('privateKey').value,passphrase:$('passphrase').value};
    const d=await api('/api/ssh/connect',{method:'POST',body});
    btn.disabled=false;btn.textContent='Connect';
    if(!d.ok){$('connectMsg').className='alert bad';$('connectMsg').textContent=d.error||'Gagal connect';return toast(d.error||'Gagal connect','bad');}
    if($('rememberHost').checked)localStorage.setItem('fxhl:ssh-host',JSON.stringify({host:body.host,port:body.port,username:body.username}));else localStorage.removeItem('fxhl:ssh-host');
    $('password').value='';$('privateKey').value='';$('passphrase').value='';$('connectMsg').className='alert ok';$('connectMsg').textContent=`Terhubung ke ${d.username}@${d.host}:${d.port}`;toast('SSH tersambung');
    $('sshHeroStatus').textContent='ONLINE';socket.disconnect();socket.connect();refreshGlobalStatus();
  });
  $('disconnectBtn').addEventListener('click',async()=>{await api('/api/ssh/disconnect',{method:'POST'});$('sshHeroStatus').textContent='OFFLINE';$('connectMsg').className='alert';$('connectMsg').textContent='Koneksi diputus.';socket.disconnect();term.writeln('\r\n[Disconnected]');refreshGlobalStatus();});

  async function refreshStats(){
    const d=await api('/api/ssh/stats');if(!d.ok)return;
    const x=d.data;$('mHost').textContent=x.hostname||'—';$('mUptime').textContent=x.uptime||'—';
    const memPct=x.memory.total?Math.round(x.memory.used/x.memory.total*100):0;$('mMemory').textContent=`${formatBytes(x.memory.used)} / ${formatBytes(x.memory.total)}`;$('memBar').style.width=`${Math.min(100,memPct)}%`;
    $('mDisk').textContent=`${formatBytes(x.disk.used)} / ${formatBytes(x.disk.total)}`;$('diskBar').style.width=x.disk.percent||'0%';
  }
  $('refreshStats').addEventListener('click',refreshStats);
  const names=[['system','System'],['disk','Disk'],['memory','Memory'],['processes','Top RAM'],['network','Ports'],['docker','Docker'],['pterodactyl','Wings']];
  $('shortcuts').innerHTML=names.map(([id,label])=>`<button class="btn small" data-shortcut="${id}">${label}</button>`).join('');
  $('shortcuts').addEventListener('click',async e=>{const b=e.target.closest('[data-shortcut]');if(!b)return;b.disabled=true;const d=await api('/api/ssh/shortcut',{method:'POST',body:{name:b.dataset.shortcut}});b.disabled=false;$('shortcutOutput').textContent=d.ok?(d.stdout+(d.stderr?'\n\nSTDERR:\n'+d.stderr:'')):(d.error||'Error');});
  try{const s=await api('/api/status');if(s.sshConnected){$('sshHeroStatus').textContent='ONLINE';$('connectMsg').className='alert ok';$('connectMsg').textContent=`Session aktif: ${s.sshUser}@${s.sshHost}`;refreshStats();}else $('sshHeroStatus').textContent='OFFLINE';}catch{}
})();
