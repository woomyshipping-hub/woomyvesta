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
// 주문번호 as the 우마이직구 admin writes it (ERP adds _ only to help when labelling boxes), so a copy pastes straight
// into the admin search. A (B) box or _add (추가 상자) suffix is shown as a small tag next to it instead.
const adm=o=>o.order.replace(/(_add)?(\(.*\))?$/i,'').replace(/_/g,'');
const part=o=>{const m=o.order.match(/\((.*)\)$/);return m?`${m[1].toUpperCase()}상자`:/_add$/i.test(o.order)?'추가 상자':''};
const unipass=o=>`https://unipass.customs.go.kr/csp/index.do?tgMenuId=MYC_MNU_00000450&hblNo=${encodeURIComponent(o.hbl)}&blYy=${encodeURIComponent(o.blYy||'')}`;
const KIND={customs:['통관 미완료','k-customs'],handover:['택배 인계 지연','k-handover'],unknown:['확인 전','k-unknown'],
  domestic:['국내배송 진행중','k-domestic'],delivered:['국내배송 완료 · ERP 미반영','k-delivered']};
let kindFilter='',shownAlerts=[];
const toast=t=>{const el=$('#toast');el.textContent=t;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),2600)};
const KPI_ORDER=['통관 시작','국내배송','해운 출발','특송업체 픽업','배송 완료'];
// One spreadsheet-like line per order; multi-box waybills stack one per line. Long text is cut with … (full text on hover).
function row(o){
  const link=TRACK[o.courier];
  const cp=n=>`<button class="copybtn" data-copy="${esc(n)}" title="운송장번호 복사" aria-label="운송장번호 복사">⧉</button>`;
  const no=o.courierNo?o.courierNo.split(/\s+/).map(n=>(link?`<a href="${link(n)}" target="_blank" rel="noopener">${esc(n)}</a>`:esc(n))+cp(n)).join('<br>'):'—';
  const since=o.sinceDeparture!=null&&o.stage<4?`+${o.sinceDeparture}일`:'';
  const alerts=o.alerts.join(' · ');
  return `<tr${o.alerts.length?' class="warnrow"':''}>
  <td>${o.hbl?`<button class="mini" data-cus="${esc(o.order)}" title="통관 진행정보 보기">통관조회</button>`:''}</td>
  <td class="mono" title="ERP: ${esc(o.order)}">${esc(adm(o))}<button class="copybtn" data-copy="${esc(adm(o))}" title="주문번호 복사" aria-label="주문번호 복사">⧉</button>${part(o)?` <span class="tag">${esc(part(o))}</span>`:''}${o.upload?` <span class="tag" title="마르코 개별 업로드 (별도 송장 체계)">${esc(o.upload)}</span>`:''}</td>
  <td class="mono waybill">${no}</td><td>${esc(o.name)}</td>
  <td class="clip" title="${o.writer?esc(`${o.writer.name} (${o.writer.id}) ${o.writer.box} · 신청 ${o.writer.app}`):o.writerMissing?'개별 업로드 주문이라 관리자에서 요청서를 찾을 수 없어요':''}">${o.writer?`${esc(o.writer.name)} <span class="muted small">${esc(o.writer.box)}</span>`:o.writerMissing?'<span class="k-handover">작성자 확인 필요</span>':''}</td><td class="clip" title="${esc(o.item)}">${esc(o.item)}</td>
  <td><span class="pill s${o.stage}" title="ERP: ${esc(o.erp)}">${esc(D.stages[o.stage])}</span></td>
  <td class="clip alertline ${o.kind?KIND[o.kind][1]:''}" title="${esc(alerts)}">${esc(alerts)}</td>
  <td class="num">${md(o.orderDate)}</td><td class="num">${md(o.obDate)}</td><td class="num">${md(o.arDate)}</td><td class="num">${since}</td>
  <td>${esc(o.courier||'미정')}</td>
  <td class="msgcell">${msgCell(o)}</td></tr>`;
}
const HEAD='<thead><tr><th>통관</th><th>주문번호</th><th>운송장번호</th><th>받는 분</th><th title="알림 대상: 우마이직구 요청서 작성자 (구매대행 사업자 또는 본인)">작성자</th><th>상품</th><th>단계</th><th>확인할 점<small class="thnote">(+N일)은 영업일 · 통관은 해운 출발부터, 택배 인계는 통관 완료부터 센 날</small></th><th>특송업체 픽업</th><th>해운 출발</th><th>국내 도착</th><th title="해운 출발 후 지난 영업일 (+1일까지 정상, +2일부터 확인)">경과</th><th>택배사</th><th title="작성자에게 지연 안내 문자 (우마이직구 관리자에서 발송)">문자</th></tr></thead>';
const matches=(o,q)=>!q||[o.order,adm(o),o.hbl,o.courierNo,o.item,o.name,o.writer&&o.writer.name,o.writer&&o.writer.id,o.writer&&o.writer.box,o.courier,D.stages[o.stage],o.alerts.join(' ')].some(v=>String(v||'').toLowerCase().includes(q));
// 정렬: click a column title (not its border) to sort ▲, again ▼, a third time back to the default order.
const KORDER={customs:0,handover:1,unknown:2,domestic:3};
const SORTKEY=[o=>o.hbl,o=>adm(o),o=>o.courierNo,o=>o.name,o=>o.writer?o.writer.name:'',o=>o.item,o=>o.stage,
  o=>(KORDER[o.kind]??9)*1000-(+(o.alerts.join(' ').match(/\+(\d+)일/)||[0,0])[1]),o=>o.orderDate,o=>o.obDate,o=>o.arDate,
  o=>o.sinceDeparture??-1,o=>o.courier,o=>o.smsSent?o.smsSent.at:''];
const sortBy={alerts:null,orders:null};  // {col, dir: 1|-1}
function sorted(list,id){
  const st=sortBy[id];if(!st)return list;const k=SORTKEY[st.col];
  const cmp=(a,b)=>{const x=k(a)??'',y=k(b)??'';
    if(x===''&&y!=='')return 1;if(y===''&&x!=='')return -1;  // blanks last either way
    return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'ko',{numeric:true}))*st.dir};
  return [...list].sort(cmp)}
function markSort(table){const st=sortBy[table.id];const head=table.tHead&&table.tHead.rows[0];if(!head)return;
  [...head.cells].forEach((th,i)=>{th.classList.add('sortable');th.dataset.sort=st&&st.col===i?(st.dir>0?'asc':'desc'):''})}
document.addEventListener('click',e=>{const th=e.target.closest('th');if(!th||e.target.closest('.colgrip,button,a'))return;
  const table=th.closest('table');if(!table||!(table.id in sortBy))return;const col=th.cellIndex,st=sortBy[table.id];
  sortBy[table.id]=!st||st.col!==col?{col,dir:1}:st.dir>0?{col,dir:-1}:null;
  table.id==='alerts'?renderAlerts():renderList()});
function renderAlerts(){
  const q=$('#gq').value.trim().toLowerCase(),al=D.orders.filter(o=>o.alerts.length),shown=al.filter(o=>(!kindFilter||o.kind===kindFilter)&&matches(o,q));
  $('#alertCount').textContent=shown.length===al.length?`${al.length}건`:`${shown.length} / ${al.length}건`;
  $('#kindChips').innerHTML=`<button class="chip${kindFilter?'':' on'}" data-kind="">전체 ${al.length}</button>`+
    Object.entries(KIND).filter(([k])=>D.kinds[k]).map(([k,[label,cls]])=>`<button class="chip ${cls}${kindFilter===k?' on':''}" data-kind="${k}">${esc(label)} ${D.kinds[k]}</button>`).join('');
  shownAlerts=sorted(shown,'alerts');
  $('#alerts').innerHTML=HEAD+'<tbody>'+(shownAlerts.map(row).join('')||'<tr><td colspan="14" class="muted">검색 결과가 없어요.</td></tr>')+'</tbody>';
}
function renderList(){
  const q=$('#gq').value.trim().toLowerCase(),st=$('#stage').value,fl=$('#flag').value;
  const list=D.orders.filter(o=>(!st||String(o.stage)===st)&&(!fl||(fl==='alert'?o.alerts.length:o.flags.includes(fl)))&&matches(o,q));
  $('#count').textContent=`${list.length.toLocaleString()}건${list.length>300?' · 처음 300건만 표시 (오른쪽 위 검색으로 좁혀 보세요)':''}`;
  $('#orders').innerHTML=HEAD+'<tbody>'+sorted(list,'orders').slice(0,300).map(row).join('')+'</tbody>';
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
  renderAlerts();renderKakao();
  $('#batches').innerHTML='<thead><tr><th>주문일</th>'+D.stages.map(s=>`<th>${esc(s)}</th>`).join('')+'<th>합계</th></tr></thead><tbody>'+
    D.batches.map(b=>`<tr><td class="num">${esc(b.orderDate)}</td>${D.stages.map(s=>`<td class="num">${b[s]||''}</td>`).join('')}<td class="num">${D.stages.reduce((a,s)=>a+(b[s]||0),0)}</td></tr>`).join('')+'</tbody>';
  $('#stage').innerHTML='<option value="">전체 단계</option>'+D.stages.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('');
  renderList();
}
// 확인할 점 split for Excel: the customs part and the delivery (택배) part in their own columns.
function issues(o){
  const parts=o.alerts.join(' · ').split(' · ').filter(Boolean);
  if(o.kind==='customs'||o.kind==='unknown')return {'통관 이슈':parts.join(' · '),'배송 이슈':''};
  const i=parts.findIndex(p=>!p.startsWith('통관'));
  return i<0?{'통관 이슈':parts.join(' · '),'배송 이슈':''}:{'통관 이슈':parts.slice(0,i).join(' · '),'배송 이슈':parts.slice(i).join(' · ')}}
// Excel: the alert rows as currently filtered/searched. SheetJS is loaded only when the button is pressed.
const XLSX_SRC='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx=()=>window.XLSX?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=XLSX_SRC;s.onload=ok;s.onerror=()=>no(Error('xlsx'));document.head.append(s)});
async function downloadExcel(){
  const b=$('#xlsxBtn');b.disabled=true;
  try{await loadXlsx();
    const rows=shownAlerts.map(o=>({'주문번호':adm(o),'상자':part(o),'운송장번호':o.courierNo,'택배사':o.courier,'받는 분':o.name,
      '작성자':o.writer?o.writer.name:o.writerMissing?'작성자 확인 필요':'','작성자 아이디':o.writer?o.writer.id:'','사서함':o.writer?o.writer.box:'',
      '상품':o.item,'단계':D.stages[o.stage],...issues(o),'특송업체 픽업':o.orderDate||'','해운 출발':o.obDate||'',
      '국내 도착':o.arDate||'','경과(영업일)':o.sinceDeparture??''}));
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
    ws['!cols']=[16,8,16,10,10,12,22,11,30,10,30,34,12,11,11,10].map(w=>({wch:w}));
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
  const full=`${adm(o)}건 ${o.name}님의 상품이 ${why} 사유로 ${n}일 지연되고 있습니다.`;
  return bytes(full)<=90?full:`${adm(o)}건 ${o.name}님 상품이 ${why}로 ${n}일째 지연 중입니다.`}
// 발송: staff confirm here; the request is kept in this browser (localStorage woomyvesta-sms-req) and filed in the
// shared 접수창구, from which Claude sends it from the 우마이직구 admin and records it — so 발송완료 (o.smsSent) comes back
// in the data for every PC after the next publish. Until then the row shows 발송 대기.
const REQ='woomyvesta-sms-req';
const reqAll=()=>{try{return JSON.parse(localStorage.getItem(REQ)||'{}')}catch{return {}}};
const when=iso=>new Date(iso).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'});
// Results seen live in this browser (from the 접수창구 status) until the published data catches up.
const DONE='woomyvesta-sms-done';
const doneAll=()=>{try{return JSON.parse(localStorage.getItem(DONE)||'{}')}catch{return {}}};
const sentOf=o=>{const d=doneAll()[o.order];return d&&(!o.smsSent||new Date(o.smsSent.at)<new Date(d.at))?d:o.smsSent};
const pendingOf=o=>{const r=reqAll()[o.order],s=sentOf(o);return r&&(!s||new Date(s.at)<new Date(r.at))?r.at:null};
function msgCell(o){
  if(!o.alerts.length)return '';
  if(!o.writer)return '<button class="mini" disabled title="작성자를 찾지 못한 주문이라 보낼 대상이 없어요">문자</button>';
  const p=pendingOf(o);
  return `<button class="mini" data-msg="${esc(o.order)}" title="작성자에게 지연 안내 문자">문자</button>`+
    (p?` <span class="pendmark" title="${esc(when(p))} 발송 요청 · Claude가 보내면 발송완료로 바뀌어요">발송 대기</span>`:
     sentOf(o)?` <span class="sentmark" title="${esc(sentOf(o).text)}">발송완료 ${esc(when(sentOf(o).at))}</span>`:'')}
let msgOrder=null;
function openMsg(order){
  const o=D.orders.find(x=>x.order===order);if(!o||!o.writer)return;
  // Already sent or requested: one red warning (when, who, what) is the only step, then it goes out as before.
  const prev=pendingOf(o)?`${when(pendingOf(o))}에 이미 발송을 요청했어요. 아직 처리 중일 수 있어요.`:
    sentOf(o)?`${when(sentOf(o).at)}에 이미 발송이 완료됐고, 문제없이 발송됐어요.`:'';
  if(prev){const text=sentOf(o)&&!pendingOf(o)?sentOf(o).text:message(o);msgOrder=order;$('#msgText').value=text;
    $('#reWhen').textContent=when(pendingOf(o)||sentOf(o).at);
    $('#reWhat').textContent=pendingOf(o)?'이미 발송을 요청했어요 (아직 처리 중일 수 있어요)':'이미 발송이 완료됐고, 문제없이 발송됐어요';
    $('#reTo').textContent=`${o.writer.name}(${o.writer.box})`;$('#reText').textContent=text;$('#reDlg').showModal();return}
  msgOrder=order;
  $('#msgTo').dataset.id=o.writer.id;
  $('#msgTo').innerHTML=`<b>${esc(o.writer.name)}</b> <span class="muted">· 사서함 ${esc(o.writer.box)} · 아이디 ${esc(o.writer.id)}</span>`;
  $('#msgText').value=message(o);countBytes();$('#msgDlg').showModal()}
function countBytes(){const n=bytes($('#msgText').value);$('#msgBytes').textContent=`${n} / 90 byte${n>90?' · 90byte를 넘으면 보낼 수 없어요. 줄여 주세요.':''}`;$('#msgBytes').className=n>90?'small k-handover':'small muted'}
const copy=async t=>{try{await navigator.clipboard.writeText(t);toast('복사했어요.')}catch{toast('복사하지 못했어요. 직접 선택해서 복사해 주세요.')}};
document.addEventListener('click',e=>{const m=e.target.closest('[data-msg]');if(m)openMsg(m.dataset.msg)});
// After [발송]: ask the 접수창구 every 3 s how that request went, and show it on the row as soon as Claude marks it.
async function watchSend(req){
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,3000));
    let st='';try{st=(await (await fetch(`${D.smsIntake}?action=status&at=${encodeURIComponent(req.at)}`)).json()).status||''}catch{continue}
    if(!st||st==='대기')continue;
    if(st.startsWith('발송완료')){const d=doneAll();d[req.order]={at:new Date().toISOString(),to:req.to,text:req.text};
      try{localStorage.setItem(DONE,JSON.stringify(d))}catch{}renderAlerts();renderList();toast(`${req.order.replace(/(_add)?(\(.*\))?$/i,'').replace(/_/g,'')} 발송완료 ✓`)}
    else{const all=reqAll();delete all[req.order];try{localStorage.setItem(REQ,JSON.stringify(all))}catch{}
      renderAlerts();renderList();toast(`${req.order.replace(/(_add)?(\(.*\))?$/i,'').replace(/_/g,'')} 발송 안 됨 — ${st}`)}
    return}}
async function goSend(){
  const o=D.orders.find(x=>x.order===msgOrder);if(!o)return;const text=$('#msgText').value.trim();
  if(bytes(text)>90){toast('90byte를 넘어서 보낼 수 없어요. 문구를 줄여 주세요.');return}
  if(!text.includes(o.order)&&!text.includes(adm(o))){toast('문구에 주문번호가 있어야 해요.');return}
  // The dialog itself (받는 사람 + 문구 + [발송]) is the final check, so no second browser confirm here.
  const all=reqAll();all[o.order]={v:1,order:o.order,to:o.writer.id,text,resend:!!sentOf(o)||!!pendingOf(o),at:new Date().toISOString()};
  try{localStorage.setItem(REQ,JSON.stringify(all))}catch{toast('이 브라우저에 요청을 저장하지 못했어요.');return}
  $('#msgDlg').close();renderAlerts();renderList();
  // Shared 접수창구 (append-only Apps Script, URL inside the encrypted data): works from any staff PC; Claude on the
  // sending Mac picks it up. text/plain keeps it a simple request (no CORS preflight).
  try{if(!D.smsIntake)throw Error('no intake');
    const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(all[o.order])})).json();
    if(!r.ok)throw Error(r.error);toast('발송 중이에요. 결과가 나오면 이 줄에 바로 표시돼요.');watchSend(all[o.order])}
  catch{toast('발송 요청을 전달하지 못해 이 브라우저에 발송 대기로 남겨 뒀어요. 관리자에게 알려 주세요.')}}
// 열 너비: drag a column border to resize; click it (like Excel's double-click) to fit the widest content.
// Widths are remembered per table in this browser and re-applied whenever a table is redrawn.
const COLW='woomyvesta-colw';
const colw=()=>{try{return JSON.parse(localStorage.getItem(COLW)||'{}')}catch{return {}}};
function setCol(table,i,w){
  for(const r of table.rows){const c=r.cells[i];if(!c)continue;
    if(w==null){c.style.width=c.style.minWidth=c.style.maxWidth=''}else{c.style.width=c.style.minWidth=c.style.maxWidth=w+'px'}}}
function saveCol(table,i,w){const all=colw(),t=all[table.id]||(all[table.id]={});if(w==null)delete t[i];else t[i]=w;
  try{localStorage.setItem(COLW,JSON.stringify(all))}catch{}table.classList.toggle('sized',Object.keys(t).length>0)}
function fitCol(table,i){
  setCol(table,i,null);let w=40;
  for(const r of table.rows){const c=r.cells[i];if(c&&c.colSpan===1)w=Math.max(w,c.scrollWidth+2)}
  w=Math.min(w,900);setCol(table,i,w);saveCol(table,i,w)}
function gripTable(table){
  const head=table.tHead&&table.tHead.rows[0];if(!head)return;
  if(table.id in sortBy)markSort(table);
  const saved=colw()[table.id]||{};table.classList.toggle('sized',Object.keys(saved).length>0);
  for(const [i,w] of Object.entries(saved))setCol(table,+i,w);
  [...head.cells].forEach((th,i)=>{if(th.querySelector('.colgrip'))return;
    const g=document.createElement('span');g.className='colgrip';g.title='드래그: 너비 조절 · 클릭: 내용에 맞추기';
    g.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();
      const x0=e.clientX,w0=th.getBoundingClientRect().width;let moved=false;
      const move=ev=>{const dx=ev.clientX-x0;if(Math.abs(dx)>2)moved=true;if(moved)setCol(table,i,Math.max(40,Math.round(w0+dx)))};
      const up=ev=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);document.body.classList.remove('resizing');
        if(moved)saveCol(table,i,Math.max(40,Math.round(w0+ev.clientX-x0)));else fitCol(table,i)};
      document.body.classList.add('resizing');document.addEventListener('mousemove',move);document.addEventListener('mouseup',up)});
    th.append(g)})}
for(const id of ['alerts','orders','batches']){const t=document.getElementById(id);if(!t)continue;
  new MutationObserver(()=>gripTable(t)).observe(t,{childList:true})}
// 통관조회: the UNIPASS reading Vesta keeps for this order, in a window on the page (Esc or 닫기 to close):
// 처리단계 timeline first, then the must-check facts as cards, then every UNIPASS field under 더보기.
const dt=s=>s?s.replace('T',' ').slice(0,16):'—';
function openCus(order){
  const o=D.orders.find(x=>x.order===order);if(!o)return;const u=o.unipass||{};
  $('#cusHead').innerHTML=`<b>${esc(adm(o))}</b>${part(o)?` <span class="tag">${esc(part(o))}</span>`:''} <span class="muted">· H B/L ${esc(o.hbl)} · ${esc(o.name)}</span>`;
  const steps=u.steps||[];
  $('#cusSteps').innerHTML=steps.length?steps.map((s,i)=>`<li class="${i===0?'now':''}"><div class="st-head"><b>${esc(s.step||'—')}</b><span class="muted">${esc(dt(s.at))}</span></div>`+
      `${s.placeName||s.inOut?`<div class="small muted">${esc([s.placeName,s.inOut].filter(Boolean).join(' · '))}</div>`:''}`+
      `${s.note?`<div class="small st-note">${esc(s.note)}</div>`:''}</li>`).join(''):
    `<li class="muted small">${o.unipass?'처리단계 기록이 아직 없어요. 다음 갱신 때 함께 가져와요.':'아직 유니패스 조회 기록이 없어요. 해운 출발 후 영업일 +2일이 지나 확인 대상이 되면 다음 갱신 때 조회돼요.'}</li>`;
  const key=[['진행상태',u.cargo],['통관진행상태',u.customs],['처리일시',dt(u.customsAt)],['입항일',u.arrival],
    ['수입신고수리',dt(u.clearedAt)],['반출신고',dt(u.releasedAt)],['관리대상검사',u.inspect==='Y'?'검사 대상':u.inspect==='N'?'아님':u.inspect],['확인할 점',o.alerts.join(' · ')]];
  $('#cusCards').innerHTML=key.map(([k,v])=>`<div class="cus-card${k==='확인할 점'?' wide':''}"><span>${esc(k)}</span><b>${esc(v||'—')}</b></div>`).join('');
  const info=u.info||[];
  $('#cusMore').classList.toggle('hidden',!info.length&&!steps.length);$('#cusMore').open=false;
  // 더보기 grid: short values sit 2-3 to a row, long ones (품명, B/L, step details) take the full width.
  const cell=(k,v)=>`<div class="mi${String(v||'').length>26?' full':''}"><span>${esc(k)}</span><b>${esc(v||'—')}</b></div>`;
  $('#cusInfo').innerHTML=info.map(([k,v])=>cell(k,v)).join('')+
    (steps.length?`<div class="mi-sub">처리단계 상세</div>`+steps.map(s=>`<div class="mi full"><span>${esc(s.step)} · ${esc(dt(s.at))}</span><b>${esc([s.placeName&&`장치장 ${s.placeName}${s.place?` (${s.place})`:''}`,s.pkg&&`포장 ${s.pkg}`,s.weight&&s.weight!=='KG'&&`중량 ${s.weight}`,s.inOutAt&&`반출입 ${s.inOutAt}`,s.inOut,s.declNo&&`신고번호 ${s.declNo}`,s.basisNo&&`근거 ${s.basisNo}`].filter(Boolean).join(' · ')||'—')}</b></div>`).join(''):'');
  $('#cusAt').textContent=u.checkedAt?`유니패스 조회: ${when(u.checkedAt)} 기준`:'';
  $('#cusLink').href=unipass(o);const d=$('#cusDlg');d.showModal();d.scrollTop=0;d.querySelector('h3').focus({preventScroll:true})}  // open at the top
document.addEventListener('click',e=>{const c=e.target.closest('[data-cus]');if(c)openCus(c.dataset.cus)});
document.addEventListener('click',e=>{const c=e.target.closest('[data-copy]');if(!c)return;e.stopPropagation();
  navigator.clipboard.writeText(c.dataset.copy).then(()=>{c.textContent='✓';c.classList.add('ok');toast(`${c.dataset.copy} 복사했어요.`);
    setTimeout(()=>{c.textContent='⧉';c.classList.remove('ok')},1200)},()=>toast('복사하지 못했어요. 직접 선택해서 복사해 주세요.'))});
// 카카오 누락: three ways a chat can be left hanging. Data comes from vesta-tools/kakao_missed.py (D.kakao).
const KTYPE={unread:['안 읽음','k-customs','아직 아무도 읽지 않은 상담'],noReply:['읽고 답 없음','k-handover','읽었지만 고객 메시지에 아무도 답하지 않은 상담'],
  pending:['확인 후 안내 대기','k-domestic','"확인해 보겠습니다"라고 답한 뒤 추가 안내가 없는 상담']};
let kFilter='';
const waited=at=>{const h=(Date.now()-new Date(at))/36e5;return h<1?`${Math.max(1,Math.round(h*60))}분`:h<48?`${Math.floor(h)}시간`:`${Math.floor(h/24)}일`};
function renderKakao(){
  const K=D.kakao;
  if(!K){$('#kakaoBadge').textContent='';$('#kRules').textContent='아직 카카오 데이터가 없어요.';$('#kTable').innerHTML='';return}
  const q=$('#gq').value.trim().toLowerCase(),all=K.items,cnt=t=>all.filter(x=>x.type===t).length;
  const shown=all.filter(x=>(!kFilter||x.type===kFilter)&&(!q||[x.name,x.last,x.staff].join(' ').toLowerCase().includes(q)));
  $('#kakaoBadge').textContent=all.length||'';
  $('#kCount').textContent=shown.length===all.length?`${all.length}건`:`${shown.length} / ${all.length}건`;
  $('#kRules').textContent=`${new Date(K.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 · 최근 ${K.windowDays}일 안에 움직인 상담만 봐요. 오래 기다린 순서로 보여 줘요. 고객이 "감사합니다·네 알겠습니다"처럼 인사로 끝낸 대화는 빼요.`;
  $('#kChips').innerHTML=`<button class="chip${kFilter?'':' on'}" data-k="">전체 ${all.length}</button>`+
    Object.entries(KTYPE).map(([k,[label,cls,tip]])=>`<button class="chip ${cls}${kFilter===k?' on':''}" data-k="${k}" title="${esc(tip)}">${esc(label)} ${cnt(k)}</button>`).join('');
  const rows=shown.map(x=>{const [label,cls]=KTYPE[x.type];
    return `<tr class="${x.late?'late':''}"><td><span class="pill ${cls}">${esc(label)}</span></td><td><b>${esc(x.name)}</b></td>`+
      `<td title="${esc(new Date(x.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}">${waited(x.at)}${x.late?' <span class="pill k-customs">늦음</span>':''}</td>`+
      `<td class="kmsg">${esc(x.last||'')}</td><td>${esc(x.staff||'')}</td>`+
      `<td><a class="mini" href="https://business.kakao.com/_xdetxmG/chats/${encodeURIComponent(x.id)}" target="_blank" rel="noopener" title="열면 읽음 처리돼요. 직접 응대할 때만 여세요.">열기 ↗</a></td></tr>`});
  $('#kTable').innerHTML='<thead><tr><th>구분</th><th>채팅방</th><th>기다린 시간</th><th>마지막 메시지</th><th>담당</th><th></th></tr></thead><tbody>'+
    (rows.join('')||'<tr><td colspan="6" class="muted">누락된 상담이 없어요.</td></tr>')+'</tbody>';
  $('#kNote').textContent=`늦음 기준: 안 읽음 ${K.lateHours.unread}시간, 읽고 답 없음 ${K.lateHours.noReply}시간, 확인 후 안내 대기 ${K.lateHours.pending}시간 이상 (주말 포함 실제 경과 시간).`;
}
$('#kChips').addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;kFilter=b.dataset.k;renderKakao()});
function setTab(t,push){
  $('#tabs').querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  $('#tabShip').classList.toggle('hidden',t!=='ship');$('#tabKakao').classList.toggle('hidden',t!=='kakao');
  if(push){const u=new URL(location.href);t==='ship'?u.searchParams.delete('tab'):u.searchParams.set('tab',t);history.replaceState(null,'',u)}
}
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)setTab(b.dataset.tab,true)});
setTab(new URLSearchParams(location.search).get('tab')==='kakao'?'kakao':'ship');
async function unlock(pw){const d=await open(pw);if(D)return;D=d;try{sessionStorage.setItem(SS,pw)}catch{}$('#gate')?.remove();$('#app').classList.remove('hidden');render()}
$('#gateForm').onsubmit=async e=>{e.preventDefault();const b=$('#pwBtn');b.disabled=true;b.textContent='확인 중…';$('#pwErr').textContent='';
  try{await unlock($('#pw').value)}catch{const e=$('#pwErr');if(e)e.textContent='비밀번호가 맞지 않거나 데이터를 불러오지 못했어요.'}finally{b.disabled=false;b.textContent='들어가기'}};
$('#gq').addEventListener('input',()=>{renderAlerts();renderList();renderKakao()});
$('#xlsxBtn').onclick=downloadExcel;
$('#msgText').addEventListener('input',countBytes);
$('#msgCopy').onclick=()=>copy($('#msgText').value);
$('#msgSend').onclick=goSend;$('#reSend').onclick=()=>{$('#reDlg').close();goSend()};
$('#msgName').onclick=()=>{const o=$('#msgTo b');if(o)copy(o.textContent)};
$('#msgId').onclick=()=>{const id=$('#msgTo').dataset.id;if(id)copy(id)};
['#stage','#flag'].forEach(s=>$(s).addEventListener('input',renderList));
try{const pw=sessionStorage.getItem(SS);if(pw)unlock(pw).catch(()=>sessionStorage.removeItem(SS))}catch{}
})();
