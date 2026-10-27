// Staff view. data/staff-vault.json is AES-256-CBC + HMAC-SHA256 with keys from PBKDF2(password) — same format as 우마이펄스.
(()=>{
const $=s=>document.querySelector(s);
const enc=new TextEncoder(),b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SS='woomytrack-pw';
async function open(pw){
  const v=await (await fetch('data/staff-vault.json',{cache:'no-store'})).json();
  const base=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:b64(v.salt),iterations:v.iter},base,512));
  const iv=b64(v.iv),ct=b64(v.ct),msg=new Uint8Array(iv.length+ct.length);msg.set(iv);msg.set(ct,iv.length);
  const mk=await crypto.subtle.importKey('raw',bits.slice(32),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',mk,b64(v.mac),msg))throw Error('wrong');
  const ak=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-CBC',false,['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-CBC',iv},ak,ct)));
}
const TRACK={'CJ대한통운':n=>`https://trace.cjlogistics.com/next/tracking.html?wblNo=${encodeURIComponent(n)}`};
const md=s=>s?s.slice(5).replace('-','/'):'—';
let D=null;
function row(o){
  const link=TRACK[o.courier];
  const no=o.courierNo?(link?`<a href="${link(o.courierNo)}" target="_blank" rel="noopener">${esc(o.courierNo)}</a>`:esc(o.courierNo)):'—';
  return `<tr><td class="num">${esc(o.order)}</td><td>${esc(o.name)}<div class="small muted">${esc(o.item)}</div></td>
  <td><span class="pill s${o.stage}">${esc(D.stages[o.stage])}</span><div class="small muted">ERP: ${esc(o.erp)}</div></td>
  <td class="num">${md(o.orderDate)} · ${md(o.obDate)} · ${md(o.arDate)}${o.sinceArrival!=null&&o.stage<3?`<div class="small muted">도착 ${o.sinceArrival}일째</div>`:''}</td>
  <td class="num">${esc(o.courier||'미정')}<div class="small">${no}</div></td>
  <td>${o.alerts.map(a=>`<div class="alertline">${esc(a)}</div>`).join('')||'<span class="muted small">—</span>'}</td></tr>`;
}
const HEAD='<thead><tr><th>주문번호</th><th>받는 분 · 상품</th><th>단계</th><th>주문 · 출항 · 도착</th><th>택배</th><th>확인할 점</th></tr></thead>';
function renderList(){
  const q=$('#q').value.trim().toLowerCase(),st=$('#stage').value,fl=$('#flag').value;
  const list=D.orders.filter(o=>(!st||String(o.stage)===st)&&(!fl||(fl==='alert'?o.alerts.length:o.flags.includes(fl)))&&
    (!q||[o.order,o.hbl,o.courierNo,o.item,o.name].some(v=>String(v||'').toLowerCase().includes(q))));
  $('#count').textContent=`${list.length.toLocaleString()}건${list.length>300?' · 처음 300건만 표시 (검색으로 좁혀 보세요)':''}`;
  $('#orders').innerHTML=HEAD+'<tbody>'+list.slice(0,300).map(row).join('')+'</tbody>';
}
function render(){
  $('#updated').textContent=`· ${new Date(D.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 · 최근 ${D.range[0]} ~ ${D.range[1]} 주문`;
  $('#kpis').innerHTML=D.stages.map(s=>`<div class="kpi"><span>${esc(s)}</span><b>${(D.summary[s]||0).toLocaleString()}</b></div>`).join('')+
    `<div class="kpi alert"><span>확인 필요</span><b>${D.alerts.toLocaleString()}</b></div>`;
  const t=D.thresholds;
  $('#rules').textContent=`기준: 부산 도착 ${t.late}일 이상 미완료, ${t.stuck}일 이상은 ERP 반영 누락 가능, 주문 ${t.notShipped}일 이상 출항 전, 세관 검사·선별 대상`;
  const al=D.orders.filter(o=>o.alerts.length);$('#alertCount').textContent=`${al.length}건`;
  $('#alerts').innerHTML=HEAD+'<tbody>'+al.map(row).join('')+'</tbody>';
  $('#batches').innerHTML='<thead><tr><th>주문일</th>'+D.stages.map(s=>`<th>${esc(s)}</th>`).join('')+'<th>합계</th></tr></thead><tbody>'+
    D.batches.map(b=>`<tr><td class="num">${esc(b.orderDate)}</td>${D.stages.map(s=>`<td class="num">${b[s]||''}</td>`).join('')}<td class="num">${D.stages.reduce((a,s)=>a+(b[s]||0),0)}</td></tr>`).join('')+'</tbody>';
  $('#stage').innerHTML='<option value="">전체 단계</option>'+D.stages.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('');
  renderList();
}
async function unlock(pw){D=await open(pw);try{sessionStorage.setItem(SS,pw)}catch{}$('#gate').remove();$('#app').classList.remove('hidden');render()}
$('#gateForm').onsubmit=async e=>{e.preventDefault();const b=$('#pwBtn');b.disabled=true;b.textContent='확인 중…';$('#pwErr').textContent='';
  try{await unlock($('#pw').value)}catch{$('#pwErr').textContent='비밀번호가 맞지 않거나 데이터를 불러오지 못했어요.'}finally{b.disabled=false;b.textContent='들어가기'}};
['#q','#stage','#flag'].forEach(s=>$(s).addEventListener('input',renderList));
try{const pw=sessionStorage.getItem(SS);if(pw)unlock(pw).catch(()=>sessionStorage.removeItem(SS))}catch{}
})();
