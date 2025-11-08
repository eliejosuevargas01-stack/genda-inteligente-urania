// despesas.js — Integração com a agenda (sem fetch de despesas)
// - Lê dados de window.eventosEnriquecidos (app.js)
// - Filtra por período (dia/semana/faturamento)
// - Calcula totais estimados e reais; exibe faturamento base (26%) e lucro líquido
// - Lança despesas reais via webhook n8n (único fetch externo)

(function(){
  'use strict';

  // Endpoint de lançamento (único fetch externo)
  const N8N_LANCAR_DESPESAS_URL = 'https://n8n.uraniaclass.com.br/webhook/lançar-despesas';

  // Storage keys
  const LS_KEY_CACHE = 'despesas_cache_v1';
  const LS_KEY_REAIS = 'despesas_reais_v1';
  const LS_KEY_MEDIAS = 'despesas_medias_v1';
  const CACHE_TTL_MS = 48 * 60 * 60 * 1000;

  // Helpers
  const byId = (id) => document.getElementById(id);
  const setText = (id, val) => { const el = byId(id); if (el) el.textContent = val; };
  const BRL = (n) => { const v = Number(n) || 0; try{ return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}catch(_){ return `R$ ${v.toFixed(2)}`; } };
  function addDays(date, d){ const x=new Date(date); x.setHours(0,0,0,0); x.setDate(x.getDate()+d); return x; }
  const parseNum = (v) => {
    if (v == null) return 0;
    if (typeof v === 'number' && isFinite(v)) return v;
    const s = String(v);
    const m = s.match(/-?\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d+)?|-?\d+(?:[\.,]\d+)?/);
    if (!m) return 0;
    let num = m[0].trim();
    if (num.includes('.') && num.includes(',')) num = num.replace(/\./g,'').replace(',', '.');
    else if (num.includes(',')) num = num.replace(',', '.');
    else num = num.replace(/\s+/g,'');
    const n = Number(num); return isFinite(n)? n:0;
  };

  function getUserSession(){
    try{ const raw=localStorage.getItem('astronomo_session'); if(!raw) return null; const s=JSON.parse(raw)||{}; return {
      username: (s.username || s.USERNAME || '-'),
      assistantId: (s.assistant_id || s.ASSISTANT_ID || '-'),
      astronomoId: (s.id_astronomo || s.ID_ASTRONOMO || '-')
    }; } catch(_){ return null; }
  }
  function withUserQuery(baseUrl, user){
    try{ const u=new URL(baseUrl); const ctx=user||getUserContext()||{}; if(ctx.usuario)u.searchParams.set('usuario',String(ctx.usuario)); if(ctx.id_astronomo!=null&&!Number.isNaN(Number(ctx.id_astronomo)))u.searchParams.set('id_astronomo',String(ctx.id_astronomo)); if(ctx.assistant_id)u.searchParams.set('assistant_id',String(ctx.assistant_id)); if(ctx.session_id)u.searchParams.set('session_id',String(ctx.session_id)); return u.toString(); }catch(_){ return baseUrl; }
  }

  // Cache helpers
  function loadLocalCache(){ try{ const raw=localStorage.getItem(LS_KEY_CACHE); if(!raw) return null; const o=JSON.parse(raw); if(!o||!o.ts||!Array.isArray(o.data)) return null; if(Date.now()-Number(o.ts)>CACHE_TTL_MS) return null; return o; }catch(_){ return null; } }
  function saveLocalCache(data){ try{ localStorage.setItem(LS_KEY_CACHE, JSON.stringify({ts:Date.now(), data:Array.isArray(data)?data:[]})); }catch(_){ } }
  function loadDespesasReais(){ try{ return JSON.parse(localStorage.getItem(LS_KEY_REAIS)||'{}')||{}; }catch(_){ return {}; } }
  function saveDespesasReais(map){ try{ localStorage.setItem(LS_KEY_REAIS, JSON.stringify(map||{})); }catch(_){ } }
  function loadMedias(){ try{ const def={combustivel:0,hospedagem:0,alimentacao:0,monitor:0,pedagios:0}; const m=JSON.parse(localStorage.getItem(LS_KEY_MEDIAS)||'null'); return m&&typeof m==='object'? Object.assign(def,m): def; }catch(_){ return {combustivel:0,hospedagem:0,alimentacao:0,monitor:0,pedagios:0}; } }
  function saveMedias(m){ try{ localStorage.setItem(LS_KEY_MEDIAS, JSON.stringify(m||{})); }catch(_){ } }

  function getAgendaEventosArray(){ return Array.isArray(window.eventosEnriquecidos)? window.eventosEnriquecidos: []; }
  function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function fetchDespesas(){
    let eventos = getAgendaEventosArray();
    if (eventos.length){ saveLocalCache(eventos); return eventos; }
    const cached = loadLocalCache(); if (cached && Array.isArray(cached.data) && cached.data.length) return cached.data;
    const start=Date.now(); while(Date.now()-start<10000){ await wait(400); eventos=getAgendaEventosArray(); if(eventos.length){ saveLocalCache(eventos); return eventos; } }
    return [];
  }

  function isWithinPeriod(dateStr, period){
    try{ const now=new Date(); const d=new Date(dateStr); if(isNaN(d)) return false; const start=new Date(now); start.setHours(0,0,0,0); const endDay=addDays(start,1), endWeek=addDays(start,7); if(period==='day') return d>=start&&d<endDay; if(period==='week') return d>=start&&d<endWeek; if(period==='faturamento') return true; return true; }catch(_){ return false; }
  }
  function filterDespesas(period, lista){ return (lista||[]).filter(ev=> isWithinPeriod(ev&&ev.data_agendamento, period)); }

  function calculateTotals(events){
    const medias = loadMedias(); let combustivel=0,hospedagem=0,alimentacao=0,monitor=0,pedagios=0,total=0;
    const fromWebhookOr = (raw, fallback) => {
      const hasValue = raw != null && !(typeof raw === 'string' && raw.trim() === '');
      const n = parseNum(raw);
      return hasValue ? n : fallback;
    };
    for (const ev of (events||[])){
      const vComb = fromWebhookOr(ev.gasto_combustivel, medias.combustivel);
      const vHosp = fromWebhookOr(ev.diaria_hospedagem, medias.hospedagem);
      const vAli  = fromWebhookOr(ev.alimentacao_diaria, medias.alimentacao);
      const vMon  = fromWebhookOr(ev.monitor, medias.monitor);
      const vPed  = fromWebhookOr(ev.pedagios, medias.pedagios);
      combustivel+=vComb; hospedagem+=vHosp; alimentacao+=vAli; monitor+=vMon; pedagios+=vPed;
      const vTotal = fromWebhookOr(ev.custo_total_evento, (vComb+vHosp+vAli+vMon+vPed));
      total += vTotal;
    }
    return { combustivel, hospedagem, alimentacao, monitor, pedagios, total };
  }

  function calculateReaisTotals(period){
    const reaisMap=loadDespesasReais(); const base=(loadLocalCache()||{}).data||[]; const eventos=filterDespesas(period, base); const ids=new Set(eventos.map(e=>String(e.id_evento)));
    let combustivel=0,hospedagem=0,alimentacao=0,monitor=0,pedagios=0,total=0;
    for (const [id,r] of Object.entries(reaisMap)){
      if(!ids.has(String(id))) continue;
      const c=parseNum(r.combustivel_real), h=parseNum(r.hospedagem_real), a=parseNum(r.alimentacao_real), m=parseNum(r.monitor_real), p=parseNum(r.pedagios_real||0)+parseNum(r.outros||0);
      combustivel+=c; hospedagem+=h; alimentacao+=a; monitor+=m; pedagios+=p; total+=c+h+a+m+p;
    }
    return { combustivel, hospedagem, alimentacao, monitor, pedagios, total };
  }

  function sumFaturamentoPorEventos(ids){ try{ const all=getAgendaEventosArray(); const set=new Set((ids||[]).map(String)); return all.reduce((acc,ev)=> acc + (set.has(String(ev.id_evento||ev.id))? (parseNum(ev.valor_total)||0):0), 0); }catch(_){ return 0; } }
  function getFaturamentoTopo(){ try{ const el=byId('faturamentoTotal'); if(!el) return 0; const t=String(el.textContent||'').replace(/[^0-9,.-]/g,'').replace('.', '').replace(',', '.'); const n=Number(t); return isFinite(n)? n:0; }catch(_){ return 0; } }

  function atualizarResumoFaturamento(period, eventos){
    let faturamentoTotal = (eventos||[]).reduce((acc,ev)=> acc+parseNum(ev&&ev.valor_total), 0);
    if (!faturamentoTotal){ const ids=(eventos||[]).map(e=>e.id_evento); faturamentoTotal = sumFaturamentoPorEventos(ids); }
    if (!faturamentoTotal){ faturamentoTotal = getFaturamentoTopo(); }
    const totEst = calculateTotals(eventos||[]);
    const lucroBase = faturamentoTotal * 0.26;
    const lucroLiquido = lucroBase - (totEst.total||0);
    setText('faturamentoBase', BRL(lucroBase));
    setText('lucroLiquido', BRL(lucroLiquido));
    // Atualiza também os campos da seção "Despesas Reais"
    setText('real-faturamento-total', BRL(faturamentoTotal));
    setText('real-faturamento-base', BRL(lucroBase));
    setText('real-lucro-liquido', BRL(lucroLiquido));
    const msg = byId('motivation-message'); if (msg){ if (lucroLiquido>=0){ msg.textContent='Missão rentável 🚀'; msg.classList.add('positive'); msg.classList.remove('negative'); } else { msg.textContent='Despesas acima do lucro previsto ⚠️'; msg.classList.add('negative'); msg.classList.remove('positive'); } }
    const topo = byId('faturamentoTotal'); if (topo) topo.textContent = BRL(faturamentoTotal);
  }

  function renderDespesas(totEst, totReal, period, eventosFiltrados){
    setText('est-cost-fuel', BRL(totEst.combustivel));
    setText('est-cost-hotel', BRL(totEst.hospedagem));
    setText('est-cost-food', BRL(totEst.alimentacao));
    setText('est-cost-monitor', BRL(totEst.monitor));
    setText('est-cost-total', BRL(totEst.total));
    // Indicadores estimados — usar a mesma fonte/estratégia dos reais
    try{
      let faturamentoTotalEst = (eventosFiltrados||[]).reduce((a,ev)=>a+parseNum(ev&&ev.valor_total),0);
      if (!faturamentoTotalEst) {
        const ids = (eventosFiltrados||[]).map(e=>e.id_evento);
        faturamentoTotalEst = sumFaturamentoPorEventos(ids);
      }
      if (!faturamentoTotalEst) faturamentoTotalEst = getFaturamentoTopo();
      const lucroBaseEst = faturamentoTotalEst * 0.26;
      const lucroLiquidoEst = lucroBaseEst - (totEst.total||0);
      setText('est-faturamento-total', BRL(faturamentoTotalEst));
      setText('est-faturamento-base', BRL(lucroBaseEst));
      setText('est-lucro-liquido', BRL(lucroLiquidoEst));
    }catch(_){ }

    setText('real-cost-fuel', BRL(totReal.combustivel));
    setText('real-cost-hotel', BRL(totReal.hospedagem));
    setText('real-cost-food', BRL(totReal.alimentacao));
    setText('real-cost-monitor', BRL(totReal.monitor));
    setText('real-cost-total', BRL(totReal.total));

    atualizarResumoFaturamento(period, eventosFiltrados||[]);
  }

  function updateMediasHistoricasFromMap(reaisMap){
    const arrC=[],arrH=[],arrA=[],arrM=[],arrP=[]; for(const r of Object.values(reaisMap||{})){ arrC.push(parseNum(r.combustivel_real)); arrH.push(parseNum(r.hospedagem_real)); arrA.push(parseNum(r.alimentacao_real)); arrM.push(parseNum(r.monitor_real)); arrP.push(parseNum(r.pedagios_real||0)+parseNum(r.outros||0)); }
    const avg=(xs)=> xs.length? xs.reduce((a,b)=>a+b,0)/xs.length:0;
    const medias={ combustivel:avg(arrC), hospedagem:avg(arrH), alimentacao:avg(arrA), monitor:avg(arrM), pedagios:avg(arrP) };
    saveMedias(medias); return medias;
  }

  function toast(msg){ try{ const el=document.createElement('div'); el.className='toast-message'; el.textContent=msg; Object.assign(el.style,{position:'fixed',bottom:'16px',right:'16px',background:'rgba(0,0,0,0.8)',color:'#fff',padding:'10px 14px',borderRadius:'8px',zIndex:9999}); document.body.appendChild(el); setTimeout(()=>{ try{ el.remove(); }catch(_){ } }, 2000); }catch(_){ } }

  async function enviarDespesaReal(eventoId, dados){
    const user=getUserContext(); const payload={ id_evento:String(eventoId), finalizado: 1, ...(dados||{}), ...(user||{}) };
    try{
      let url=withUserQuery(N8N_LANCAR_DESPESAS_URL, user);
      try{ const u=new URL(url); Object.entries(payload).forEach(([k,v])=>{ if(v==null) return; const val=(typeof v==='string'||typeof v==='number'||typeof v==='boolean')? String(v): JSON.stringify(v); u.searchParams.set(k,val); }); url=u.toString(); }catch(_){ }
      const resp1 = await fetch(url,{method:'POST', headers:{'Accept':'application/json'}, mode:'cors'});
      if (!resp1.ok) throw new Error('HTTP '+resp1.status);
      // Tenta consumir a resposta (caso o backend responda JSON/texto)
      try{ await resp1.text(); }catch(_){ }
      const reaisMap=loadDespesasReais(); reaisMap[payload.id_evento]=payload; saveDespesasReais(reaisMap);
      const medias=updateMediasHistoricasFromMap(reaisMap);
      try{
        let url2 = withUserQuery(N8N_LANCAR_DESPESAS_URL, user);
        const extra = { tipo:'medias_historicas', medias, ...(user||{}) };
        try{ const u2=new URL(url2); Object.entries(extra).forEach(([k,v])=>{ if(v==null) return; const val=(typeof v==='string'||typeof v==='number'||typeof v==='boolean')? String(v): JSON.stringify(v); u2.searchParams.set(k,val); }); url2=u2.toString(); }catch(_){ }
        const resp2 = await fetch(url2, { method:'POST', headers:{'Accept':'application/json'}, mode:'cors' });
        try{ await resp2.text(); }catch(_){ }
      }catch(_){ }
    }catch(err){ console.error('[despesas] enviarDespesaReal falhou', err); }
  }

  function renderEventosDespesas(eventos){
    const host=byId('despesas-events-list'); if(!host) return; host.innerHTML='';
    const reaisMap=loadDespesasReais(); const medias=loadMedias(); const fmtDate=(s)=>{ try{ const d=new Date(s); return d.toLocaleDateString('pt-BR'); }catch(_){ return s||'-'; } };
    const cards=(eventos||[]).map(ev=>{ const id=String(ev.id_evento); const r=reaisMap[id]||{}; const est={ combustivel:parseNum(ev.gasto_combustivel)||medias.combustivel, hospedagem:parseNum(ev.diaria_hospedagem)||medias.hospedagem, alimentacao:parseNum(ev.alimentacao_diaria)||medias.alimentacao, monitor:parseNum(ev.monitor)||medias.monitor, pedagios:parseNum(ev.pedagios)||medias.pedagios }; const estTotal=est.combustivel+est.hospedagem+est.alimentacao+est.monitor+est.pedagios; const realTotal=parseNum(r.combustivel_real)+parseNum(r.hospedagem_real)+parseNum(r.alimentacao_real)+parseNum(r.monitor_real)+parseNum(r.pedagios_real||0)+parseNum(r.outros||0); return `
      <details class="custos-card" data-event-id="${id}">
        <summary class="custos-summary">
          <div class="custos-summary-left">
            <i class="fas fa-school"></i>
            <div>
              <div class="title">${ev.nome_da_escola||'-'}</div>
              <div class="sub">${ev.cidade||'-'} • ${fmtDate(ev.data_agendamento)}</div>
            </div>
          </div>
          <div class="custos-summary-right">
            <span class="chip chip-valor"><i class="fas fa-wallet"></i> Est.: ${BRL(estTotal)}</span>
            ${ realTotal? `<span class=\"chip status-lancado\"><i class=\"fas fa-check\"></i> Real: ${BRL(realTotal)}</span>`: '' }
            <button type="button" class="btn btn-secondary toggle-event">Detalhes</button>
            <button type="button" class="btn btn-route launch-expense">Lançar Despesas</button>
            <i class="fas fa-chevron-down arrow"></i>
          </div>
        </summary>
        <div class="custos-details">
          <div class="cost-box estimated">
            <h4><i class="fas fa-sack-dollar"></i> Estimados</h4>
            <div class="cost-line"><span>Combustível</span><span>${BRL(est.combustivel)}</span></div>
            <div class="cost-line"><span>Hospedagem</span><span>${BRL(est.hospedagem)}</span></div>
            <div class="cost-line"><span>Alimentação</span><span>${BRL(est.alimentacao)}</span></div>
            <div class="cost-line"><span>Monitor</span><span>${BRL(est.monitor)}</span></div>
            <div class="cost-line"><span>Pedágios</span><span>${BRL(est.pedagios)}</span></div>
            <div class="cost-total"><span>Total</span><span>${BRL(estTotal)}</span></div>
          </div>
          <div class="cost-box real">
            <h4><i class="fas fa-receipt"></i> Reais</h4>
            <div class="cost-line"><span>Combustível</span><span>${BRL(parseNum(r.combustivel_real))}</span></div>
            <div class="cost-line"><span>Hospedagem</span><span>${BRL(parseNum(r.hospedagem_real))}</span></div>
            <div class="cost-line"><span>Alimentação</span><span>${BRL(parseNum(r.alimentacao_real))}</span></div>
            <div class="cost-line"><span>Monitor</span><span>${BRL(parseNum(r.monitor_real))}</span></div>
            <div class="cost-line"><span>Pedágios/Outros</span><span>${BRL(parseNum(r.pedagios_real||0)+parseNum(r.outros||0))}</span></div>
            <div class="cost-total"><span>Total</span><span>${BRL(realTotal)}</span></div>
          </div>
          <form class="launch-form expense-form" data-form-event-id="${id}" style="grid-column:1/-1; display:none;">
            <div class="form-grid">
              <div class="form-row"><label>Combustível</label><input type="number" step="0.01" name="combustivel_real" value="${parseNum(r.combustivel_real)||''}"/></div>
              <div class="form-row"><label>Hospedagem</label><input type="number" step="0.01" name="hospedagem_real" value="${parseNum(r.hospedagem_real)||''}"/></div>
              <div class="form-row"><label>Alimentação</label><input type="number" step="0.01" name="alimentacao_real" value="${parseNum(r.alimentacao_real)||''}"/></div>
              <div class="form-row"><label>Monitor</label><input type="number" step="0.01" name="monitor_real" value="${parseNum(r.monitor_real)||''}"/></div>
              <div class="form-row"><label>Pedágios</label><input type="number" step="0.01" name="pedagios_real" value="${parseNum(r.pedagios_real)||''}"/></div>
              <div class="form-row"><label>Outros</label><input type="number" step="0.01" name="outros" value="${parseNum(r.outros)||''}"/></div>
              <div class="form-row" style="grid-column:1/-1"><label>Observações</label><textarea name="observacoes" rows="2"></textarea></div>
            </div>
            <div class="form-actions" style="margin-top:8px;"><button type="button" class="btn btn-primary form-submit">Lançar</button></div>
          </form>
        </div>
      </details>`; });
    host.innerHTML = cards.join('');
    host.querySelectorAll('.custos-card').forEach(card=>{
      const id=card.getAttribute('data-event-id');
      const btnToggle=card.querySelector('.toggle-event'); const btnLaunch=card.querySelector('.launch-expense'); const form=card.querySelector('form.expense-form');
      if(btnToggle) btnToggle.addEventListener('click', ()=>{ card.open=!card.open; });
      if(btnLaunch) btnLaunch.addEventListener('click', ()=>{ if(!form) return; form.style.display = (form.style.display==='none'||!form.style.display)? 'block':'none'; });
      if(form){ const submit=form.querySelector('.form-submit'); if(submit){ submit.addEventListener('click', async ()=>{ const data=Object.fromEntries(new FormData(form).entries()); ['combustivel_real','hospedagem_real','alimentacao_real','monitor_real','pedagios_real','outros'].forEach(k=> data[k]=parseNum(data[k])); await enviarDespesaReal(id, data); form.style.display='none'; toast('Despesas registradas ✅'); try{ const b=card.querySelector('.launch-expense'); if(b){ b.textContent='Despesas registradas ✅'; b.disabled=true; } }catch(_){ } await refresh(currentPeriod()); }); } }
    });
  }

  async function refresh(period){ const lista=await fetchDespesas(); const filtrados=filterDespesas(period, lista); const totEst=calculateTotals(filtrados); const totReal=calculateReaisTotals(period); renderDespesas(totEst, totReal, period, filtrados); const cnt=byId('despesas-events-count'); if(cnt) cnt.textContent = `${filtrados.length} eventos`; renderEventosDespesas(filtrados); }

  function currentPeriod(){ const active=document.querySelector('#despesas-content [data-period].active'); return active? active.getAttribute('data-period'): 'week'; }
  function bindPeriodButtons(){ const scope=byId('despesas-content'); if(!scope) return; const btns=scope.querySelectorAll('[data-period]'); btns.forEach(btn=> btn.addEventListener('click', async ()=>{ btns.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); await refresh(btn.getAttribute('data-period')); })); }
  function bindReload(){ const b=byId('reload-despesas-btn'); if(!b) return; b.addEventListener('click', async ()=>{ try{ const data=getAgendaEventosArray(); if(Array.isArray(data)) saveLocalCache(data); }catch(_){ } await refresh(currentPeriod()); }); }
  function bindReset(){ const b=byId('reset-local-btn'); if(!b) return; b.addEventListener('click', ()=>{ try{ localStorage.clear(); }catch(_){ } toast('Dados locais resetados com sucesso.'); setTimeout(()=>{ try{ window.location.reload(); }catch(_){ } }, 500); }); }

  document.addEventListener('DOMContentLoaded', async ()=>{
    bindPeriodButtons(); bindReload(); bindReset();
    document.addEventListener('eventsUpdated', async ()=>{ try{ const data=getAgendaEventosArray(); if(Array.isArray(data)) saveLocalCache(data); }catch(_){ } await refresh(currentPeriod()); });
    await refresh(currentPeriod()||'week');
  });

  // API pública
  window.DESPESAS = { fetchDespesas, renderEventosDespesas, enviarDespesaReal, calcularLucroLiquido: function(period){ const lista=(loadLocalCache()||{}).data||[]; const eventos=filterDespesas(period||currentPeriod(), lista); const ids=eventos.map(e=>e.id_evento); let fat=sumFaturamentoPorEventos(ids); if(!fat) fat=getFaturamentoTopo(); const tot=calculateTotals(eventos); const base=fat*0.26; return { faturamentoTotal: fat, lucroBase: base, totalDespesas: tot.total||0, lucroLiquido: base-(tot.total||0) }; }, atualizarResumoFaturamento };
})();
