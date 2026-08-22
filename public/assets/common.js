(() => {
  const page = document.body.dataset.page || 'home';
  const nav = [
    ['home','/','⌂','Home'],
    ['ssh','/ssh','>_','SSH'],
    ['files','/files','▤','Files'],
    ['downloaders','/downloaders','⇩','Download'],
    ['network','/network','⌁','Network'],
    ['utilities','/utilities','✦','Utilities'],
    ['settings','/settings','⚙','Settings']
  ];

  const top = document.createElement('header');
  top.className = 'topbar';
  top.innerHTML = `<div class="topbar-inner">
    <a class="brand" href="/"><div class="brandmark"><span>F</span></div><span>FXHL WEBTOOL</span></a>
    <nav class="desktop-nav">
      ${nav.map(([id,url,icon,label]) => `<a class="nav-link ${page===id?'active':''}" href="${url}">${icon} ${label}</a>`).join('')}
      <button id="disconnectSshBtn" class="btn small ghost" type="button">Disconnect SSH</button>
    </nav>
  </div>`;
  document.body.prepend(top);

  const mobile = document.createElement('nav');
  mobile.className = 'mobile-nav';
  const mobileItems = nav.slice(0,5);
  mobile.innerHTML = mobileItems.map(([id,url,icon,label]) => `<a class="${page===id?'active':''}" href="${url}"><b>${icon}</b>${label}</a>`).join('');
  document.body.append(mobile);

  const toastWrap = document.createElement('div');
  toastWrap.className = 'toast-wrap';
  document.body.append(toastWrap);

  window.toast = (message, type='ok', timeout=3500) => {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastWrap.append(el);
    setTimeout(() => el.remove(), timeout);
  };

  window.api = async (url, options={}) => {
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    else data = { ok: res.ok, raw: await res.text() };
    if (!res.ok && !data.error) data.error = `HTTP ${res.status}`;
    return data;
  };

  window.formatBytes = (n=0) => {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    const units = ['KB','MB','GB','TB','PB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
  };

  window.escapeHtml = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  window.collectUrls = function collectUrls(value, path='result', out=[]) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) out.push({path,url:value});
    else if (Array.isArray(value)) value.forEach((v,i) => collectUrls(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => collectUrls(v, `${path}.${k}`, out));
    return out;
  };

  window.renderApiResult = (container, data, filter='all') => {
    if (!container) return;
    const pre = container.querySelector('.result') || container;
    pre.textContent = JSON.stringify(data, null, 2);
    let links = container.querySelector('.result-links');
    if (!links && container !== pre) {
      links = document.createElement('div'); links.className = 'result-links'; container.append(links);
    }
    if (!links) return;
    const urls = collectUrls(data).filter(x => {
      if (filter === 'audio') return /mp3|m4a|audio|music/i.test(x.path + x.url);
      if (filter === 'video') return /mp4|video|play|download/i.test(x.path + x.url);
      return true;
    }).slice(0, 20);
    links.innerHTML = urls.map((x,i) => `<a class="media-link" href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer"><b>${i+1}.</b><span>${escapeHtml(x.path)}</span> ↗</a>`).join('');
  };

  async function refreshGlobalStatus() {
    const el = document.querySelector('[data-global-status]');
    if (!el) return;
    try {
      const s = await api('/api/status');
      el.innerHTML = `<span class="status-dot ${s.sshConnected?'on':'off'}"></span>${s.sshConnected ? `${escapeHtml(s.sshUser)}@${escapeHtml(s.sshHost)}` : 'SSH offline'}`;
    } catch {}
  }
  refreshGlobalStatus();
  window.refreshGlobalStatus = refreshGlobalStatus;

  document.getElementById('disconnectSshBtn')?.addEventListener('click', async () => {
    const r = await api('/api/session/disconnect', { method: 'POST' });
    if (r.ok) { toast('SSH session diputus.', 'ok'); refreshGlobalStatus(); }
    else toast(r.error || 'Gagal memutus SSH.', 'error');
  });
})();
