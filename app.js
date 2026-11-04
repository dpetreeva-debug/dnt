// --- НАСТРОЙКИ ПОДКЛЮЧЕНИЯ ---
const API_URL = 'api.php';

const $=id=>document.getElementById(id);
const KEY='dnt_v10';
const todayISO=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fmtD=iso=>iso?iso.split('-').reverse().join('.'):'';
const MN=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const MN_FULL=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtN=n=>{if(n==null||isNaN(n))return '0,00';const v=Math.round(n*100)/100;return v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})};
const fmtKwh=n=>{if(n==null||isNaN(n))return '0';return Math.round(n).toLocaleString('ru-RU')};
const fmtN2=n=>{if(n==null||isNaN(n))return '0,0';return n.toFixed(1).replace('.',',')};
function toast(m){const t=$('tst');t.textContent=m;t.classList.add('on');clearTimeout(t._);t._=setTimeout(()=>t.classList.remove('on'),2000)}

function defaults(){return{v:11,version:0,currentDate:todayISO(),openingBalance:0,billCurrentMonth:false,plots:[],readings:[],payments:[],dntOps:[],targets:[],tariffs:{elec:[{from:'2024-01-01',rate:4.8}],dues:[{from:'2024-01-01',rate:600}],trash:[{from:'2024-01-01',rate:360}]}}}
let S=load()||defaults();

// ЗАЩИТА ОТ КРЭШЕЙ (для старых данных)
if (!Array.isArray(S.targets)) S.targets = [];
if (!Array.isArray(S.plots)) S.plots = [];
if (!Array.isArray(S.readings)) S.readings = [];
if (!Array.isArray(S.payments)) S.payments = [];
if (!Array.isArray(S.dntOps)) S.dntOps = [];
if (!S.tariffs) S.tariffs = {elec:[],dues:[],trash:[]};
if (!Array.isArray(S.tariffs.elec)) S.tariffs.elec = [];
if (!Array.isArray(S.tariffs.dues)) S.tariffs.dues = [];
if (!Array.isArray(S.tariffs.trash)) S.tariffs.trash = [];
if (S.openingBalance === undefined) S.openingBalance = 0;
if (S.currentDate === undefined) S.currentDate = todayISO();
if (!Number.isInteger(S.version) || S.version < 0) S.version = 0;

function load(){try{const r=localStorage.getItem(KEY);return r?JSON.parse(r):null}catch(e){return null}}

function getBillingMonth() {
  if (S.billCurrentMonth === true) {
    return S.currentDate.slice(0, 7);
  }
  const d = new Date(S.currentDate);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// --- ЗАПРОСЫ К СЕРВЕРУ ---
function apiFetch(action, options = {}) {
  const token = localStorage.getItem('dnt_token');
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', 'Bearer ' + token);
  options.headers = headers;
  options.cache = 'no-store';
  return fetch(API_URL + '?action=' + encodeURIComponent(action) + '&t=' + Date.now(), options);
}

// --- СОХРАНЕНИЕ ---
async function save(){
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    toast('Сохранено на этом устройстве');
  } catch(e) {
    console.error('Ошибка локального сохранения', e);
    toast('Не удалось сохранить данные. Освободите место в браузере');
  }
}

function tariffRate(cat,m){
  const l=S.tariffs[cat].slice().sort((a,b)=>a.from.localeCompare(b.from));
  let r=0;
  const mDate = m.length === 7 ? m + '-01' : m; 
  for(const t of l) {
    if(t.from <= mDate) r = t.rate;
  }
  return r;
}
function monthsOfYear(y){const a=[];for(let m=1;m<=12;m++)a.push(y+'-'+String(m).padStart(2,'0'));return a}
function readingsOf(pid){return S.readings.filter(r=>r.plotId===pid).sort((a,b)=>a.date.localeCompare(b.date)||(a.ts||0)-(b.ts||0))}
function readingOn(pid,d){const a=readingsOf(pid).filter(r=>r.date===d);if(!a.length)return null;return a.find(r=>r.brk)||a[0]}
function calcCons(prev,cur){
  const cv=parseFloat(cur.value);if(isNaN(cv))return null;
  if(cur.init)return 0;
  if(cur.brk)return cv;
  if(!prev)return 0;
  const pv=parseFloat(prev.value);if(isNaN(pv))return 0;
  return cv-pv;
}
function elecForMonth(pid,m){
  const s=m+'-01',e=m+'-31';const all=readingsOf(pid);const inM=all.filter(r=>r.date>=s&&r.date<=e);
  if(!inM.length)return null;
  let cons=0,last=null;
  for(const cur of inM){const idx=all.indexOf(cur);const prev=idx>0?all[idx-1]:null;const c=calcCons(prev,cur);if(c!=null)cons+=c;last=cur}
  const rate=tariffRate('elec',last.date);
  return{consumption:cons,charge:cons*rate,rate,lastReading:last};
}
function chargesForMonth(p,m){
  if(p.owner==='meter')return{dues:0,trash:0};
  const mm=parseInt(m.slice(5,7), 10);
  const dr=tariffRate('dues',m),tr=tariffRate('trash',m);
  let d=0,t=0;
  if(p.owner==='permanent')d=dr;else if(mm>=5&&mm<=10)d=dr;
  if(p.trash==='full')t=tr;else if(p.trash==='seasonal'&&mm>=5&&mm<=10)t=tr;
  return{dues:d,trash:t};
}
function paymentsOn(pid,m,cat){const s=m+'-01',e=m+'-31';return S.payments.filter(p=>p.plotId===pid&&p.date>=s&&p.date<=e&&(!cat||p.cat===cat)).reduce((a,p)=>a+parseFloat(p.amount||0),0)}
function targetPlotDebt(pid){
  let debt=0;
  for(const t of (S.targets||[])){
    const eligible=S.plots.filter(p=>targetPlotEligible(p,t.scope||'all'));
    if(!eligible.some(p=>p.id===pid)) continue;
    const share=eligible.length ? (parseFloat(t.total)||0)/eligible.length : 0;
    const paid=S.payments.filter(x=>x.plotId===pid&&x.cat==='target'&&x.targetId===t.id)
      .reduce((sum,x)=>sum+(parseFloat(x.amount)||0),0);
    debt += Math.max(0,share-paid);
  }
  return debt;
}

function plotBalance(pid,year){
  year=year||S.currentDate.slice(0,4);
  const p=S.plots.find(x=>x.id===pid);if(!p)return 0;
  let ch=0;
  const nowMonth=getBillingMonth();
  const yearNow=S.currentDate.slice(0,4);
  for(const m of monthsOfYear(year)){
    if(year>yearNow)break;
    if(year===yearNow && m > nowMonth) break;
    const e=elecForMonth(pid,m);if(e)ch+=e.charge;
    const c=chargesForMonth(p,m);ch+=c.dues+c.trash;
  }
  const pd=S.payments.filter(x=>x.plotId===pid&&x.date.slice(0,4)===year&&x.cat!=='target').reduce((a,x)=>a+parseFloat(x.amount||0),0);
  const targetDebt = targetPlotDebt(pid);
  return ch-pd+(p.debtElec||0)+(p.debtDues||0)+(p.debtTrash||0)+targetDebt;
}

function getCategoryBalance(pid, year, cat) {
  const p = S.plots.find(x => x.id === pid); if (!p) return 0;
  let charged = 0;
  const nowMonth = getBillingMonth();
  const yearNow = S.currentDate.slice(0, 4);
  for (const m of monthsOfYear(year)) {
    if (year > yearNow) break;
    if (year === yearNow && m > nowMonth) break;
    if (cat === 'elec') {
      const e = elecForMonth(pid, m);
      if (e) charged += e.charge;
    } else if (cat === 'trash') {
      const c = chargesForMonth(p, m);
      charged += c.trash;
    } else if (cat === 'dues') {
      const c = chargesForMonth(p, m);
      charged += c.dues;
    }
  }
  const paid = S.payments.filter(x => x.plotId === pid && x.date.slice(0,4) === year && x.cat === cat).reduce((a, x) => a + parseFloat(x.amount || 0), 0);
  let debt = 0;
  if (cat === 'elec') debt = p.debtElec || 0;
  if (cat === 'trash') debt = p.debtTrash || 0;
  if (cat === 'dues') debt = p.debtDues || 0;
  return charged - paid + debt;
}

function dntBalance(){
  const inc = S.payments.reduce((a,p)=>a+parseFloat(p.amount||0),0)
            + S.dntOps.filter(o=>o.kind==='other_income').reduce((a,o)=>a+o.amount,0)
            + (S.openingBalance||0);
  const out = S.dntOps.filter(o=>o.kind==='elec_pay'||o.kind==='trash_pay'||o.kind==='expense')
                      .reduce((a,o)=>a+o.amount+(o.commission||0),0);
  return inc-out;
}

let confirmCb=null;
function askConfirm(title,text,onYes){$('cfT').textContent=title;$('cfP').textContent=text;confirmCb=onYes;$('mConfirm').classList.add('on')}
$('btnConfirmC').onclick=()=>{$('mConfirm').classList.remove('on');confirmCb=null};
$('btnConfirmD').onclick=()=>{const cb=confirmCb;$('mConfirm').classList.remove('on');confirmCb=null;if(cb)cb()};

function renderList(){
  const q=($('search').value||'').trim().toLowerCase();
  const g=$('grid');g.innerHTML='';
  if(!S.plots.length){g.innerHTML='<div class="emp grid-empty"><svg class="ic"><use href="#i-users"/></svg>Нет участков.<br>Нажмите «Настройки» внизу, чтобы добавить.</div>';return}
  for(const p of S.plots.filter(p=>!q||String(p.num).toLowerCase().includes(q))){
    const r=readingOn(p.id,S.currentDate);
    const bal=plotBalance(p.id);
    const cls=bal>0.005?'neg':bal<-0.005?'pos':'zero';
    const clsB=bal>0.005?'neg':bal<-0.005?'pos':'neu';
    const balLabel=bal>0.005?'Долг':bal<-0.005?'Переплата':'Ноль';
    const balValue=`${Math.abs(bal).toFixed(2).replace('.',',')} ₽`;
    const el=document.createElement('div');
    el.className='pc '+cls;
        const linkedBadge = p.linked ? `<span class="bdg cool" style="margin-left: 6px; margin-top: 7px; font-size: 9px; padding: 2px 6px;">+${esc(p.linked)}</span>` : '';
    el.innerHTML=
      `<div class="pc-num" style="display: flex; align-items: flex-start;">${esc(p.num)} ${linkedBadge}</div>`+
      `<div class="pc-m">${p.owner==='meter'?'Доп. счётчик':p.owner==='permanent'?'ПМЖ':'Дачник'} · ${p.trash==='none'?'—':p.trash==='seasonal'?'Сезон':'Мусор'}</div>`+
      `<div class="pc-r"><span>Счётчик</span><b>${r?esc(r.value):'—'}</b></div>`+
      `<div class="pc-b ${clsB} plot-card-balance">
         <span class="lbl">${balLabel}</span>
         <span class="val">${balValue}</span>
       </div>`;
    el.onclick=()=>openEntry(p.id);
    g.appendChild(el);
  }
}

let entry={plotId:null,value:'',mode:'reg'};
function openEntry(id){
  const p=S.plots.find(x=>x.id===id);if(!p)return;
  entry.plotId=id;
  const existingReadings=readingsOf(id);
  entry.mode=existingReadings.length===0?'init':'reg';
  const reg=S.readings.find(r=>r.plotId===id&&r.date===S.currentDate&&!r.brk&&!r.init);
  entry.value=reg?String(reg.value):'';
  $('mEntryT').textContent='Участок '+p.num;
  $('mEntryS').textContent='Показания на '+fmtD(S.currentDate);
  updateEntryInfo();updateDisp();syncEntryTabs();
  $('mEntry').classList.add('on');$('disp').classList.add('act');
}
function updateEntryInfo(){
  const id=entry.plotId;
  const all=readingsOf(id);
  const last=all.filter(r=>r.date<S.currentDate).pop();
  const hasRepl = S.readings.some(r=>r.plotId===id&&r.date===S.currentDate&&r.brk);
  
  let h = '';
  if(all.length===0){
    h += `<div class="info"><svg class="ic"><use href="#i-info"/></svg><div>Это <b>первое показание</b> участка. Оно сохранится как начальная точка.</div></div>`;
  } else if(entry.mode==='init'){
    h += `<div class="info"><svg class="ic"><use href="#i-info"/></svg><div>Режим <b>начального показания</b>. Расход = 0.</div></div>`;
  } else if(last){
    h += `<div class="info"><svg class="ic"><use href="#i-info"/></svg><div>Предыдущее (${fmtD(last.date)}): <b>${esc(last.value)}</b>${last.brk?' · замена':''}${last.init?' · начальное':''}</div></div>`;
  }
  if(hasRepl) h += `<div class="info cool"><svg class="ic"><use href="#i-info"/></svg><div>Сегодня уже отмечена замена счётчика</div></div>`;
  
  $('mEntryInfo').innerHTML = h;
}
function syncEntryTabs(){
  document.querySelectorAll('#mEntry .tabs-i button').forEach(b=>b.classList.toggle('on',b.dataset.m===entry.mode));
  const r=S.readings.find(x=>x.plotId===entry.plotId&&x.date===S.currentDate&&!!x.brk===(entry.mode==='brk')&&!!x.init===(entry.mode==='init'));
  entry.value=r?String(r.value):'';updateDisp();
}
function updateDisp(){const d=$('disp');if(entry.value===''){d.textContent='0';d.classList.add('empty')}else{d.textContent=entry.value.replace('.',',');d.classList.remove('empty')}}
function pressK(k){if(k==='back')entry.value=entry.value.slice(0,-1);else if(k==='.'){if(!entry.value.includes('.'))entry.value=(entry.value||'0')+'.'}else{if(entry.value==='0')entry.value='';if(entry.value.length<12)entry.value+=k}updateDisp()}
function saveEntry(){
  if(entry.value===''){$('mEntry').classList.remove('on');return}
  const {plotId,value,mode}=entry;
  const brk=mode==='brk';const init=mode==='init';
  const idx=S.readings.findIndex(r=>r.plotId===plotId&&r.date===S.currentDate&&!!r.brk===brk&&!!r.init===init);
  if(idx>=0)S.readings[idx]={...S.readings[idx],value,ts:Date.now()};
  else S.readings.push({plotId,date:S.currentDate,value,ts:Date.now(),brk:brk||undefined,init:init||undefined});
  save();$('mEntry').classList.remove('on');renderList();
  toast(init?'Начальное показание сохранено':brk?'Замена зафиксирована':'Сохранено');
}

let payPlot=null;
let editPayIdx = null; 
function openPay(pid, idx = null){
  payPlot=pid;
  editPayIdx = idx;
  const p=S.plots.find(x=>x.id===pid);
  $('mPayTitle').textContent = idx !== null ? 'Редактирование оплаты' : 'Оплата от жителя';
  $('mPayS').textContent='Участок '+p.num;
  
  if (idx !== null) {
    const pay = S.payments[idx];
    $('payDate').value = pay.date;
    $('paySum').value = pay.amount;
    $('payNote').value = pay.note || '';
    $('payCat').value = pay.cat || 'elec';
  } else {
    $('payDate').value=S.currentDate;
    $('paySum').value='';
    $('payNote').value='';
    $('payCat').value='elec';
  }
  
  updatePayInfo();
  
  if (idx !== null && S.payments[idx].cat === 'target' && S.payments[idx].targetId) {
    $('payTargetId').value = S.payments[idx].targetId;
  }
  
  $('mPay').classList.add('on');
}

function updatePayInfo() {
  if (!payPlot) return;
  const cat = $('payCat').value;
  const year = $('payDate').value.slice(0,4) || S.currentDate.slice(0,4);
  const mNow = $('payDate').value.slice(0,7) || S.currentDate.slice(0,7);
  const p = S.plots.find(x => x.id === payPlot);
  
  if (cat === 'target') {
    $('payInfoBox').classList.add('hidden');
    $('payTargetFld').classList.remove('hidden');
    const targetSel = $('payTargetId');
    const eligibleTargets = S.targets.filter(t => targetPlotEligible(p, t.scope || 'all'));
    const previous = targetSel.value;
    targetSel.innerHTML = eligibleTargets.map(t => `<option value="${t.id}">${esc(t.name)} (${fmtN(t.total)} ₽)</option>`).join('');
    if(!eligibleTargets.length) targetSel.innerHTML = '<option value="">Для этого участка нет подходящих целей</option>';
    else if(eligibleTargets.some(t=>t.id===previous)) targetSel.value=previous;
    return;
  } else {
    $('payTargetFld').classList.add('hidden');
  }
  
  let charged = 0;
  const nowMonth = getBillingMonth();
  const yearNow = S.currentDate.slice(0, 4);
  for (const m of monthsOfYear(year)) {
    if (year > yearNow) break;
    if (year === yearNow && m > nowMonth) break;
    if (cat === 'elec') {
      const e = elecForMonth(payPlot, m);
      if (e) charged += e.charge;
    } else if (cat === 'trash') {
      const c = chargesForMonth(p, m);
      charged += c.trash;
    } else if (cat === 'dues') {
      const c = chargesForMonth(p, m);
      charged += c.dues;
    }
  }
  
  const paid = S.payments.filter(x => x.plotId === payPlot && x.date.slice(0,4) === year && x.cat === cat && x !== S.payments[editPayIdx]).reduce((a, x) => a + parseFloat(x.amount || 0), 0);
  
  let curCharge = 0;
  if (cat === 'elec') {
    const e = elecForMonth(payPlot, mNow);
    if (e) curCharge = e.charge;
  } else if (cat === 'trash') {
    curCharge = chargesForMonth(p, mNow).trash;
  } else if (cat === 'dues') {
    curCharge = chargesForMonth(p, mNow).dues;
  }
  const curPaid = paymentsOn(payPlot, mNow, cat);

  let debt = 0;
  if (cat === 'elec') debt = p.debtElec || 0;
  if (cat === 'trash') debt = p.debtTrash || 0;
  if (cat === 'dues') debt = p.debtDues || 0;

  const bal = charged - paid + debt;
  
  $('payInfoAccrued').textContent = fmtN(charged) + ' ₽';
  $('payInfoPaid').textContent = fmtN(paid) + ' ₽';
  $('payInfoCurAccrued').textContent = fmtN(curCharge) + ' ₽';
  $('payInfoCurPaid').textContent = fmtN(curPaid) + ' ₽';
  
  const balEl = $('payInfoBal');
  balEl.textContent = fmtN(Math.abs(bal)) + ' ₽';
  if (bal > 0.005) {
    balEl.className = 'fw-600 text-neg';
    balEl.textContent = 'Долг ' + fmtN(bal) + ' ₽';
  } else if (bal < -0.005) {
    balEl.className = 'fw-600 text-pos';
    balEl.textContent = 'Переплата ' + fmtN(-bal) + ' ₽';
  } else {
    balEl.className = 'fw-600 text-muted';
    balEl.textContent = 'Ноль';
  }
  $('payInfoBox').classList.remove('hidden');
}
$('payCat').onchange = updatePayInfo;
$('payDate').onchange = updatePayInfo;

function savePay(){
  const a=parseFloat($('paySum').value);
  if(!a||a<=0){toast('Введите сумму');return}
  
  const cat = $('payCat').value;
  const targetId = cat === 'target' ? $('payTargetId').value : null;
  if(cat==='target'){
    const target=S.targets.find(t=>t.id===targetId);
    const plot=S.plots.find(p=>p.id===payPlot);
    if(!target || !targetPlotEligible(plot,target.scope||'all')){
      toast('Этот участок не участвует в выбранной цели');
      return;
    }
  }

  if (editPayIdx !== null) {
    S.payments[editPayIdx] = {
      ...S.payments[editPayIdx],
      date: $('payDate').value || todayISO(),
      amount: a,
      cat: cat,
      targetId: targetId,
      note: $('payNote').value
    };
  } else {
    S.payments.push({
      id: uid(),
      plotId: payPlot,
      date: $('payDate').value || todayISO(),
      amount: a,
      cat: cat,
      targetId: targetId,
      note: $('payNote').value
    });
  }
  
  save();
  $('mPay').classList.remove('on');
  renderList();
  toast(editPayIdx !== null ? 'Оплата изменена' : 'Оплата записана');
  editPayIdx = null;
}

function openHist(pid){
  const p=S.plots.find(x=>x.id===pid);
  $('mHistT').textContent='Участок '+p.num;$('mHistS').textContent='Показания и оплаты';
  
  const year = S.currentDate.slice(0,4);
  const nowY = parseInt(S.currentDate.slice(0,4),10);
  const nowM = parseInt(S.currentDate.slice(5,7),10);
  const yearNow = parseInt(year,10);
  const months = [];
  for(let m=1; m<=12; m++){
    if(yearNow > nowY) break;
    if(yearNow === nowY && m > nowM) break;
    months.push(year+'-'+String(m).padStart(2,'0'));
  }
  
  let totalDues = 0, totalTrash = 0, totalElec = 0;
  for(const m of months){
    const e = elecForMonth(pid, m);
    if(e) totalElec += e.charge;
    const c = chargesForMonth(p, m);
    totalDues += c.dues;
    totalTrash += c.trash;
  }
  const totalCharges = totalDues + totalTrash + totalElec;
  const totalPaid = S.payments.filter(x=>x.plotId===pid&&x.date.slice(0,4)===year&&x.cat!=='target').reduce((a,x)=>a+parseFloat(x.amount||0),0);
  const paidDues = S.payments.filter(x => x.plotId === pid && x.date.slice(0,4) === year && (!x.cat || x.cat === 'dues')).reduce((a,x) => a + parseFloat(x.amount || 0), 0);
  const paidTrash = S.payments.filter(x => x.plotId === pid && x.date.slice(0,4) === year && x.cat === 'trash').reduce((a,x) => a + parseFloat(x.amount || 0), 0);
  const paidElec = S.payments.filter(x => x.plotId === pid && x.date.slice(0,4) === year && x.cat === 'elec').reduce((a,x) => a + parseFloat(x.amount || 0), 0);
  const oldDebts = (p.debtElec||0)+(p.debtDues||0)+(p.debtTrash||0);
  const targetDebt = targetPlotDebt(pid);
  const targetPaid = S.payments.filter(x=>x.plotId===pid&&x.date.slice(0,4)===year&&x.cat==='target').reduce((a,x)=>a+parseFloat(x.amount||0),0);
  const bal = totalCharges - totalPaid + oldDebts + targetDebt;
  
  const monthNames = months.map(x=>MN[+x.slice(5,7)-1]).join(', ');
  const balColorClass = bal > 0.005 ? 'text-neg' : bal < -0.005 ? 'text-pos' : 'text-main';
  const balText = bal > 0.005 ? 'Долг' : bal < -0.005 ? 'Переплата' : 'Ноль';
  const balClass = bal > 0.005 ? 'warm' : bal < -0.005 ? 'cool' : 'mute';

  let calcHtml = `
  <div class="calc-block">
    <div class="calc-header" onclick="toggleCalc(this)">
      <div class="calc-head-inner">
        <span class="calc-title">Детализация баланса</span>
        <span class="bdg ${balClass} calc-badge">${balText}</span>
      </div>
      <svg class="ic ic-s calc-arrow"><use href="#i-down"/></svg>
    </div>
    
    <div class="calc-body">
      <div class="calc-meta">
        <div><span>Дата расчёта:</span> ${fmtD(S.currentDate)}</div>
        <div><span>Месяцев посчитано:</span> ${months.length} (${monthNames})</div>
      </div>
      
      <div class="row calc-row">
        <span class="calc-row-lbl">Взносы</span>
        <span class="row-v calc-row-val">${fmtN(totalDues)} ₽</span>
      </div>
      <div class="row calc-row">
        <span class="calc-row-lbl">Мусор</span>
        <span class="row-v calc-row-val">${fmtN(totalTrash)} ₽</span>
      </div>
      <div class="row calc-row">
        <span class="calc-row-lbl">Электроэнергия</span>
        <span class="row-v calc-row-val">${fmtN(totalElec)} ₽</span>
      </div>
      <div class="row calc-row fw-600">
        <span class="calc-row-lbl">Начислено всего</span>
        <span class="row-v calc-row-val">${fmtN(totalCharges)} ₽</span>
      </div>
      
      <div class="row calc-row calc-row-gap">
        <span class="calc-row-lbl">Оплачено — взносы</span>
        <span class="row-v text-pos calc-row-val">− ${fmtN(paidDues)} ₽</span>
      </div>
      <div class="row calc-row">
        <span class="calc-row-lbl">Оплачено — мусор</span>
        <span class="row-v text-pos calc-row-val">− ${fmtN(paidTrash)} ₽</span>
      </div>
      <div class="row calc-row">
        <span class="calc-row-lbl">Оплачено — электроэнергия</span>
        <span class="row-v text-pos calc-row-val">− ${fmtN(paidElec)} ₽</span>
      </div>
      <div class="row calc-row">
        <span class="calc-row-lbl">Целевые взносы (долг)</span>
        <span class="row-v calc-row-val ${targetDebt > 0.005 ? 'text-neg' : 'text-main'}">${fmtN(targetDebt)} ₽</span>
      </div>
      <div class="row calc-row">
        <span class="calc-row-lbl">${oldDebts < 0 ? 'Старая переплата' : 'Старые долги'}</span>
        <span class="row-v calc-row-val ${oldDebts > 0 ? 'text-neg' : oldDebts < 0 ? 'text-pos' : 'text-main'}">
          ${oldDebts !== 0 ? (oldDebts > 0 ? '+ ' : '− ') + fmtN(Math.abs(oldDebts)) + ' ₽' : '0 ₽'}
        </span>
      </div>
      
      <div class="row calc-row-total">
        <span class="calc-row-lbl">Итого</span>
        <span class="row-v calc-row-val ${balColorClass}">${fmtN(Math.abs(bal))} ₽</span>
      </div>
    </div>
  </div>`;

  const ev=[];
  S.readings.forEach((r, i) => {
    if(r.plotId === pid) {
      const all = readingsOf(pid);
      const idx = all.indexOf(r);
      const prev = idx > 0 ? all[idx - 1] : null;
      const c = r.brk || r.init ? null : calcCons(prev, r);
      ev.push({t:'r', d:r.date, v:r.value, cons:c, brk:r.brk, init:r.init, ts:r.ts||0, origIdx:i});
    }
  });
  S.payments.forEach((x, i) => {
    if(x.plotId === pid) {
      ev.push({t:'p', d:x.date, v:x.amount, cat:x.cat, note:x.note, ts:0, origIdx:i});
    }
  });
  
  ev.sort((a,b)=>b.d.localeCompare(a.d)||b.ts-a.ts);
  
  let eventsHtml = '';
  if(!ev.length) {
    eventsHtml = '<div class="emp">Пока пусто</div>';
  } else {
    eventsHtml = ev.map(e=>{
      if(e.t==='r'){
        let s='';
        if(e.brk)s='Замена счётчика (отсчёт с нуля)';
        else if(e.init)s='Начальное показание (точка отсчёта)';
        else if(e.cons!=null&&e.cons>0)s='Расход: '+fmtN2(e.cons)+' кВт·ч';
        else if(e.cons===0)s='Расход не изменился';
        
        return `<div class="row">
          <div class="row-t"><b>${fmtD(e.d)}</b><small>${s}</small></div>
          <div class="flex items-center gap-4">
            <span class="row-v clickable-val" onclick="editHistReading(${e.origIdx})">${esc(e.v)}</span>
            <button class="hist-del" onclick="delHist(${e.origIdx}, 'r')"><svg class="ic ic-s"><use href="#i-trash"/></svg></button>
          </div>
        </div>`;
      }
      const catName={elec:'Электро',dues:'Взносы',trash:'Мусор',target:'Целевой'};
      return `<div class="row">
        <div class="row-t"><b>${fmtD(e.d)} · ${catName[e.cat]||'Оплата'}</b><small>${esc(e.note||'Оплата')}</small></div>
        <div class="flex items-center gap-4">
          <span class="row-v text-pos clickable-val" onclick="editHistPayment(${e.origIdx})">+${fmtN(e.v)} ₽</span>
          <button class="hist-del" onclick="delHist(${e.origIdx}, 'p')"><svg class="ic ic-s"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('');
  }

  $('histBody').innerHTML = calcHtml + '<div class="sec-t hist-sec-title">История операций</div><div class="hist-scroll">' + eventsHtml + '</div>';
  $('mHist').classList.add('on');
}

function editHistReading(idx) {
  const r = S.readings[idx];
  if(!r) return;
  $('mHist').classList.remove('on');
  S.readings.splice(idx, 1);
  save();
  S.currentDate = r.date;
  $('dt').value = r.date;
  openEntry(r.plotId);
  if(r.value) entry.value = r.value;
  if(r.brk) entry.mode = 'brk';
  if(r.init) entry.mode = 'init';
  syncEntryTabs(); updateDisp();
  toast('Измените данные и сохраните');
}

function editHistPayment(idx) {
  const p = S.payments[idx];
  if(!p) return;
  $('mHist').classList.remove('on');
  openPay(p.plotId, idx);
}

function delHist(idx, type) {
  askConfirm('Удалить запись?', 'Баланс пересчитается автоматически.', () => {
    if (type === 'r') S.readings.splice(idx, 1);
    else if (type === 'p') S.payments.splice(idx, 1);
    save();
    $('mHist').classList.remove('on');
    renderList();
    toast('Запись удалена');
  });
}

function targetPlotEligible(p, scope='all'){
  if(!p || p.owner==='meter') return false;
  if(scope==='elec') return p.hasElec === true;
  if(scope==='trash') return p.trash === 'full' || p.trash === 'seasonal';
  return true;
}
function targetScopeName(scope){
  return scope==='elec' ? 'Электричество' : scope==='trash' ? 'Вывоз мусора' : 'Все участки';
}
function getPlotServiceCounts(){
  const plots=S.plots.filter(p=>p && p.owner!=='meter');
  return {total:plots.length,elec:plots.filter(p=>p.hasElec===true).length,trash:plots.filter(p=>p.trash==='full'||p.trash==='seasonal').length};
}
function renderPlotServiceCounts(){
  const el=$('plotServiceCounts');
  if(!el)return;
  const c=getPlotServiceCounts();
  el.innerHTML=`<div class="plot-count-line">Всего участков: <span>${c.total}</span></div>
    <div class="plot-count-line">Электричество: <span>${c.elec}</span></div>
    <div class="plot-count-line">Вывоз мусора: <span>${c.trash}</span></div>`;
}

function renderPlotList(){
  renderPlotServiceCounts();
  const b=$('plotList');
  if(!S.plots.length){b.innerHTML='<div class="emp set-list-empty">Пока пусто</div>';return}
  b.innerHTML='';
  S.plots.forEach((p,i)=>{
    const r=document.createElement('div');
    r.className='row plot-row';
    const ownerBdg=p.owner==='meter'?'<span class="bdg mute">Доп. счётчик</span>':p.owner==='permanent'?'<span class="bdg warm">ПМЖ</span>':'<span class="bdg cool">Дачник</span>';
    const trashBdg=p.trash==='full'?'<span class="bdg warm">Мусор 12м</span>':p.trash==='seasonal'?'<span class="bdg cool">Мусор сезон</span>':'<span class="bdg mute">Без мусора</span>';
    const elecBdg = p.hasElec !== false ? '<span class="bdg b">Свет</span>' : '<span class="bdg mute">Без света</span>';
    const linkedBdg = p.linked ? `<span class="bdg cool" style="background:var(--pos-l); color:var(--pos);">Связь: ${esc(p.linked)}</span>` : '';
    
    r.innerHTML=`
      <div class="row-t">
        <b>${esc(p.num)}</b>
        <small class="plot-badges">${ownerBdg} ${trashBdg} ${elecBdg} ${linkedBdg}</small>
      </div>
      <div class="plot-actions">
        <button class="btn btn-s btn-icon-sm" data-up="${i}"><svg class="ic ic-s"><use href="#i-up"/></svg></button>
        <button class="btn btn-s btn-icon-sm" data-dn="${i}"><svg class="ic ic-s"><use href="#i-down"/></svg></button>
        <button class="btn btn-p btn-icon-sm" data-ed="${i}"><svg class="ic ic-s"><use href="#i-edit"/></svg></button>
      </div>`;
    b.appendChild(r);
  });
  b.querySelectorAll('[data-up]').forEach(x=>x.onclick=()=>{const i=+x.dataset.up;if(i>0){[S.plots[i-1],S.plots[i]]=[S.plots[i],S.plots[i-1]];save();renderPlotList();renderList()}});
  b.querySelectorAll('[data-dn]').forEach(x=>x.onclick=()=>{const i=+x.dataset.dn;if(i<S.plots.length-1){[S.plots[i+1],S.plots[i]]=[S.plots[i],S.plots[i+1]];save();renderPlotList();renderList()}});
  b.querySelectorAll('[data-ed]').forEach(x=>x.onclick=()=>openPlotEdit(+x.dataset.ed));
}
let editIdx=-1;
function openPlotEdit(i){
  editIdx=i;const p=S.plots[i];
  $('mPlotT').textContent='Участок '+p.num;
  $('plNum').value=p.num;
  $('plFullName').value=p.fullName || '';
  $('plCadastral').value=p.cadastral || '';
  $('plRightDoc').value=p.rightDoc || '';
  $('plRightDate').value=p.rightDate || '';
  $('plArea').value=p.area || '';
  $('plLinked').value=p.linked || '';
  $('plPhone').value=p.phone || '';
  $('plEmail').value=p.email || '';
  $('plTg').value=p.tg || '';
  $('plMax').value=p.max || '';
  
  $('plOwner').value=p.owner||'dachnik';
  $('plTrash').value=p.trash||'full';
  $('plNote').value=p.note||'';
  $('plDebtElec').value=p.debtElec||0;
  $('plDebtDues').value=p.debtDues||0;
  $('plDebtTrash').value=p.debtTrash||0;
  $('plHasElec').checked = p.hasElec !== false;
  $('mPlot').classList.add('on');
}

function renderTariffs(){
  const names={elec:'Электроэнергия, ₽/кВт·ч',dues:'Взносы, ₽/мес',trash:'Мусор, ₽/мес'};
  const b=$('tariffBox');b.innerHTML='';
  for(const cat of ['elec','dues','trash']){
    const l=S.tariffs[cat].slice().sort((a,b)=>b.from.localeCompare(a.from));
    let html=`<div class="tariff-group"><div class="tariff-title">${names[cat]}</div>`;
    html+=l.map(t=>`<div class="tariff-item"><span class="tariff-date">с ${fmtD(t.from)}</span><span class="tariff-rate">${t.rate} ₽<button class="tariff-del" data-del="${cat}:${t.from}"><svg class="ic ic-s"><use href="#i-close"/></svg></button></span></div>`).join('');
    html+='</div>';b.innerHTML+=html;
  }
  b.innerHTML+=`<div class="fld mt-16"><label>Категория</label><select id="tCat"><option value="elec">Электроэнергия</option><option value="dues">Взносы</option><option value="trash">Мусор</option></select></div>
    <div class="tariff-add-form">
      <div><label class="tariff-add-lbl">С даты</label><input type="date" id="tFrom" value="${todayISO()}" class="set-input-sm"></div>
      <div><label class="tariff-add-lbl">Ставка</label><input type="number" id="tRate" inputmode="decimal" class="set-input-sm"></div>
      <button class="btn btn-p btn-ic" id="tAdd"><svg class="ic"><use href="#i-plus"/></svg></button>
    </div>`;
  $('tAdd').onclick=()=>{const cat=$('tCat').value,from=$('tFrom').value,rate=parseFloat($('tRate').value);if(!from||!rate){toast('Заполните дату и ставку');return}S.tariffs[cat]=S.tariffs[cat].filter(t=>t.from!==from);S.tariffs[cat].push({from,rate});save();renderTariffs();renderList();toast('Тариф добавлен')};
  b.querySelectorAll('[data-del]').forEach(x=>x.onclick=()=>{const[cat,from]=x.dataset.del.split(':');S.tariffs[cat]=S.tariffs[cat].filter(t=>t.from!==from);save();renderTariffs();renderList()});
}

function renderTargets(){
  const b=$('targetList');b.innerHTML='';
  if(!S.targets.length){ b.innerHTML='<div class="emp set-list-empty" style="padding:14px 0">Пока нет целей</div>'; return; }
  b.innerHTML = S.targets.map(t=>`
    <div class="row">
      <div class="row-t"><b>${esc(t.name)}</b><small>${fmtD(t.date)} · ${targetScopeName(t.scope || 'all')}</small></div>
      <div class="flex items-center gap-4">
        <span class="row-v">${fmtN(t.total)} ₽</span>
        <button class="hist-del" onclick="delTarget('${t.id}')"><svg class="ic ic-s"><use href="#i-trash"/></svg></button>
      </div>
    </div>
  `).join('');
}

function delTarget(id) {
  askConfirm('Удалить цель?', 'Все оплаты по этой цели останутся, но потеряют привязку.', () => {
    S.targets = S.targets.filter(t => t.id !== id);
    save(); renderTargets(); toast('Цель удалена');
  });
}

function renderMap() {
  // 1. Выводим статистику
  const totalPlots = S.plots.length;
  const totalArea = S.plots.reduce((sum, p) => sum + (parseFloat(p.area) || 0), 0);
  
  const totalEl = document.getElementById('regTotalPlots');
  const areaEl = document.getElementById('regTotalArea');
  
  if(totalEl) totalEl.textContent = totalPlots;
  if(areaEl) areaEl.textContent = fmtN(totalArea) + ' кв.м.';
  
  // 2. Рендерим список
  renderRegistryList();
}

function renderRegistryList() {
  const searchEl = document.getElementById('searchReg');
  const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const list = document.getElementById('registryList');
  if(!list) return;
  
  list.innerHTML = '';
  
  // Собираем номера всех связанных участков, чтобы не выводить их дважды
  let linkedNums = new Set();
  S.plots.forEach(p => {
    if (p.linked) {
      p.linked.split(',').forEach(n => linkedNums.add(n.trim()));
    }
  });

  const filtered = S.plots.filter(p => {
    if (linkedNums.has(String(p.num))) return false; 
    
    return !q || 
      String(p.num).toLowerCase().includes(q) || 
      (p.fullName && p.fullName.toLowerCase().includes(q)) ||
      (p.cadastral && p.cadastral.toLowerCase().includes(q)) ||
      (p.linked && p.linked.toLowerCase().includes(q)); 
  }).sort((a,b) => String(a.num).localeCompare(String(b.num), undefined, {numeric: true}));

  if(!filtered.length) {
    list.innerHTML = '<div class="emp">Ничего не найдено</div>';
    return;
  }

  filtered.forEach(p => {
    const el = document.createElement('div');
    el.className = 'reg-item';
    
    const displayNum = p.linked ? `${p.num}, ${p.linked}` : p.num;
    // Заменяем перенос строки на запятую для компактного списка
    const displayName = p.fullName ? p.fullName.replace(/<br>/g, ', ') : 'ФИО не указано';
    const displayCad = p.cadastral ? p.cadastral.replace(/<br>/g, ', ') : 'Кадастр не указан';
    
    el.innerHTML = `
      <div class="reg-item-num" style="width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${esc(displayNum)}">${esc(displayNum)}</div>
      <div class="reg-item-info">
        <div class="reg-item-cad">${esc(displayName)}</div>
        <div class="reg-item-area">${p.cadastral ? 'КН: ' + esc(displayCad) : 'КН нет'} ${p.area ? ' · ' + fmtN(p.area) + ' кв.м.' : ''}</div>
      </div>
      <svg class="ic ic-s text-muted"><use href="#i-down"/></svg>
    `;
    el.onclick = () => openOwnerDetail(p.id);
    list.appendChild(el);
  });
}

function openOwnerDetail(pid) {
  const p = S.plots.find(x => x.id === pid);
  if(!p) return;
  
  const titleEl = document.getElementById('mOwnerTitle');
  const subEl = document.getElementById('mOwnerSub');
  const bodyEl = document.getElementById('mOwnerBody');
  
  if(titleEl) titleEl.textContent = 'Участок ' + p.num + (p.linked ? `, ${p.linked}` : '');
  if(subEl) subEl.textContent = p.owner === 'permanent' ? 'ПМЖ' : (p.owner === 'meter' ? 'Доп. счётчик' : 'Дачник');
  
  let html = '';
  const row = (label, val, isHtml = false) => {
    if (!val) return '';
    return `<div class="row" style="padding: 10px 0; align-items: flex-start;">
      <span class="text-muted" style="flex-shrink:0; width: 120px; font-size:13px;">${label}</span>
      <span class="fw-500 text-right" style="font-size:13px; word-break: break-word;">${isHtml ? val : esc(val)}</span>
    </div>`;
  };

  // Передаем true, чтобы приложение не экранировало тег <br> и ФИО выводилось с новой строки
  html += row('ФИО', p.fullName); 
  html += row('Кадастровый №', p.cadastral); 
  html += row('Право №', p.rightDoc);
  html += row('Право от', p.rightDate ? fmtD(p.rightDate) : '');
  html += row('Площадь', p.area ? fmtN(p.area) + ' кв.м.' : '');
  
  if (p.linked) {
    let linksHtml = p.linked.split(',').map(num => {
      const linkedPlot = S.plots.find(x => String(x.num) === num.trim());
      if (linkedPlot) {
        return `<a href="#" onclick="event.preventDefault(); document.getElementById('mOwnerDetail').classList.remove('on'); openOwnerDetail('${linkedPlot.id}');" style="color:var(--ac); text-decoration:none; margin-right:8px; font-weight:600;">Уч. ${num.trim()}</a>`;
      }
      return `<span style="margin-right:8px;">Уч. ${num.trim()}</span>`;
    }).join('');
    html += row('Связанные участки', linksHtml, true);
  }

  if (p.phone) html += row('Телефон', `<a href="tel:${p.phone}" style="color:var(--ac); text-decoration:none;">${esc(p.phone)}</a>`, true);
  if (p.email) html += row('Email', `<a href="mailto:${p.email}" style="color:var(--ac); text-decoration:none;">${esc(p.email)}</a>`, true);
  if (p.tg) {
    const tgLink = p.tg.startsWith('@') ? `https://t.me/${p.tg.slice(1)}` : (p.tg.startsWith('http') ? p.tg : `https://t.me/${p.tg}`);
    html += row('Telegram', `<a href="${tgLink}" target="_blank" style="color:var(--ac); text-decoration:none;">${esc(p.tg)}</a>`, true);
  }
  if (p.max) html += row('Max', p.max);
  if (p.note) html += row('Заметка', p.note);
  
  html += `<div class="div"></div>
  <div class="row" style="padding: 0; border: none;">
    <span class="text-muted">Баланс</span>
    <span class="row-v ${plotBalance(p.id) > 0.005 ? 'text-neg' : plotBalance(p.id) < -0.005 ? 'text-pos' : 'text-main'}">${fmtN(Math.abs(plotBalance(p.id)))} ₽</span>
  </div>`;

  if(bodyEl) bodyEl.innerHTML = html;
  
  const modalEl = document.getElementById('mOwnerDetail');
  if(modalEl) modalEl.classList.add('on');
}

function renderDash(){
  const y=S.currentDate.slice(0,4);const mNow=S.currentDate.slice(0,7);
  const bal=dntBalance();const hero=$('heroBal');
  hero.className='st st-hero'+(bal<0?' neg':bal>0?' pos':'');
  $('dBalance').textContent=fmtN(bal)+' ₽';
  
  const inM=S.payments.filter(p=>p.date.slice(0,7)===mNow).reduce((a,p)=>a+parseFloat(p.amount),0);
  const outM=S.dntOps.filter(o=>o.date.slice(0,7)===mNow&&(o.kind==='elec_pay'||o.kind==='trash_pay'||o.kind==='expense')).reduce((a,o)=>a+o.amount+(o.commission||0),0);
  $('dIn').textContent=fmtN(inM)+' ₽';$('dOut').textContent=fmtN(outM)+' ₽';

  // Debts by category
  let debts = {elec:0, dues:0, trash:0};
  let overs = {elec:0, dues:0, trash:0};
  for(const p of S.plots){
    ['elec','dues','trash'].forEach(cat => {
      let b = getCategoryBalance(p.id, y, cat);
      if(b > 0.005) debts[cat] += b;
      else if(b < -0.005) overs[cat] += -b;
    });
  }

  $('dashDebts').innerHTML = `
    <div class="row">
      <span class="text-muted">Долг: Электро</span>
      <span class="row-v text-neg clickable-val" onclick="showDebtList('elec', true)">${fmtN(debts.elec)} ₽</span>
    </div>
    <div class="row">
      <span class="text-muted">Долг: Взносы</span>
      <span class="row-v text-neg clickable-val" onclick="showDebtList('dues', true)">${fmtN(debts.dues)} ₽</span>
    </div>
    <div class="row">
      <span class="text-muted">Долг: Мусор</span>
      <span class="row-v text-neg clickable-val" onclick="showDebtList('trash', true)">${fmtN(debts.trash)} ₽</span>
    </div>
    <div class="row">
      <span class="text-muted">Переплата: Электро</span>
      <span class="row-v text-pos clickable-val" onclick="showDebtList('elec', false)">${fmtN(overs.elec)} ₽</span>
    </div>
    <div class="row">
      <span class="text-muted">Переплата: Взносы</span>
      <span class="row-v text-pos clickable-val" onclick="showDebtList('dues', false)">${fmtN(overs.dues)} ₽</span>
    </div>
    <div class="row">
      <span class="text-muted">Переплата: Мусор</span>
      <span class="row-v text-pos clickable-val" onclick="showDebtList('trash', false)">${fmtN(overs.trash)} ₽</span>
    </div>
  `;

  // Year summary
  let yElec=0, yDues=0, yTrash=0, yTarget=0, yExp=0, yOtherInc=0;
  let spentElec=0, spentTrash=0;
  
  S.payments.forEach(p => {
    if(p.date.slice(0,4) === y) {
      if(p.cat === 'elec') yElec += parseFloat(p.amount);
      else if(p.cat === 'dues') yDues += parseFloat(p.amount);
      else if(p.cat === 'trash') yTrash += parseFloat(p.amount);
      else if(p.cat === 'target') yTarget += parseFloat(p.amount);
    }
  });
  
  S.dntOps.forEach(o => {
    if(o.date.slice(0,4) === y) {
      if(o.kind === 'expense') yExp += o.amount;
      else if(o.kind === 'elec_pay') spentElec += o.amount + (o.commission||0);
      else if(o.kind === 'trash_pay') spentTrash += o.amount;
      else if(o.kind === 'other_income') yOtherInc += o.amount;
    }
  });

  const totalTargetsSum = (S.targets||[]).reduce((a,t)=>a+t.total, 0);
  const allTimeTargetCollected = S.payments.filter(p => p.cat === 'target').reduce((a,p)=>a+parseFloat(p.amount),0);
  const leftToCollect = Math.max(0, totalTargetsSum - allTimeTargetCollected);

  $('dashYearSummary').innerHTML = `
    <div class="row"><span class="text-muted">Электро: собрано</span><span class="row-v text-pos">+${fmtN(yElec)} ₽</span></div>
    <div class="row"><span class="text-muted">Электро: потрачено</span><span class="row-v text-neg">−${fmtN(spentElec)} ₽</span></div>
    <div class="row fw-500"><span class="text-main">Электро: итог</span><span class="row-v ${(yElec-spentElec)<0?'text-neg':'text-pos'}">${fmtN(yElec-spentElec)} ₽</span></div>
    
    <div class="row mt-8"><span class="text-muted">Взносы: собрано</span><span class="row-v text-pos">+${fmtN(yDues)} ₽</span></div>
    <div class="row"><span class="text-muted">Взносы: потрачено</span><span class="row-v text-neg">−${fmtN(yExp)} ₽</span></div>
    <div class="row fw-500"><span class="text-main">Взносы: итог</span><span class="row-v ${(yDues-yExp)<0?'text-neg':'text-pos'}">${fmtN(yDues-yExp)} ₽</span></div>
    
    <div class="row mt-8"><span class="text-muted">Мусор: собрано</span><span class="row-v text-pos">+${fmtN(yTrash)} ₽</span></div>
    <div class="row"><span class="text-muted">Мусор: потрачено</span><span class="row-v text-neg">−${fmtN(spentTrash)} ₽</span></div>
    <div class="row fw-500"><span class="text-main">Мусор: итог</span><span class="row-v ${(yTrash-spentTrash)<0?'text-neg':'text-pos'}">${fmtN(yTrash-spentTrash)} ₽</span></div>
    
    <div class="row mt-8"><span class="text-muted">Целевые: собрано</span><span class="row-v text-pos">+${fmtN(yTarget)} ₽</span></div>
    <div class="row"><span class="text-muted">Целевые: осталось собрать</span><span class="row-v text-hint">${fmtN(leftToCollect)} ₽</span></div>
    
    <div class="row mt-8"><span class="text-muted">Общие расходы (всего)</span><span class="row-v text-neg">−${fmtN(yExp)} ₽</span></div>
  `;

  const months=[];const now=new Date(S.currentDate);
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))}
  const kWhs=months.map(m=>{let s=0;for(const p of S.plots.filter(p=>p.hasElec!==false)){const e=elecForMonth(p.id,m);if(e)s+=e.consumption}return s});
  const maxK=Math.max(...kWhs,1);
  
  $('chartKwh').innerHTML=kWhs.map((v,i)=>`
    <div class="bar${i===5?'':' mute'} bar-clickable" 
         style="height:${Math.max(4,v/maxK*100)}%" 
         onclick="showMonthDetail('${months[i]}')">
      <span class="v">${v>0?Math.round(v):''}</span>
    </div>`).join('');
    
  $('chartKwhLbl').innerHTML=months.map(m=>`<span>${MN[+m.slice(5,7)-1]}</span>`).join('');
  
  let nowK=0,cnt=0;
  for(const p of S.plots.filter(p=>p.hasElec!==false)){
    const e=elecForMonth(p.id,mNow);
    if(e){nowK+=e.consumption;if(e.consumption>0)cnt++}
  }
  $('dKwh').textContent=fmtKwh(nowK);
  $('dKwhCount').textContent=cnt;
  $('dKwhTotal').textContent=S.plots.filter(p=>p.hasElec!==false).length;
  
  const yrK=S.dntOps.filter(o=>o.date.slice(0,4)===y&&o.kind==='elec_pay').reduce((a,o)=>a+(o.kwh||0),0);
  let residentK=0;
  for(const m of monthsOfYear(y).filter(m=>m<=mNow))for(const p of S.plots.filter(p=>p.hasElec!==false)){const e=elecForMonth(p.id,m);if(e)residentK+=e.consumption}
  const loss=yrK>0&&residentK>0?((yrK-residentK)/residentK*100):0;
  $('dLoss').textContent=loss>0?'+'+loss.toFixed(1)+'%':'0%';
  const circ=$('circKwh');const dash=314.16;const progress=S.plots.length?cnt/S.plots.length:0;
  circ.style.transition='stroke-dashoffset .8s ease-out';circ.style.strokeDashoffset=(dash*(1-progress)).toFixed(1);
  
  const ins=months.map(m=>S.payments.filter(p=>p.date.slice(0,7)===m).reduce((a,p)=>a+parseFloat(p.amount),0));
  const outs=months.map(m=>S.dntOps.filter(o=>o.date.slice(0,7)===m&&(o.kind==='elec_pay'||o.kind==='trash_pay'||o.kind==='expense')).reduce((a,o)=>a+o.amount+(o.commission||0),0));
  const maxF=Math.max(...ins,...outs,1);
  
  $('chartFin').innerHTML=months.map((m,i)=>`<div class="bar-clickable fin-chart-col" onclick="showFinDetail('${m}')"><div class="bar fin-chart-bar-pos" style="height:${Math.max(3,ins[i]/maxF*100)}%"></div><div class="bar fin-chart-bar-neg" style="height:${Math.max(3,outs[i]/maxF*100)}%"></div></div>`).join('');
  $('chartFinLbl').innerHTML=months.map(m=>`<span>${MN[+m.slice(5,7)-1]}</span>`).join('');
}

function showDebtList(cat, isDebt) {
  const y = S.currentDate.slice(0,4);
  const catNames = {elec: 'Электроэнергия', dues: 'Взносы', trash: 'Мусор'};
  $('mDebtListTitle').textContent = (isDebt ? 'Должники: ' : 'Переплата: ') + catNames[cat];
  $('mDebtListSub').textContent = 'За ' + y + ' год';
  
  let html = '';
  S.plots.forEach(p => {
    let b = getCategoryBalance(p.id, y, cat);
    if(isDebt && b > 0.005) {
      html += `<div class="row"><span class="text-muted">Участок ${esc(p.num)}</span><span class="row-v text-neg">${fmtN(b)} ₽</span></div>`;
    } else if(!isDebt && b < -0.005) {
      html += `<div class="row"><span class="text-muted">Участок ${esc(p.num)}</span><span class="row-v text-pos">${fmtN(-b)} ₽</span></div>`;
    }
  });
  
  $('mDebtListBody').innerHTML = html || '<div class="emp">Список пуст</div>';
  $('mDebtList').classList.add('on');
}

function showFinDetail(m) {
  const [year, month] = m.split('-');
  const monthName = MN_FULL[parseInt(month)-1];
  
  const monthPays = S.payments.filter(p => p.date.slice(0, 7) === m);
  const monthOps = S.dntOps.filter(o => o.date.slice(0, 7) === m);
  
  let cats = {
    elec: {in: 0, out: 0, name: 'Электроэнергия'},
    dues: {in: 0, out: 0, name: 'Взносы'},
    trash: {in: 0, out: 0, name: 'Мусор'},
    target: {in: 0, out: 0, name: 'Целевые взносы'},
    expense: {in: 0, out: 0, name: 'Общие расходы'},
    other: {in: 0, out: 0, name: 'Прочее'}
  };
  
  monthPays.forEach(p => {
    if(cats[p.cat]) cats[p.cat].in += parseFloat(p.amount);
    else cats.other.in += parseFloat(p.amount);
  });
  
  monthOps.forEach(o => {
    if(o.kind === 'elec_pay') cats.elec.out += o.amount + (o.commission||0);
    else if(o.kind === 'trash_pay') cats.trash.out += o.amount;
    else if(o.kind === 'expense') cats.expense.out += o.amount;
    else if(o.kind === 'other_income') cats.other.in += o.amount;
  });
  
  let html = '';
  let totalIn = 0, totalOut = 0;
  
  for (let key in cats) {
    const c = cats[key];
    if (c.in > 0 || c.out > 0) {
      if (key === 'elec' || key === 'trash') {
        html += `<div class="row"><span class="text-muted">${c.name}: собрано</span><span class="row-v text-pos">+${fmtN(c.in)} ₽</span></div>
                 <div class="row"><span class="text-muted">${c.name}: потрачено</span><span class="row-v text-neg">−${fmtN(c.out)} ₽</span></div>
                 <div class="row fw-500"><span class="text-main">${c.name}: итог</span><span class="row-v ${c.in-c.out<0?'text-neg':'text-pos'}">${fmtN(c.in-c.out)} ₽</span></div>`;
      } else if (key === 'dues') {
        html += `<div class="row"><span class="text-muted">Взносы: собрано</span><span class="row-v text-pos">+${fmtN(c.in)} ₽</span></div>
                 <div class="row fw-500"><span class="text-main">Взносы: итог</span><span class="row-v text-pos">${fmtN(c.in)} ₽</span></div>`;
      } else if (key === 'target') {
        html += `<div class="row"><span class="text-muted">Целевые: собрано</span><span class="row-v text-pos">+${fmtN(c.in)} ₽</span></div>`;
      } else if (key === 'expense') {
        html += `<div class="row"><span class="text-muted">Расходы</span><span class="row-v text-neg">−${fmtN(c.out)} ₽</span></div>`;
      } else if (key === 'other') {
        html += `<div class="row"><span class="text-muted">Прочее: приход</span><span class="row-v text-pos">+${fmtN(c.in)} ₽</span></div>`;
      }
      totalIn += c.in;
      totalOut += c.out;
    }
  }
  
  html += `<div class="div"></div>
  <div class="row"><span class="fw-500">Итого приход</span><span class="row-v text-pos">+${fmtN(totalIn)} ₽</span></div>
  <div class="row"><span class="fw-500">Итого расход</span><span class="row-v text-neg">−${fmtN(totalOut)} ₽</span></div>`;

  $('mFinDetailTitle').textContent = 'Движение за ' + monthName;
  $('mFinDetailSub').textContent = 'Детализация доходов и расходов';
  $('mFinDetailBody').innerHTML = html;
  $('mFinDetail').classList.add('on');
}

function showAllPayments(cat) {
  const mSelected = getBillingMonth();
  let title = '';
  let items = [];

  if (cat === 'elec') {
    title = 'Электроэнергия';
    items = S.payments.filter(p => p.date.startsWith(mSelected) && p.cat === 'elec').map(p => ({...p, type: 'pay', amount: p.amount, note: p.note, plotId: p.plotId}));
    const ops = S.dntOps.filter(o => o.date.startsWith(mSelected) && o.kind === 'elec_pay').map(o => ({...o, type: 'op', amount: -(o.amount + (o.commission||0)), note: o.note, plotId: null}));
    items = items.concat(ops);
  } else if (cat === 'trash') {
    title = 'Мусор';
    items = S.payments.filter(p => p.date.startsWith(mSelected) && p.cat === 'trash').map(p => ({...p, type: 'pay', amount: p.amount, note: p.note, plotId: p.plotId}));
    const ops = S.dntOps.filter(o => o.date.startsWith(mSelected) && o.kind === 'trash_pay').map(o => ({...o, type: 'op', amount: -o.amount, note: o.note, plotId: null}));
    items = items.concat(ops);
  } else if (cat === 'dues') {
    title = 'Взносы';
    items = S.payments
      .filter(p => p.date.startsWith(mSelected) && (p.cat === 'dues' || p.cat === 'target'))
      .map(p => ({
        ...p,
        type: 'pay',
        amount: p.amount,
        note: p.cat === 'target'
          ? 'Целевой взнос' + (p.note ? ' · ' + p.note : '')
          : p.note,
        plotId: p.plotId
      }));
  } else if (cat === 'exp') {
    title = 'Расходы';
    items = S.dntOps.filter(o => o.date.startsWith(mSelected) && o.kind === 'expense').map(o => ({...o, type: 'op', amount: -o.amount, note: o.note, plotId: null}));
  }

  items.sort((a,b) => a.date.localeCompare(b.date));

  let html = `<div class="fs-13 text-muted mb-12" style="padding: 0 16px;">Месяц: <b>${MN_FULL[parseInt(mSelected.slice(5,7))-1]}</b></div>`;
  
  if (items.length === 0) {
    html += '<div class="emp">Нет операций за этот месяц.</div>';
  } else {
    html += '<div class="cd">';
    let total = 0;
    items.forEach(item => {
      const plot = item.plotId ? S.plots.find(x => x.id === item.plotId) : null;
      const plotNum = plot ? `Уч. ${plot.num}` : (item.type === 'op' ? 'ДНТ' : 'Общее');
      const colorClass = item.amount > 0 ? 'text-pos' : 'text-neg';
      
      html += `<div class="row" style="padding:10px 0;">
        <div class="row-t">
          <b>${plotNum}</b>
          <small>${fmtD(item.date)} ${item.note ? '· '+item.note : ''}</small>
        </div>
        <span class="row-v ${colorClass}">${item.amount > 0 ? '+' : ''}${fmtN(item.amount)} ₽</span>
      </div>`;
      total += item.amount;
    });
    html += '</div>';
    
    html += `<div class="cd" style="margin-top:12px;">
      <div class="row" style="padding:0; border:none;">
        <span class="fw-600 text-main" style="font-size:15px;">ИТОГО</span>
        <span class="row-v fw-600 ${total >= 0 ? 'text-pos' : 'text-neg'}" style="font-size:18px;">${total > 0 ? '+' : ''}${fmtN(total)} ₽</span>
      </div>
    </div>`;
  }

  $('mMonthDetailTitle').textContent = 'Детализация: ' + title;
  $('mMonthDetailSub').textContent = 'Все операции за расчетный месяц';
  $('mMonthDetailBody').innerHTML = html;
  $('mMonthDetail').classList.add('on');
}

function showMonthDetail(m) {
  const [year, month] = m.split('-');
  const monthName = MN_FULL[parseInt(month)-1];
  
  let totalKwh = 0;
  let plotsWithData = 0;
  let topConsumers = [];
  
  for (const p of S.plots.filter(p=>p.hasElec!==false)) {
    const e = elecForMonth(p.id, m);
    if (e && e.consumption > 0) {
      totalKwh += e.consumption;
      plotsWithData++;
      topConsumers.push({ num: p.num, val: e.consumption, charge: e.charge });
    }
  }
  
  topConsumers.sort((a, b) => b.val - a.val);
  
  $('mMonthDetailTitle').textContent = monthName + ' ' + year;
  $('mMonthDetailSub').textContent = 'Детализация потребления электроэнергии';
  
  let html = `
    <div class="stat-g month-detail-stat">
      <div class="st st-hero pos">
        <div class="st-lbl">Всего потреблено</div>
        <div class="st-num">${fmtKwh(totalKwh)} кВт·ч</div>
        <div class="st-sub">Сдано показаний: ${plotsWithData} из ${S.plots.filter(p=>p.hasElec!==false).length} участков</div>
      </div>
    </div>
    <div class="sec"><div class="sec-t">Список потребителей</div></div>
    <div class="cd">
  `;
  
  if (topConsumers.length === 0) {
    html += '<div class="text-center text-muted month-detail-empty">Нет данных за этот месяц</div>';
  } else {
    topConsumers.forEach((c, idx) => {
      const isExtra = idx >= 5;
      const extraClass = isExtra ? 'extra-consumer' : '';
      const extraStyle = isExtra ? 'hidden' : '';
      html += `
        <div class="row ${extraClass} ${extraStyle}">
          <div class="row-t"><b>Участок ${esc(c.num)}</b><small>Начислено: ${fmtN(c.charge)} ₽</small></div>
          <span class="row-v">${fmtKwh(c.val)} кВт·ч</span>
        </div>
      `;
    });
    if (topConsumers.length > 5) {
      html += `<div class="month-detail-btn-wrap"><button class="btn btn-s btn-sm" id="btnShowMore" onclick="toggleMonthExtra()">Показать всех (${topConsumers.length})</button></div>`;
    }
  }
  html += '</div>';
  $('mMonthDetailBody').innerHTML = html;
  $('mMonthDetail').classList.add('on');
}

function toggleMonthExtra() {
  const els = document.querySelectorAll('.extra-consumer');
  const btn = document.getElementById('btnShowMore');
  if (els.length === 0) return;
  if (els[0].classList.contains('hidden')) {
    els.forEach(e => e.classList.remove('hidden'));
    btn.textContent = 'Свернуть';
  } else {
    els.forEach(e => e.classList.add('hidden'));
    btn.textContent = 'Показать всех (' + (els.length + 5) + ')';
  }
}

function toggleOps(el) {
  const list = el.closest('.ops-list-wrap');
  const hiddenItems = list.querySelectorAll('.extra-op-item');
  const isExpanded = el.classList.contains('expanded');
  
  hiddenItems.forEach(item => {
    if (isExpanded) item.classList.add('hidden');
    else item.classList.remove('hidden');
  });
  
  el.classList.toggle('expanded');
}

let editOpId = null;
function deleteDntOp(id) {
  askConfirm('Удалить операцию?', 'Расход или счёт будет удалён из истории.', () => {
    S.dntOps = S.dntOps.filter(o => o.id !== id);
    save(); renderFin(); renderDash(); toast('Удалено');
  });
}

function editDntOp(id) {
  const op = S.dntOps.find(o => o.id === id);
  if (!op) return;
  editOpId = id;
  $('mOpTitle').textContent = 'Редактирование операции';
  $('opKind').value = op.kind;
  $('opDate').value = op.date;
  $('opSum').value = op.amount;
  $('opNote').value = op.note || '';
  $('opKwh').value = op.kwh || '';
  $('opCat').value = op.category || 'other';
  $('opComm').value = op.commission || '';
  onOpKindChange();
  $('mOp').classList.add('on');
}

function openCatHist(pid, cat, year) {
  const p = S.plots.find(x => x.id === pid);
  const catNames = { elec: 'Электроэнергия', dues: 'Взносы', trash: 'Мусор (Росттех)' };
  $('mCatHistTitle').textContent = 'Участок ' + p.num;
  $('mCatHistSub').textContent = catNames[cat] + ' за ' + year + ' год';
  
  let html = '<div class="cat-hist-list">';
  html += '<div class="cat-hist-row cat-hist-head"><span>Месяц</span><span>Начислено</span><span>Оплачено</span><span>Баланс</span></div>';
  
  const nowMonth = getBillingMonth();
  
  for (const m of monthsOfYear(year)) {
    if (m > nowMonth) break;
    let charged = 0;
    if (cat === 'elec') {
      const e = elecForMonth(pid, m);
      if (e) charged = e.charge;
    } else if (cat === 'trash') {
      charged = chargesForMonth(p, m).trash;
    } else if (cat === 'dues') {
      charged = chargesForMonth(p, m).dues;
    }
    const paid = paymentsOn(pid, m, cat);
    const bal = charged - paid;
    
    let balColorClass = 'text-muted';
    if (bal > 0.005) balColorClass = 'text-neg';
    else if (bal < -0.005) balColorClass = 'text-pos';
    
    html += `<div class="cat-hist-row">
      <b>${MN[+m.slice(5,7)-1]}</b>
      <span>${charged ? fmtN(charged) : '—'}</span>
      <span class="text-pos">${paid ? fmtN(paid) : '—'}</span>
      <span class="${balColorClass} fw-600">${Math.abs(bal) > 0.005 ? fmtN(bal) : '0,00'}</span>
    </div>`;
  }
  html += '</div>';
  
  $('mCatHistBody').innerHTML = html;
  $('mCatHist').classList.add('on');
}

function openTargetsList() {
  $('mTargetsTitle').textContent = 'Целевые взносы';
  $('mTargetsSub').textContent = 'Выберите цель для детализации';
  let html = '';
  if (!S.targets.length) {
    html = '<div class="emp">Нет активных целей</div>';
  } else {
    S.targets.forEach(t => {
      const paid = S.payments.filter(p => p.targetId === t.id).reduce((a,p)=>a+parseFloat(p.amount), 0);
      html += `<div class="row clickable-row" onclick="openTargetDetail('${t.id}')">
        <div class="row-t"><b>${esc(t.name)}</b><small>Собрано: ${fmtN(paid)} из ${fmtN(t.total)} ₽</small></div>
        <svg class="ic ic-s text-muted"><use href="#i-down"/></svg>
      </div>`;
    });
  }
  $('mTargetsBody').innerHTML = html;
  $('mTargets').classList.add('on');
}

function openTargetDetail(targetId) {
  const t = S.targets.find(x => x.id === targetId);
  if(!t) return;
  const scope = t.scope || 'all';
  $('mTargetsTitle').textContent = 'Цель: ' + t.name;
  const activePlots = S.plots.filter(p => targetPlotEligible(p, scope));
  const perPlot = activePlots.length ? t.total / activePlots.length : 0;
  $('mTargetsSub').textContent = 'Сумма цели: ' + fmtN(t.total) + ' ₽ · ' + targetScopeName(scope) + ' · ' + activePlots.length + ' участков';
  let html = '';
  if(!activePlots.length) html='<div class="emp">Нет участков, подходящих под условие этой цели</div>';
  activePlots.forEach(p => {
    const paid = S.payments.filter(x => x.targetId === t.id && x.plotId === p.id).reduce((a,x)=>a+parseFloat(x.amount||0), 0);
    const remaining = perPlot - paid;
    let colorClass = 'text-muted';
    if (remaining > 0.005) colorClass = 'text-neg';
    else if (remaining < -0.005) colorClass = 'text-pos';
    html += `<div class="row">
      <span class="text-muted">Участок ${esc(p.num)}</span>
      <div class="flex flex-col items-end">
        <span class="row-v ${colorClass}">${remaining > 0 ? 'Долг ' + fmtN(remaining) : remaining < 0 ? 'Переплата ' + fmtN(-remaining) : 'Оплачено'}</span>
        <small class="fs-11 text-hint">Начислено: ${fmtN(perPlot)} ₽ · Оплачено: ${fmtN(paid)} ₽</small>
      </div>
    </div>`;
  });
  $('mTargetsBody').innerHTML = html;
  $('mTargets').classList.add('on');
}

let finTab='all';
let elecFilter='all';
let duesFilter='all';

function renderFin(){
  const ys=new Set([S.currentDate.slice(0,4)]);
  for(const r of S.readings)ys.add(r.date.slice(0,4));
  for(const p of S.payments)ys.add(p.date.slice(0,4));
  for(const o of S.dntOps)ys.add(o.date.slice(0,4));
  const arr=[...ys].sort().reverse();const sel=$('finYear');const cur=sel.value||arr[0];
  sel.innerHTML=arr.map(x=>`<option ${x===cur?'selected':''}>${x}</option>`).join('');
  const year=sel.value||cur;const b=$('finBody');
  if(finTab==='all')b.innerHTML=finAll(year);
  else if(finTab==='elec')b.innerHTML=finElec(year);
  else if(finTab==='trash')b.innerHTML=finTrash(year);
  else if(finTab==='dues')b.innerHTML=finDues(year);
  else if(finTab==='exp')b.innerHTML=finExp(year);
}

function setElecFilter(val, btn) {
  elecFilter = val;
  document.querySelectorAll('#filterElec button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('finBody').innerHTML = finElec(document.getElementById('finYear').value);
}

function setDuesFilter(val, btn) {
  duesFilter = val;
  document.querySelectorAll('#filterDues button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('finBody').innerHTML = finDues(document.getElementById('finYear').value);
}

function finAll(year){
  const months = monthsOfYear(year).filter(m => m <= getBillingMonth());
  let html = '';
  
  months.forEach(m => {
    let elec = 0, dues = 0, trash = 0, target = 0, otherInc = 0, exp = 0, spentElec = 0, spentTrash = 0;
    
    S.payments.forEach(p => {
      if(p.date.slice(0,7) === m) {
        if(p.cat === 'elec') elec += parseFloat(p.amount);
        else if(p.cat === 'dues') dues += parseFloat(p.amount);
        else if(p.cat === 'trash') trash += parseFloat(p.amount);
        else if(p.cat === 'target') target += parseFloat(p.amount);
        else otherInc += parseFloat(p.amount);
      }
    });
    S.dntOps.forEach(o => {
      if(o.date.slice(0,7) === m) {
        if(o.kind === 'expense') exp += o.amount;
        else if(o.kind === 'elec_pay') spentElec += o.amount + (o.commission||0);
        else if(o.kind === 'trash_pay') spentTrash += o.amount;
        else if(o.kind === 'other_income') otherInc += o.amount;
      }
    });
    
    if(elec || dues || trash || target || exp || otherInc || spentElec || spentTrash) {
      html += `
      <div class="cd month-summary-card" style="margin-bottom: 12px;">
        <div class="month-summary-title" style="font-size:14px; font-weight:600; margin-bottom:10px; color:var(--tx);">${MN_FULL[parseInt(m.slice(5,7))-1]} ${year}</div>
        
        <div class="row"><span class="text-muted">Электро: собрано</span><span class="row-v text-pos">+${fmtN(elec)} ₽</span></div>
        <div class="row"><span class="text-muted">Электро: потрачено</span><span class="row-v text-neg">−${fmtN(spentElec)} ₽</span></div>
        <div class="row fw-500"><span class="text-main">Электро: итог</span><span class="row-v ${(elec-spentElec)<0?'text-neg':'text-pos'}">${fmtN(elec-spentElec)} ₽</span></div>
        
        <div class="row mt-8"><span class="text-muted">Взносы: собрано</span><span class="row-v text-pos">+${fmtN(dues)} ₽</span></div>
        <div class="row"><span class="text-muted">Взносы: потрачено</span><span class="row-v text-neg">−${fmtN(exp)} ₽</span></div>
        <div class="row fw-500"><span class="text-main">Взносы: итог</span><span class="row-v ${(dues-exp)<0?'text-neg':'text-pos'}">${fmtN(dues-exp)} ₽</span></div>
        
        <div class="row mt-8"><span class="text-muted">Мусор: собрано</span><span class="row-v text-pos">+${fmtN(trash)} ₽</span></div>
        <div class="row"><span class="text-muted">Мусор: потрачено</span><span class="row-v text-neg">−${fmtN(spentTrash)} ₽</span></div>
        <div class="row fw-500"><span class="text-main">Мусор: итог</span><span class="row-v ${(trash-spentTrash)<0?'text-neg':'text-pos'}">${fmtN(trash-spentTrash)} ₽</span></div>
        
        <div class="row mt-8"><span class="text-muted">Целевые: собрано</span><span class="row-v text-pos">+${fmtN(target)} ₽</span></div>
        
        ${otherInc ? `<div class="row mt-8"><span class="text-muted">Прочие приходы</span><span class="row-v text-pos">+${fmtN(otherInc)} ₽</span></div>` : ''}
      </div>`;
    }
  });
  return html || '<div class="emp">Нет данных за этот год</div>';
}

function finElec(year){
  const mSelected = getBillingMonth();
  const elecMonths = monthsOfYear(year).filter(m => m <= getBillingMonth());
  if(!elecMonths.includes(mSelected)) return `<div class="emp">Выбранный месяц еще не наступил</div>`;

  let totKwh=0, totCharge=0, paidMonth=0;
  for (const p of S.plots) {
    const e = elecForMonth(p.id, mSelected);
    if(e){ totKwh += e.consumption; totCharge += e.charge; }
    paidMonth += paymentsOn(p.id, mSelected, 'elec');
  }
  
  const ops = S.dntOps.filter(o => o.date.slice(0,4) === year && o.kind === 'elec_pay').sort((a,b) => b.date.localeCompare(a.date));
  
    const monthSpentElec = ops.filter(o => o.date.slice(0,7) === mSelected).reduce((a,o)=>a+o.amount+(o.commission||0), 0);
    const bal = paidMonth - monthSpentElec;

  let tableHtml = `
    <div class="sec"><div class="sec-t">Балансы участков (Электро)</div></div>
    <div class="filter-tabs" id="filterElec">
      <button class="${elecFilter==='all'?'on':''}" onclick="setElecFilter('all', this)">Все</button>
      <button class="${elecFilter==='on'?'on':''}" onclick="setElecFilter('on', this)">Со светом</button>
      <button class="${elecFilter==='off'?'on':''}" onclick="setElecFilter('off', this)">Без света</button>
    </div>
    <div class="table-wrap">
      <table class="table-fin">
        <thead><tr>
          <th class="th-plot">Участок</th>
          <th class="th-bal">Баланс</th>
        </tr></thead><tbody>
  `;
  for (const p of S.plots) {
    if (elecFilter === 'on' && p.hasElec === false) continue;
    if (elecFilter === 'off' && p.hasElec !== false) continue;
    const b = getCategoryBalance(p.id, year, 'elec');
    let colorClass = 'text-muted';
    if (b > 0.005) colorClass = 'text-neg';
    else if (b < -0.005) colorClass = 'text-pos';
    tableHtml += `
      <tr class="clickable-row" onclick="openCatHist('${p.id}', 'elec', '${year}')">
        <td class="td-plot">${esc(p.num)}</td>
        <td class="td-bal ${colorClass}">${fmtN(b)} ₽</td>
      </tr>`;
  }
  tableHtml += '</tbody></table></div>';

  let opsHist = '';
  if (ops.length > 0) {
    const hasExtra = ops.length > 2;
    let opsHtml = '';
    ops.forEach((o, idx) => {
      const name = 'Оплата в Красэнерго';
      const hiddenClass = idx >= 2 ? 'hidden extra-op-item' : '';
            opsHtml += `<div class="ops-item ${hiddenClass}">
        <div class="ops-info">
          <b>${fmtD(o.date)}</b>
          <small>${name}${o.note ? ' · '+esc(o.note) : ''}</small>
        </div>
        <div class="ops-action" style="flex-direction: column; align-items: flex-end;">
          <span class="row-v clickable-val text-neg" onclick="editDntOp('${o.id}')">−${fmtN(o.amount)} ₽</span>
          ${o.commission ? `<small class="fs-10 text-muted">комиссия ${fmtN(o.commission)} ₽</small>` : ''}
        </div>
      </div>`;
    });

    opsHist = `
    <div class="sec"><div class="sec-t">Оплаты в Красэнерго</div></div>
    <div class="ops-list-wrap">
      <div class="ops-list">
        ${opsHtml}
      </div>
      ${hasExtra ? `<button class="ops-expand-btn" onclick="toggleOps(this)"><span>Показать все</span><svg class="ic"><use href="#i-down"/></svg></button>` : ''}
    </div>`;
  }

  return `
  <div class="stat-g fin-stat-top">
    <div class="st st-hero ${bal<0?'neg':bal>0?'pos':''}"><div class="st-lbl">Остаток по электроэнергии</div><div class="st-num">${fmtN(bal)} ₽</div><div class="st-sub">Собрано с жителей − оплачено в Красэнерго (с комиссией)</div></div>
  </div>
  <div class="sec"><div class="sec-t">Начислено жителям за ${MN_FULL[+mSelected.slice(5,7)-1]}</div></div>
  <div class="cd">
    <div class="row">
      <div class="row-t">
        <span class="text-muted">По показаниям</span>
        <small class="text-hint fs-11">(${fmtKwh(totKwh)} кВт·ч)</small>
      </div>
      <span class="row-v">${fmtN(totCharge)} ₽</span>
    </div>
    <div class="row">
      <div class="row-t">
        <span class="text-muted">Собрано с жителей</span>
      </div>
      <span class="row-v text-pos">+${fmtN(paidMonth)} ₽</span>
    </div>
  </div>
  ${opsHist}
  ${tableHtml}
    <div class="fin-btn-wrap">
    <button class="btn btn-s btn-full mb-12" onclick="showAllPayments('elec')"><svg class="ic ic-s"><use href="#i-clock"/></svg>Показать все операции</button>
    <button class="btn btn-p btn-full" onclick="openOp('elec_pay')"><svg class="ic ic-s"><use href="#i-plus"/></svg>Записать оплату в Красэнерго</button>
  </div>`;
}

function finTrash(year){
  const mSelected = getBillingMonth();
  const elecMonths = monthsOfYear(year).filter(m => m <= getBillingMonth());
  if(!elecMonths.includes(mSelected)) return `<div class="emp">Выбранный месяц еще не наступил</div>`;

  let ch=0, pd=0;
  for (const p of S.plots) {
    ch += chargesForMonth(p, mSelected).trash;
    pd += paymentsOn(p.id, mSelected, 'trash');
  }
  
  const ops = S.dntOps.filter(o => o.date.slice(0,4) === year && o.kind === 'trash_pay').sort((a,b) => b.date.localeCompare(a.date));
  const monthSpentTrash = ops.filter(o => o.date.slice(0,7) === mSelected).reduce((a,o)=>a+o.amount, 0);
  const bal = pd - monthSpentTrash;

  let tableHtml = `
    <div class="sec"><div class="sec-t">Балансы участков (Мусор - Росттех)</div></div>
    <div class="table-wrap">
      <table class="table-fin">
        <thead><tr>
          <th class="th-plot">Участок</th>
          <th class="th-bal">Баланс</th>
        </tr></thead><tbody>
  `;
  for (const p of S.plots) {
    if (p.trash === 'none') continue;
    const b = getCategoryBalance(p.id, year, 'trash');
    let colorClass = 'text-muted';
    if (b > 0.005) colorClass = 'text-neg';
    else if (b < -0.005) colorClass = 'text-pos';
    tableHtml += `
      <tr class="clickable-row" onclick="openCatHist('${p.id}', 'trash', '${year}')">
        <td class="td-plot">${esc(p.num)}</td>
        <td class="td-bal ${colorClass}">${fmtN(b)} ₽</td>
      </tr>`;
  }
  tableHtml += '</tbody></table></div>';

  let opsHist = '';
  if (ops.length > 0) {
    const hasExtra = ops.length > 2;
    let opsHtml = '';
    ops.forEach((o, idx) => {
      const name = 'Оплата Росттех';
      const hiddenClass = idx >= 2 ? 'hidden extra-op-item' : '';
      opsHtml += `<div class="ops-item ${hiddenClass}">
        <div class="ops-info">
          <b>${fmtD(o.date)}</b>
          <small>${name}${o.note ? ' · '+esc(o.note) : ''}</small>
        </div>
        <div class="ops-action">
          <span class="row-v clickable-val text-neg" onclick="editDntOp('${o.id}')">−${fmtN(o.amount)} ₽</span>
          <button class="hist-del" onclick="deleteDntOp('${o.id}')"><svg class="ic ic-s"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    });

    opsHist = `
    <div class="sec"><div class="sec-t">Оплаты Росттех</div></div>
    <div class="ops-list-wrap">
      <div class="ops-list">
        ${opsHtml}
      </div>
      ${hasExtra ? `<button class="ops-expand-btn" onclick="toggleOps(this)"><span>Показать все</span><svg class="ic"><use href="#i-down"/></svg></button>` : ''}
    </div>`;
  }

  return `
  <div class="stat-g fin-stat-top"><div class="st st-hero ${bal<0?'neg':bal>0?'pos':''}"><div class="st-lbl">Остаток по мусору</div><div class="st-num">${fmtN(bal)} ₽</div><div class="st-sub">Собрано с жителей − оплачено Росттех</div></div></div>
  <div class="sec"><div class="sec-t">Начислено за ${MN_FULL[+mSelected.slice(5,7)-1]}</div></div>
  <div class="cd">
    <div class="row">
      <div class="row-t">
        <span class="text-muted">Начислено жителям</span>
      </div>
      <span class="row-v">${fmtN(ch)} ₽</span>
    </div>
    <div class="row">
      <div class="row-t">
        <span class="text-muted">Собрано с жителей</span>
      </div>
      <span class="row-v text-pos">+${fmtN(pd)} ₽</span>
    </div>
  </div>
  ${opsHist}
  ${tableHtml}
    <div class="fin-btn-wrap">
    <button class="btn btn-s btn-full mb-12" onclick="showAllPayments('trash')"><svg class="ic ic-s"><use href="#i-clock"/></svg>Показать все операции</button>
    <button class="btn btn-p btn-full" onclick="openOp('trash_pay')"><svg class="ic ic-s"><use href="#i-plus"/></svg>Записать оплату Росттех</button>
  </div>`;
}

function finDues(year){
  const months=monthsOfYear(year).filter(m=>m<=getBillingMonth());
  let ch=0,pd=0;
  for(const m of months)for(const p of S.plots){const c=chargesForMonth(p,m);ch+=c.dues;pd+=paymentsOn(p.id,m,'dues')}
  
  const common=S.payments.filter(p=>p.date.slice(0,4)===year&&(!p.cat||p.cat==='dues')).reduce((a,p)=>a+parseFloat(p.amount),0);
  const target=S.payments.filter(p=>p.date.slice(0,4)===year&&p.cat==='target').reduce((a,p)=>a+parseFloat(p.amount),0);
  const bal=common-ch;

  let tableHtml = `
    <div class="sec"><div class="sec-t">Балансы участков (Взносы)</div></div>
    <div class="filter-tabs" id="filterDues">
      <button class="${duesFilter==='all'?'on':''}" onclick="setDuesFilter('all', this)">Все</button>
      <button class="${duesFilter==='dachnik'?'on':''}" onclick="setDuesFilter('dachnik', this)">Дачники</button>
      <button class="${duesFilter==='permanent'?'on':''}" onclick="setDuesFilter('permanent', this)">ПМЖ</button>
    </div>
    <div class="table-wrap">
      <table class="table-fin">
        <thead><tr>
          <th class="th-plot">Участок</th>
          <th class="th-bal">Баланс</th>
        </tr></thead><tbody>
  `;
  let targetTableHtml = `
  <div class="sec">
    <div class="sec-t">Балансы участков (Целевые взносы)</div>
  </div>

  <div class="filter-tabs">
    <button class="${duesFilter==='all'?'on':''}"
      onclick="setDuesFilter('all', this)">Все</button>
    <button class="${duesFilter==='dachnik'?'on':''}"
      onclick="setDuesFilter('dachnik', this)">Дачники</button>
    <button class="${duesFilter==='permanent'?'on':''}"
      onclick="setDuesFilter('permanent', this)">ПМЖ</button>
  </div>

  <div class="table-wrap">
    <table class="table-fin">
      <thead>
        <tr>
          <th class="th-plot">Участок</th>
          <th class="th-bal">Баланс</th>
        </tr>
      </thead>
      <tbody>
`;

for (const p of S.plots) {
  if (duesFilter === 'dachnik' && p.owner !== 'dachnik') continue;
  if (duesFilter === 'permanent' && p.owner !== 'permanent') continue;

  const b = targetPlotDebt(p.id);

  let colorClass = 'text-muted';
  if (b > 0.005) colorClass = 'text-neg';
  else if (b < -0.005) colorClass = 'text-pos';

  targetTableHtml += `
    <tr class="clickable-row"
        onclick="openHist('${p.id}')">
      <td class="td-plot">${esc(p.num)}</td>
      <td class="td-bal ${colorClass}">${fmtN(b)} ₽</td>
    </tr>
  `;
}

targetTableHtml += `
      </tbody>
    </table>
  </div>
`;
  for (const p of S.plots) {
    if (duesFilter === 'dachnik' && p.owner !== 'dachnik') continue;
    if (duesFilter === 'permanent' && p.owner !== 'permanent') continue;
    const b = getCategoryBalance(p.id, year, 'dues');
    let colorClass = 'text-muted';
    if (b > 0.005) colorClass = 'text-neg';
    else if (b < -0.005) colorClass = 'text-pos';
    tableHtml += `
      <tr class="clickable-row" onclick="openCatHist('${p.id}', 'dues', '${year}')">
        <td class="td-plot">${esc(p.num)}</td>
        <td class="td-bal ${colorClass}">${fmtN(b)} ₽</td>
      </tr>`;
  }
  tableHtml += '</tbody></table></div>';

  return `
  <div class="stat-g fin-stat-top"><div class="st st-hero ${bal<0?'neg':bal>0?'pos':''}"><div class="st-lbl">Взносы: баланс за год</div><div class="st-num">${fmtN(bal)} ₽</div><div class="st-sub">Поступило взносов − начислено</div></div></div>
  <div class="cd">
    <div class="row"><span class="text-muted">Начислено за год</span><span class="row-v">${fmtN(ch)} ₽</span></div>
    <div class="row row-wrap">
      <div class="row-t"><span class="text-muted">Поступило взносов</span></div>
      <span class="row-v text-pos">+${fmtN(common)} ₽</span>
    </div>
    <div class="row row-wrap">
      <div class="row-t"><span class="text-muted">Целевые взносы</span></div>
      <span class="row-v text-pos clickable-val" onclick="openTargetsList()">+${fmtN(target)} ₽</span>
    </div>
  </div>
  <div class="info cool fin-info"><svg class="ic"><use href="#i-info"/></svg><div>Дачники платят май–октябрь, ПМЖ — весь год. Целевые взносы идут на конкретные нужды и не уменьшают долг по обычным взносам.</div></div>
  ${tableHtml}
  ${targetTableHtml}
    <div class="fin-btn-wrap">
    <button class="btn btn-s btn-full" onclick="showAllPayments('dues')"><svg class="ic ic-s"><use href="#i-clock"/></svg>Показать все операции</button>
  </div>`;
}

function finExp(year){
  const ops=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='expense').sort((a,b)=>b.date.localeCompare(a.date));
  const catName={road:'Ремонт дорог',light:'Освещение',snow:'Чистка снега',salary:'Зарплата',repair:'Ремонт / материалы',bank:'Банк / связь',tax:'Налоги',other:'Прочее'};
  const catIcon={road:'i-road',light:'i-light',snow:'i-snow',salary:'i-user',repair:'i-repair',bank:'i-bank',tax:'i-tax',other:'i-box'};
  const total=ops.reduce((a,o)=>a+o.amount,0);
  const byCat={};for(const o of ops)byCat[o.category||'other']=(byCat[o.category||'other']||0)+o.amount;
  let cardsHtml='';
  for(const c of ['road','light','snow','salary','repair','bank','tax','other']){if(byCat[c])cardsHtml+=`<div class="exp-c"><svg class="ic"><use href="#${catIcon[c]}"/></svg><div class="v">${fmtN(byCat[c])} ₽</div><div>${catName[c]}</div></div>`}
  
  let opsHist = '';
  if (ops.length > 0) {
    const hasExtra = ops.length > 2;
    let opsHtml = '';
    ops.forEach((o, idx) => {
      const hiddenClass = idx >= 2 ? 'hidden extra-op-item' : '';
      opsHtml += `<div class="ops-item ${hiddenClass}">
        <div class="ops-info">
          <b>${catName[o.category] || 'Прочее'} · ${fmtD(o.date)}</b>
          ${o.note ? `<small>${esc(o.note)}</small>` : ''}
        </div>
        <div class="ops-action">
          <span class="row-v clickable-val text-neg" onclick="editDntOp('${o.id}')">−${fmtN(o.amount)} ₽</span>
          <button class="hist-del" onclick="deleteDntOp('${o.id}')"><svg class="ic ic-s"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    });

    opsHist = `
    <div class="sec"><div class="sec-t">История операций</div></div>
    <div class="ops-list-wrap">
      <div class="ops-list">
        ${opsHtml}
      </div>
      ${hasExtra ? `<button class="ops-expand-btn" onclick="toggleOps(this)"><span>Показать все</span><svg class="ic"><use href="#i-down"/></svg></button>` : ''}
    </div>`;
  }

  return `
  <div class="stat-g fin-stat-top"><div class="st st-hero neg"><div class="st-lbl">Общие расходы за ${year}</div><div class="st-num">${fmtN(total)} ₽</div><div class="st-sub">Ремонт, освещение, снег, зарплата и прочее</div></div></div>
  ${cardsHtml?`<div class="sec"><div class="sec-t">По категориям</div></div><div class="exp-cards-wrap"><div class="exp-g">${cardsHtml}</div></div>`:''}
  ${opsHist}
    <div class="fin-btn-wrap">
    <button class="btn btn-s btn-full mb-12" onclick="showAllPayments('exp')"><svg class="ic ic-s"><use href="#i-clock"/></svg>Показать все операции</button>
    <button class="btn btn-p btn-full" onclick="openOp('expense')"><svg class="ic ic-s"><use href="#i-plus"/></svg>Добавить расход</button>
  </div>`;
}

function openOp(initial){
  editOpId = null;
  $('mOpTitle').textContent = 'Операция ДНТ';
  $('opKind').value=initial||'elec_pay';
  $('opDate').value=todayISO();$('opSum').value='';$('opKwh').value='';$('opNote').value='';$('opComm').value='';
  onOpKindChange();$('mOp').classList.add('on');
}
function onOpKindChange(){
  const k=$('opKind').value;
  $('opKwhFld').classList.toggle('hidden', k!=='elec_pay');
  $('opCatFld').classList.toggle('hidden', k!=='expense');
  $('opCommFld').classList.toggle('hidden', k!=='elec_pay');
  if(k==='elec_pay' && !editOpId){const last=S.dntOps.filter(o=>o.kind==='elec_pay').sort((a,b)=>b.date.localeCompare(a.date))[0];if(last){$('opSum').value=last.amount;$('opComm').value=(last.amount*0.01).toFixed(2)}}
}
$('opSum').addEventListener('input',()=>{if($('opKind').value==='elec_pay'){const v=parseFloat($('opSum').value)||0;$('opComm').value=(v*0.01).toFixed(2)}});
function saveOp(){
  const kind=$('opKind').value;const date=$('opDate').value||todayISO();const amount=parseFloat($('opSum').value);
  if(!amount||amount<=0){toast('Введите сумму');return}
  
  if(editOpId) {
    const op = S.dntOps.find(o => o.id === editOpId);
    if(op) {
      op.kind = kind;
      op.date = date;
      op.amount = amount;
      op.note = $('opNote').value;
      if(kind==='elec_pay')op.kwh=parseFloat($('opKwh').value)||0;
      if(kind==='expense')op.category=$('opCat').value;
      if(kind==='elec_pay')op.commission=parseFloat($('opComm').value)||amount*0.01;
    }
    toast('Операция обновлена');
  } else {
    const op={id:uid(),kind,date,amount,note:$('opNote').value};
    if(kind==='elec_pay')op.kwh=parseFloat($('opKwh').value)||0;
    if(kind==='expense')op.category=$('opCat').value;
    if(kind==='elec_pay')op.commission=parseFloat($('opComm').value)||amount*0.01;
    S.dntOps.push(op);
    toast('Записано');
  }
  
  save();
  $('mOp').classList.remove('on');
  renderFin();renderDash();
  editOpId = null;
}

// --- РЕЗЕРВНЫЕ КОПИИ ---
function fileSave(){
  const blob=new Blob([JSON.stringify(S,null,1)],{type:'application/json'});
  const f=new File([blob],'dnt_backup_'+todayISO()+'.json',{type:'application/json'});
  (async()=>{
    if(navigator.canShare&&navigator.canShare({files:[f]})){try{await navigator.share({files:[f]});return}catch(e){if(e.name==='AbortError')return}}
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=f.name;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Файл сохранён');
  })();
}
function fileLoad(f){
  const r=new FileReader();
  r.onload=e=>{try{const d=JSON.parse(e.target.result);if(!d.plots)throw new Error('Неверный формат');askConfirm('Заменить данные?','Локальные и облачные данные будут заменены данными из файла.',()=>{S=d;save();boot();toast('Загружено из файла')})}catch(err){alert(err.message)}};
  r.readAsText(f);
}

function exportFin(){
  const year=$('finYear').value||S.currentDate.slice(0,4);
  let csv=`ДНТ Ермолаевское-2 — отчёт за ${year}\r\n\r\nЭЛЕКТРОЭНЕРГИЯ\r\n`;
  let tK=0,tCh=0,tPd=0;
  for(const m of monthsOfYear(year).filter(m=>m<=getBillingMonth()))for(const p of S.plots){const e=elecForMonth(p.id,m);if(e){tK+=e.consumption;tCh+=e.charge}tPd+=paymentsOn(p.id,m,'elec')}
  const bK=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='elec_pay').reduce((a,o)=>a+(o.kwh||0),0);
  const bR=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='elec_pay').reduce((a,o)=>a+o.amount,0);
  const pR=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='elec_pay').reduce((a,o)=>a+o.amount,0);
  const cR=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='elec_pay').reduce((a,o)=>a+(o.commission||0),0);
  csv+=`кВт·ч по счётчикам;${Math.round(tK)}\r\nНачислено жителям;${fmtN(tCh)}\r\nСобрано;${fmtN(tPd)}\r\n`;
  csv+=`Красэнерго кВт·ч;${Math.round(bK)}\r\nКрасэнерго сумма;${fmtN(bR)}\r\nОплачено;${fmtN(pR)}\r\nКомиссия 1%;${fmtN(cR)}\r\n`;
  const loss=bK>0&&tK>0?((bK-tK)/tK*100).toFixed(2):'—';
  csv+=`Потери %;${loss}\r\nОстаток;${fmtN(tPd-pR-cR)}\r\n\r\nМУСОР\r\n`;
  let c2=0,p2=0;
  for(const m of monthsOfYear(year).filter(m=>m<=getBillingMonth()))for(const p of S.plots){const c=chargesForMonth(p,m);c2+=c.trash;p2+=paymentsOn(p.id,m,'trash')}
  const tb=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='trash_pay').reduce((a,o)=>a+o.amount,0);
  const tp=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='trash_pay').reduce((a,o)=>a+o.amount,0);
  csv+=`Начислено;${fmtN(c2)}\r\nСобрано;${fmtN(p2)}\r\nРосттех выставил;${fmtN(tb)}\r\nОплачено;${fmtN(tp)}\r\nОстаток;${fmtN(p2-tp)}\r\n\r\nОБЩИЕ РАСХОДЫ\r\n`;
  const catName={road:'Ремонт дорог',light:'Освещение',snow:'Чистка снега',salary:'Зарплата',repair:'Ремонт/материалы',bank:'Банк/связь',tax:'Налоги',other:'Прочее'};
  const exp=S.dntOps.filter(o=>o.date.slice(0,4)===year&&o.kind==='expense');
  for(const o of exp)csv+=`${fmtD(o.date)};${catName[o.category]||'Прочее'};${fmtN(o.amount)};${o.note||''}\r\n`;
  csv+=`Итого расходов;${fmtN(exp.reduce((a,o)=>a+o.amount,0))}\r\n\r\nЦЕЛЕВЫЕ ВЗНОСЫ\r\n`;
  const target=S.payments.filter(p=>p.date.slice(0,4)===year&&p.cat==='target');
  for(const p of target) {
    const plot = S.plots.find(x => x.id === p.plotId);
    csv+=`${fmtD(p.date)};Участок ${plot?plot.num:'?'};${fmtN(p.amount)};${p.note||''}\r\n`;
  }
  csv+=`Итого целевых;${fmtN(target.reduce((a,p)=>a+parseFloat(p.amount),0))}\r\n`;
  
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const f=new File([blob],`ДНТ_${year}.csv`,{type:'text/csv'});
  (async()=>{
    if(navigator.canShare&&navigator.canShare({files:[f]})){try{await navigator.share({files:[f]});return}catch(e){if(e.name==='AbortError')return}}
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=f.name;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(url),1500);
  })();
}

function switchSc(id){
  document.querySelectorAll('.sc').forEach(s=>s.classList.toggle('on',s.id===id));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('on',b.dataset.sc===id));
  if(id==='sc-dash')renderDash();
  if(id==='sc-list')renderList();
  if(id==='sc-map')renderMap(); 
  if(id==='sc-fin')renderFin();
  if(id==='sc-set'){
    renderPlotList();renderTariffs();renderTargets();
    $('openingBal').value=S.openingBalance||0;
    $('chkBillCurrent').checked = S.billCurrentMonth === true;
  }
}

// --- СТАРТ ПРИЛОЖЕНИЯ ---
async function boot(){
  const localData = load();
  if (localData) S = localData;
  if (!Array.isArray(S.targets)) S.targets = [];
  if (!Array.isArray(S.plots)) S.plots = [];
  if (!Array.isArray(S.readings)) S.readings = [];
  if (!Array.isArray(S.payments)) S.payments = [];
  if (!Array.isArray(S.dntOps)) S.dntOps = [];
  if (!S.tariffs) S.tariffs = {elec:[],dues:[],trash:[]};
  if (!Array.isArray(S.tariffs.elec)) S.tariffs.elec = [];
  if (!Array.isArray(S.tariffs.dues)) S.tariffs.dues = [];
  if (!Array.isArray(S.tariffs.trash)) S.tariffs.trash = [];
  $('mLogin').classList.remove('on');
  $('dt').value = S.currentDate || todayISO();
  renderList();
  renderDash();
}

$('btnLogin').onclick = () => toast('Автономная версия: вход на сервер отключён');

document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>switchSc(b.dataset.sc));
$('dt').onchange=e=>{
  S.currentDate=e.target.value||todayISO();
  save();
  renderList();
  renderDash();
  if($('sc-fin').classList.contains('on')) renderFin();
};
$('search').oninput=renderList;
$('searchReg').oninput=renderRegistryList;
document.querySelectorAll('#mEntry .tabs-i button').forEach(b=>b.onclick=()=>{entry.mode=b.dataset.m;syncEntryTabs();updateEntryInfo()});
document.querySelectorAll('.k[data-k]').forEach(b=>b.onclick=()=>pressK(b.dataset.k));
$('btnClr').onclick=()=>{entry.value='';updateDisp()};
$('btnSv').onclick=saveEntry;
$('btnHist').onclick=()=>{if(entry.plotId){$('mEntry').classList.remove('on');openHist(entry.plotId)}};
$('btnPay').onclick=()=>{if(entry.plotId){$('mEntry').classList.remove('on');openPay(entry.plotId)}};
$('btnPayC').onclick=()=>{$('mPay').classList.remove('on'); editPayIdx = null;};
$('btnPayS').onclick=savePay;
$('btnHistC').onclick=()=>$('mHist').classList.remove('on');
$('btnAddPlot').onclick=()=>{const n=$('newPlotNum').value.trim();if(!n)return;S.plots.push({id:uid(),num:n,owner:'dachnik',trash:'full',hasElec:true});$('newPlotNum').value='';save();renderPlotList();renderList();toast('Участок добавлен')};
$('btnAddTarget').onclick=()=>{
  const n=$('newTargetName').value.trim();
  const sum=parseFloat($('newTargetSum').value);
  if(!n||!sum) { toast('Заполните название и сумму'); return; }
  const scope=$('newTargetScope') ? $('newTargetScope').value : 'all';
  S.targets.push({id:uid(), name:n, total:sum, date:todayISO(), scope});
  $('newTargetName').value=''; $('newTargetSum').value='';
  save(); renderTargets(); toast('Цель добавлена');
};
$('btnPlS').onclick=()=>{
  if(editIdx<0)return;
  const p=S.plots[editIdx];
  p.num=$('plNum').value.trim()||p.num;
  p.fullName=$('plFullName').value.trim();
  p.cadastral=$('plCadastral').value.trim();
  p.rightDoc=$('plRightDoc').value.trim();
  p.rightDate=$('plRightDate').value;
  p.area=parseFloat($('plArea').value)||0;
  p.linked=$('plLinked').value.trim();
  p.phone=$('plPhone').value.trim();
  p.email=$('plEmail').value.trim();
  p.tg=$('plTg').value.trim();
  p.max=$('plMax').value.trim();
  
  p.owner=$('plOwner').value;
  p.trash=$('plTrash').value;
  p.note=$('plNote').value;
  p.debtElec=parseFloat($('plDebtElec').value)||0;
  p.debtDues=parseFloat($('plDebtDues').value)||0;
  p.debtTrash=parseFloat($('plDebtTrash').value)||0;
  p.hasElec = $('plHasElec').checked;
  
  save();
  $('mPlot').classList.remove('on');
  renderPlotList();
  renderList();
  renderMap(); 
};
$('btnPlDel').onclick=()=>{if(editIdx<0)return;const id=S.plots[editIdx].id;const num=S.plots[editIdx].num;askConfirm('Удалить участок '+num+'?','Все показания и оплаты по этому участку будут удалены.',()=>{S.plots.splice(editIdx,1);S.readings=S.readings.filter(r=>r.plotId!==id);S.payments=S.payments.filter(p=>p.plotId!==id);save();$('mPlot').classList.remove('on');renderPlotList();renderList();toast('Участок удалён')})};
$('btnFinExport').onclick=exportFin;
$('btnFinAdd').onclick=()=>openOp();
$('finYear').onchange=renderFin;
document.querySelectorAll('#finTabs button').forEach(b=>b.onclick=()=>{finTab=b.dataset.t;document.querySelectorAll('#finTabs button').forEach(x=>x.classList.toggle('on',x===b));renderFin()});
$('opKind').onchange=onOpKindChange;
$('btnOpC').onclick=()=>{$('mOp').classList.remove('on'); editOpId = null;};
$('btnOpS').onclick=saveOp;
$('btnSaveFile').onclick=fileSave;
$('btnLoadFile').onclick=()=>$('loadFile').click();
$('loadFile').onchange=e=>{if(e.target.files[0])fileLoad(e.target.files[0]);e.target.value=''};
$('btnSaveOpening').onclick=()=>{S.openingBalance=parseFloat($('openingBal').value)||0;save();renderDash();toast('Сохранено')};
document.querySelectorAll('.mdl').forEach(m=>m.onclick=e=>{if(e.target===m&&m.id!=='mConfirm'&&m.id!=='mLogin')m.classList.remove('on')});

$('chkBillCurrent').onchange = (e) => {
  S.billCurrentMonth = e.target.checked;
  save();
  renderList();
  renderDash();
  toast('Правило начислений изменено');
  if($('sc-fin').classList.contains('on')) renderFin();
};

function toggleCalc(el) {
  const block = el.parentElement;
  block.classList.toggle('open');
}

function toggleSec(el) {
  const body = document.getElementById('sec-' + el.dataset.sec + '-body');
  if (body) {
    body.classList.toggle('hidden');
    el.classList.toggle('collapsed');
  }
}

boot(); 
switchSc('sc-dash');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
