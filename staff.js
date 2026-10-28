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
 '경동택배':n=>`https://kdexp.com/service/delivery/etc/delivery.do?barcode=${encodeURIComponent(n)}`,
 '일양로지스':n=>`https://www.ilyanglogis.com/functionality/card_form_waybill.asp?hawb_no=${encodeURIComponent(n)}`};
const md=s=>s?`${s.slice(5,10).replace('-','/')}(${'일월화수목금토'[new Date(s.slice(0,10)+'T00:00:00+09:00').getDay()]})`:'—';
let D=null;
// UNIPASS opens 수입화물 진행정보 for an H B/L directly when the menu and number are in the address.
const unipass=o=>`https://unipass.customs.go.kr/csp/index.do?tgMenuId=MYC_MNU_00000450&hblNo=${encodeURIComponent(o.hbl)}&blYy=${encodeURIComponent(o.blYy||'')}`;
const KIND={customs:['통관 미완료','k-customs'],handover:['택배 인계 지연','k-handover'],unknown:['확인 전','k-unknown'],
  domestic:['국내배송 진행중','k-domestic'],delivered:['국내배송 완료 · ERP 미반영','k-delivered']};
let kindFilter='',shownAlerts=[];
const toast=t=>{const el=$('#toast');el.textContent=t;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),2600)};
const KPI_ORDER=['통관 시작','국내배송','해운 출발','특송업체 픽업','배송 완료'];
// One spreadsheet-like line per order; multi-box waybills stack one per line. Long text is cut with … (full text on hover).
function row(o){
  const link=TRACK[o.courier];
  const no=o.courierNo?o.courierNo.split(/\s+/).map(n=>link?`<a href="${link(n)}" target="_blank" rel="noopener">${esc(n)}</a>`:esc(n)).join('<br>'):'—';
  const since=o.sinceDeparture!=null&&o.stage<4?`+${o.sinceDeparture}일`:'';
  const alerts=o.alerts.join(' · ');
  return `<tr${o.alerts.length?' class="warnrow"':''}>
  <td>${o.hbl?`<a class="mini" href="${unipass(o)}" target="_blank" rel="noopener" title="유니패스 수입화물 진행정보 바로 보기">통관조회</a>`:''}</td>
  <td class="mono">${esc(o.order)}${o.upload?` <span class="tag" title="마르코 개별 업로드 (별도 송장 체계)">${esc(o.upload)}</span>`:''}</td>
  <td class="mono waybill">${no}</td><td>${esc(o.name)}</td>
  <td class="clip" title="${o.writer?esc(`${o.writer.name} (${o.writer.id}) ${o.writer.box} · 신청 ${o.writer.app}`):o.writerMissing?'개별 업로드 주문이라 관리자에서 요청서를 찾을 수 없어요':''}">${o.writer?`${esc(o.writer.name)} <span class="muted small">${esc(o.writer.box)}</span>`:o.writerMissing?'<span class="k-handover">작성자 확인 필요</span>':''}</td><td class="clip" title="${esc(o.item)}">${esc(o.item)}</td>
  <td><span class="pill s${o.stage}" title="ERP: ${esc(o.erp)}">${esc(D.stages[o.stage])}</span></td>
  <td class="clip alertline ${o.kind?KIND[o.kind][1]:''}" title="${esc(alerts)}">${esc(alerts)}</td>
  <td class="num">${md(o.orderDate)}</td><td class="num">${md(o.obDate)}</td><td class="num">${md(o.arDate)}</td><td class="num">${since}</td>
  <td>${esc(o.courier||'미정')}</td>
  <td>${!o.alerts.length?'':o.writer?`<button class="mini" data-msg="${esc(o.order)}" title="작성자에게 보낼 지연 안내 문자 준비">문자</button>`:'<button class="mini" disabled title="작성자를 찾지 못한 주문이라 보낼 대상이 없어요">문자</button>'}</td></tr>`;
}
const HEAD='<thead><tr><th>통관</th><th>주문번호</th><th>운송장번호</th><th>받는 분</th><th title="알림 대상: 우마이직구 요청서 작성자 (구매대행 사업자 또는 본인)">작성자</th><th>상품</th><th>단계</th><th>확인할 점<small class="thnote">(+N일)은 영업일 · 통관은 해운 출발부터, 택배 인계는 통관 완료부터 센 날</small></th><th>특송업체 픽업</th><th>해운 출발</th><th>국내 도착</th><th title="해운 출발 후 지난 영업일 (+1일까지 정상, +2일부터 확인)">경과</th><th>택배사</th><th title="작성자에게 지연 안내 문자 (우마이직구 관리자에서 발송)">문자</th></tr></thead>';
const matches=(o,q)=>!q||[o.order,o.hbl,o.courierNo,o.item,o.name,o.writer&&o.writer.name,o.writer&&o.writer.id,o.writer&&o.writer.box,o.courier,D.stages[o.stage],o.alerts.join(' ')].some(v=>String(v||'').toLowerCase().includes(q));
function renderAlerts(){
  const q=$('#gq').value.trim().toLowerCase(),al=D.orders.filter(o=>o.alerts.length),shown=al.filter(o=>(!kindFilter||o.kind===kindFilter)&&matches(o,q));
  $('#alertCount').textContent=shown.length===al.length?`${al.length}건`:`${shown.length} / ${al.length}건`;
  $('#kindChips').innerHTML=`<button class="chip${kindFilter?'':' on'}" data-kind="">전체 ${al.length}</button>`+
    Object.entries(KIND).filter(([k])=>D.kinds[k]).map(([k,[label,cls]])=>`<button class="chip ${cls}${kindFilter===k?' on':''}" data-kind="${k}">${esc(label)} ${D.kinds[k]}</button>`).join('');
  shownAlerts=shown;
  $('#alerts').innerHTML=HEAD+'<tbody>'+(shown.map(row).join('')||'<tr><td colspan="14" class="muted">검색 결과가 없어요.</td></tr>')+'</tbody>';
}
function renderList(){
  const q=$('#gq').value.trim().toLowerCase(),st=$('#stage').value,fl=$('#flag').value;
  const list=D.orders.filter(o=>(!st||String(o.stage)===st)&&(!fl||(fl==='alert'?o.alerts.length:o.flags.includes(fl)))&&matches(o,q));
  $('#count').textContent=`${list.length.toLocaleString()}건${list.length>300?' · 처음 300건만 표시 (오른쪽 위 검색으로 좁혀 보세요)':''}`;
  $('#orders').innerHTML=HEAD+'<tbody>'+list.slice(0,300).map(row).join('')+'</tbody>';
}
document.addEventListener('click',e=>{const c=e.target.closest('[data-kind]');if(!c)return;kindFilter=c.dataset.kind;renderAlerts()});
document.addEventListener('click',e=>{const k=e.target.closest('[data-go]');if(!k)return;const go=k.dataset.go;
  if(go==='alert'){kindFilter='';renderAlerts();$('#alertSec').scrollIntoView({behavior:'smooth',block:'start'});return}
  $('#stage').value=go;$('#flag').value='';renderList();$('#listSec').scrollIntoView({behavior:'smooth',block:'start'})});
function render(){
  $('#updated').textContent=`· ${new Date(D.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 · 최근 ${D.range[0]} ~ ${D.range[1]} 주문`;
  // Cards in the order staff should look at them; each jumps to the table holding those orders.
  $('#kpis').innerHTML=`<button class="kpi alert" data-go="alert"><span>확인 필요</span><b>${D.alerts.toLocaleString()}</b></button>`+
    KPI_ORDER.map(s=>D.stages.indexOf(s)).filter(i=>i>=0).map(i=>`<button class="kpi" data-go="${i}"><span>${esc(D.stages[i])}</span><b>${(D.summary[D.stages[i]]||0).toLocaleString()}</b></button>`).join('');
  $('#rules').textContent=`기준: 해운 출발 후 영업일로 +${D.alertDays}일이 지나도 실제로 배송완료가 안 된 주문 (+1일까지는 정상, 주말·공휴일 제외, ERP에 반영 안 됐어도 택배사에서 배송완료면 제외). 확인할 점은 택배사 조회(CJ·경동·일양) → 없으면 유니패스 통관 상태 순서로 판단해요.`;
  renderAlerts();
  $('#batches').innerHTML='<thead><tr><th>주문일</th>'+D.stages.map(s=>`<th>${esc(s)}</th>`).join('')+'<th>합계</th></tr></thead><tbody>'+
    D.batches.map(b=>`<tr><td class="num">${esc(b.orderDate)}</td>${D.stages.map(s=>`<td class="num">${b[s]||''}</td>`).join('')}<td class="num">${D.stages.reduce((a,s)=>a+(b[s]||0),0)}</td></tr>`).join('')+'</tbody>';
  $('#stage').innerHTML='<option value="">전체 단계</option>'+D.stages.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('');
  renderList();
}
// Excel: the alert rows as currently filtered/searched. SheetJS is loaded only when the button is pressed.
const XLSX_SRC='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx=()=>window.XLSX?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=XLSX_SRC;s.onload=ok;s.onerror=()=>no(Error('xlsx'));document.head.append(s)});
async function downloadExcel(){
  const b=$('#xlsxBtn');b.disabled=true;
  try{await loadXlsx();
    const rows=shownAlerts.map(o=>({'주문번호':o.order,'운송장번호':o.courierNo,'택배사':o.courier,'받는 분':o.name,
      '작성자':o.writer?o.writer.name:o.writerMissing?'작성자 확인 필요':'','작성자 아이디':o.writer?o.writer.id:'','사서함':o.writer?o.writer.box:'',
      '상품':o.item,'단계':D.stages[o.stage],'확인할 점':o.alerts.join(' · '),'특송업체 픽업':o.orderDate||'','해운 출발':o.obDate||'',
      '국내 도착':o.arDate||'','경과(영업일)':o.sinceDeparture??''}));
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
    ws['!cols']=[18,16,10,10,12,22,11,30,10,46,12,11,11,10].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,ws,'확인 필요');
    const t=new Date(D.updatedAt),p=n=>String(n).padStart(2,'0');
    XLSX.writeFile(wb,`베스타_확인필요_${t.getFullYear()}${p(t.getMonth()+1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}.xlsx`);
  }catch{toast('엑셀 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')}finally{b.disabled=false}}
// 문자: the page cannot send by itself (sending happens in the 우마이직구 admin under the staff's own login), so it
// prepares the text for the row's 작성자 and the details to find them there.
const bytes=s=>[...s].reduce((n,c)=>n+(c.charCodeAt(0)>127?2:1),0);
// The admin sends plain SMS, cut at 90 bytes (Korean = 2 bytes), so the reason is the short label, and a shorter
// wording is used when a long order number or name would still not fit.
const SMS_REASON={customs:'통관 미완료',handover:'택배 인계 지연',domestic:'국내배송 지연',unknown:'통관·배송 확인 중'};
function message(o){
  const why=SMS_REASON[o.kind]||'배송 지연',n=o.sinceDeparture??'';
  const full=`${o.order}건 ${o.name}님의 상품이 ${why} 사유로 ${n}일 지연되고 있습니다.`;
  return bytes(full)<=90?full:`${o.order}건 ${o.name}님 상품이 ${why}로 ${n}일째 지연 중입니다.`}
function openMsg(order){
  const o=D.orders.find(x=>x.order===order);if(!o||!o.writer)return;
  $('#msgTo').dataset.id=o.writer.id;
  $('#msgTo').innerHTML=`<b>${esc(o.writer.name)}</b> <span class="muted">· 사서함 ${esc(o.writer.box)} · 아이디 ${esc(o.writer.id)}</span>`;
  $('#msgText').value=message(o);countBytes();$('#msgDlg').showModal()}
function countBytes(){const n=bytes($('#msgText').value);$('#msgBytes').textContent=`${n} / 90 byte${n>90?' · 90byte를 넘는 부분은 잘려서 도착해요. 줄여 주세요.':''}`;$('#msgBytes').className=n>90?'small k-handover':'small muted'}
const copy=async t=>{try{await navigator.clipboard.writeText(t);toast('복사했어요.')}catch{toast('복사하지 못했어요. 직접 선택해서 복사해 주세요.')}};
document.addEventListener('click',e=>{const m=e.target.closest('[data-msg]');if(m)openMsg(m.dataset.msg)});
async function unlock(pw){const d=await open(pw);if(D)return;D=d;try{sessionStorage.setItem(SS,pw)}catch{}$('#gate')?.remove();$('#app').classList.remove('hidden');render()}
$('#gateForm').onsubmit=async e=>{e.preventDefault();const b=$('#pwBtn');b.disabled=true;b.textContent='확인 중…';$('#pwErr').textContent='';
  try{await unlock($('#pw').value)}catch{const e=$('#pwErr');if(e)e.textContent='비밀번호가 맞지 않거나 데이터를 불러오지 못했어요.'}finally{b.disabled=false;b.textContent='들어가기'}};
$('#gq').addEventListener('input',()=>{renderAlerts();renderList()});
$('#xlsxBtn').onclick=downloadExcel;
$('#msgText').addEventListener('input',countBytes);
$('#msgCopy').onclick=()=>copy($('#msgText').value);
$('#msgName').onclick=()=>{const o=$('#msgTo b');if(o)copy(o.textContent)};
$('#msgId').onclick=()=>{const id=$('#msgTo').dataset.id;if(id)copy(id)};
['#stage','#flag'].forEach(s=>$(s).addEventListener('input',renderList));
try{const pw=sessionStorage.getItem(SS);if(pw)unlock(pw).catch(()=>sessionStorage.removeItem(SS))}catch{}
})();
