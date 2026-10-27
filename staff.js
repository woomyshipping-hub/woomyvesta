// Staff view. data/staff-vault.json is AES-256-CBC + HMAC-SHA256 with keys from PBKDF2(password) — same format as 우마이펄스.
(()=>{
const $=s=>document.querySelector(s);
const enc=new TextEncoder(),b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SS='woomyvesta-pw';
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
const TRACK={'CJ대한통운':n=>`https://trace.cjlogistics.com/next/tracking.html?wblNo=${encodeURIComponent(n)}`,
 '경동택배':n=>`https://kdexp.com/service/delivery/etc/delivery.do?barcode=${encodeURIComponent(n)}`};
const md=s=>s?s.slice(5).replace('-','/'):'—';
let D=null;
// UNIPASS has no URL that pre-fills a waybill, so the 통관조회 button copies the H B/L number and opens UNIPASS.
const UNIPASS='https://unipass.customs.go.kr/csp/index.do';
// One compact spreadsheet-like line per order; long text is cut with … and shown in full on hover.
function row(o){
  const link=TRACK[o.courier];
  // Multi-box shipments carry several space-separated waybills; link each one.
  const no=o.courierNo?o.courierNo.split(/\s+/).map(n=>link?`<a href="${link(n)}" target="_blank" rel="noopener">${esc(n)}</a>`:esc(n)).join(' '):'—';
  const since=o.sinceArrival!=null&&o.stage<2?`${o.sinceArrival}일`:'';
  const alerts=o.alerts.join(' · ');
  return `<tr${o.alerts.length?' class="warnrow"':''}>
  <td>${o.hbl?`<button class="mini" data-hbl="${esc(o.hbl)}" title="운송장번호 복사 후 유니패스 열기">통관조회</button>`:''}</td>
  <td class="mono">${esc(o.order)}${o.upload?` <span class="tag" title="마르코 개별 업로드 (별도 송장 체계)">${esc(o.upload)}</span>`:''}</td><td>${esc(o.name)}</td><td class="clip" title="${esc(o.item)}">${esc(o.item)}</td>
  <td><span class="pill s${o.stage}" title="ERP: ${esc(o.erp)}">${esc(D.stages[o.stage])}</span></td>
  <td class="clip alertline" title="${esc(alerts)}">${esc(alerts)}</td>
  <td class="num">${md(o.orderDate)}</td><td class="num">${md(o.obDate)}</td><td class="num">${md(o.arDate)}</td><td class="num">${since}</td>
  <td>${esc(o.courier||'미정')}</td><td class="mono clip waybill" title="${esc(o.courierNo)}">${no}</td></tr>`;
}
const HEAD='<thead><tr><th>통관</th><th>주문번호</th><th>받는 분</th><th>상품</th><th>단계</th><th>확인할 점</th><th>주문</th><th>출항</th><th>도착</th><th>경과</th><th>택배사</th><th>운송장번호</th></tr></thead>';
const matches=(o,q)=>!q||[o.order,o.hbl,o.courierNo,o.item,o.name,o.courier,D.stages[o.stage],o.alerts.join(' ')].some(v=>String(v||'').toLowerCase().includes(q));
function renderAlerts(){
  const q=$('#gq').value.trim().toLowerCase(),al=D.orders.filter(o=>o.alerts.length),shown=al.filter(o=>matches(o,q));
  $('#alertCount').textContent=q?`${shown.length} / ${al.length}건`:`${al.length}건`;
  $('#alerts').innerHTML=HEAD+'<tbody>'+(shown.map(row).join('')||'<tr><td colspan="12" class="muted">검색 결과가 없어요.</td></tr>')+'</tbody>';
}
function renderList(){
  const q=$('#gq').value.trim().toLowerCase(),st=$('#stage').value,fl=$('#flag').value;
  const list=D.orders.filter(o=>(!st||String(o.stage)===st)&&(!fl||(fl==='alert'?o.alerts.length:o.flags.includes(fl)))&&matches(o,q));
  $('#count').textContent=`${list.length.toLocaleString()}건${list.length>300?' · 처음 300건만 표시 (오른쪽 위 검색으로 좁혀 보세요)':''}`;
  $('#orders').innerHTML=HEAD+'<tbody>'+list.slice(0,300).map(row).join('')+'</tbody>';
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),6000)}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hbl]');if(!b)return;const hbl=b.dataset.hbl;
  window.open(UNIPASS,'_blank','noopener');
  try{await navigator.clipboard.writeText(hbl);toast(`운송장번호 ${hbl} 복사됨 · 유니패스 '화물진행정보'에서 M B/L-H B/L 선택 → H B/L 칸에 붙여넣고 조회하세요.`)}
  catch{toast(`유니패스 '화물진행정보'에서 M B/L-H B/L 선택 → H B/L 칸에 ${hbl} 입력 후 조회하세요.`)}});
function render(){
  $('#updated').textContent=`· ${new Date(D.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 · 최근 ${D.range[0]} ~ ${D.range[1]} 주문`;
  $('#kpis').innerHTML=D.stages.map(s=>`<div class="kpi"><span>${esc(s)}</span><b>${(D.summary[s]||0).toLocaleString()}</b></div>`).join('')+
    `<div class="kpi alert"><span>확인 필요</span><b>${D.alerts.toLocaleString()}</b></div>`;
  const t=D.thresholds;
  $('#rules').textContent=`기준: 부산 도착 ${t.late}일 이상 미완료, ${t.stuck}일 이상은 ERP 반영 누락 가능, 주문 ${t.notShipped}일 이상 출항 전, 세관 검사·선별 대상`;
  renderAlerts();
  $('#batches').innerHTML='<thead><tr><th>주문일</th>'+D.stages.map(s=>`<th>${esc(s)}</th>`).join('')+'<th>합계</th></tr></thead><tbody>'+
    D.batches.map(b=>`<tr><td class="num">${esc(b.orderDate)}</td>${D.stages.map(s=>`<td class="num">${b[s]||''}</td>`).join('')}<td class="num">${D.stages.reduce((a,s)=>a+(b[s]||0),0)}</td></tr>`).join('')+'</tbody>';
  $('#stage').innerHTML='<option value="">전체 단계</option>'+D.stages.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('');
  renderList();
}
async function unlock(pw){const d=await open(pw);if(D)return;D=d;try{sessionStorage.setItem(SS,pw)}catch{}$('#gate')?.remove();$('#app').classList.remove('hidden');render()}
$('#gateForm').onsubmit=async e=>{e.preventDefault();const b=$('#pwBtn');b.disabled=true;b.textContent='확인 중…';$('#pwErr').textContent='';
  try{await unlock($('#pw').value)}catch{const e=$('#pwErr');if(e)e.textContent='비밀번호가 맞지 않거나 데이터를 불러오지 못했어요.'}finally{b.disabled=false;b.textContent='들어가기'}};
$('#gq').addEventListener('input',()=>{renderAlerts();renderList()});
['#stage','#flag'].forEach(s=>$(s).addEventListener('input',renderList));
try{const pw=sessionStorage.getItem(SS);if(pw)unlock(pw).catch(()=>sessionStorage.removeItem(SS))}catch{}
})();
