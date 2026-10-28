// Staff view. data/staff-vault.json is AES-256-CBC + HMAC-SHA256 with keys from PBKDF2(password) — same format as 우마이펄스.
(()=>{
const $=s=>document.querySelector(s);
const enc=new TextEncoder(),b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SS='woomyvesta-pw';
// Keys are derived once per password + salt (600k PBKDF2 rounds); the photo vault shares the main vault's salt.
const KEYS=new Map();let PW=null;
async function keysFor(pw,v){const id=`${v.salt}|${v.iter}|${pw}`;if(KEYS.has(id))return KEYS.get(id);
  const base=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:b64(v.salt),iterations:v.iter},base,512));
  const k={mk:await crypto.subtle.importKey('raw',bits.slice(32),{name:'HMAC',hash:'SHA-256'},false,['verify']),
    ak:await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-CBC',false,['decrypt'])};KEYS.set(id,k);return k}
async function unseal(url,pw){
  const v=await (await fetch(url,{cache:'no-store'})).json(),{mk,ak}=await keysFor(pw,v);
  const iv=b64(v.iv),ct=b64(v.ct),msg=new Uint8Array(iv.length+ct.length);msg.set(iv);msg.set(ct,iv.length);
  if(!await crypto.subtle.verify('HMAC',mk,b64(v.mac),msg)){KEYS.delete(`${v.salt}|${v.iter}|${pw}`);throw Error('wrong')}
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-CBC',iv},ak,ct)));
}
async function open(pw){const d=await unseal('data/staff-vault.json',pw);PW=pw;PH=null;return d}
// Photos shown in the conversation popup live in data/staff-photos.json ({id: {t: preview, l: large}} data URIs),
// fetched the first time a popup needs them.
let PH=null;
const photosFor=()=>PH||(PH=PW?unseal('data/staff-photos.json',PW).catch(()=>{PH=null;return {}}):Promise.resolve({}));
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
  pending:['확인 후 안내 대기','k-domestic','"확인해 보겠습니다"라고 답한 뒤 추가 안내가 없는 상담'],
  bot:['챗봇만 응대','k-unknown','마지막 대화 뒤 고객이 챗봇 메뉴만 눌렀고 직원 답이 없는 상담']};
let kFilter='',kTopic=null;const kOpen=new Set();
// [처리완료]: staff tick a row to set it aside until the customer writes again (the mark is tied to the message time
// it answers). Marks are shared through the 접수창구 (sheet 처리완료); this browser's own ticks show at once and win
// for a few minutes until the shared list has them. Chats answered in Kakao itself arrive as K.resolved.
const KDONE='woomyvesta-kdone';let KMARKS={};
const localDone=()=>{try{return JSON.parse(localStorage.getItem(KDONE)||'{}')}catch{return {}}};
const markOf=id=>{const l=localDone()[id],s=KMARKS[id];return l&&(!s||Date.now()-l.since<5*60e3)?l:s};
const isDone=x=>{const m=markOf(x.id);return !!(m&&m.done&&m.at===x.at)};
async function loadDone(){if(!D?.smsIntake)return;try{const r=await (await fetch(`${D.smsIntake}?action=doneList`)).json();
  if(r.ok){KMARKS=r.marks||{};renderKakao()}}catch{}}
let kMoveT=null;
function moveMsg(t){const m=$('#kMoveMsg');m.textContent=t;m.classList.add('on');clearTimeout(kMoveT);kMoveT=setTimeout(()=>m.classList.remove('on'),3000)}
async function setDone(x,done){
  const all=localDone();all[x.id]={at:x.at,done,since:Date.now()};try{localStorage.setItem(KDONE,JSON.stringify(all))}catch{}
  renderKakao();moveMsg(done?`‘${x.name}’ 상담을 처리완료로 옮겼어요.`:`‘${x.name}’ 상담을 ‘${KTYPE[x.type][0]}’ 탭으로 옮겼어요.`);
  if(!D.smsIntake)return;
  try{const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({kind:'done',chat:x.id,at:x.at,done,ts:new Date().toISOString()})})).json();if(!r.ok)throw Error(r.error)}
  catch{toast('이 화면에는 반영했지만 다른 직원 화면에는 아직 반영되지 않았어요.')}}
const waited=at=>{const m=Math.max(1,Math.round((Date.now()-new Date(at))/6e4)),d=Math.floor(m/1440),h=Math.floor(m%1440/60);return d?`${d}일 ${h}시간`:h?`${h}시간 ${m%60}분`:`${m}분`};
function renderKakao(){
  const K=D.kakao;
  if(!K){$('#kakaoBadge').textContent='';$('#kRules').textContent='아직 카카오 데이터가 없어요.';$('#kTable').innerHTML='';$('#kInsight').classList.add('hidden');return}
  const q=$('#gq').value.trim().toLowerCase(),open=K.items.filter(x=>!isDone(x)),cnt=t=>open.filter(x=>x.type===t).length;
  // 처리완료 = rows staff ticked (until the customer writes again) + chats answered in Kakao (K.resolved, ticked and locked)
  const done=K.items.filter(isDone).concat((K.resolved||[]).filter(r=>!K.items.some(x=>x.id===r.id)).map(r=>({...r,auto:true})));
  const all=kFilter==='done'?done:open;
  const topicIds=kTopic&&new Set(kTopic.ids);
  const shown=all.filter(x=>(!kFilter||kFilter==='done'||x.type===kFilter)&&(!topicIds||topicIds.has(x.id))&&(!q||[x.name,x.last,x.botTaps,x.context,x.staff,x.hist&&x.hist.stage,x.hist&&x.hist.service].join(' ').toLowerCase().includes(q)));
  $('#kakaoBadge').textContent=open.length||'';
  $('#kCount').innerHTML=(shown.length===all.length?`${all.length}건`:`${shown.length} / ${all.length}건`)+(kTopic?` · <button class="chip on" id="kTopicClear" title="유형 필터 해제">${esc(kTopic.name)} ✕</button>`:'');
  $('#kRules').textContent=`${new Date(K.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 · 최근 ${K.windowDays}일 안에 움직인 상담만 봐요. 결제 고객 → 견적 받은 고객 → 나머지 순으로, 같은 묶음 안에서는 오래 기다린 순서로 보여 줘요. 고객이 "감사합니다·네 알겠습니다"처럼 인사로 끝낸 대화는 빼요. 챗봇 대화는 따로 떼어 보고, 그 위의 직원·고객 대화로 판단해요.`;
  $('#kChips').innerHTML=`<button class="chip${kFilter?'':' on'}" data-k="">전체 ${open.length}</button>`+
    Object.entries(KTYPE).map(([k,[label,cls,tip]])=>`<button class="chip ${cls}${kFilter===k?' on':''}" data-k="${k}" title="${esc(tip)}">${esc(label)} ${cnt(k)}</button>`).join('')+
    `<button class="chip k-delivered${kFilter==='done'?' on':''}" data-k="done" title="직원이 처리완료로 체크했거나 카카오에서 답변돼 정리된 상담 (새 메시지가 오면 다시 누락 탭으로 돌아가요)">✓ 처리완료 ${done.length}</button>`;
  const TIER=[['결제 고객','k-delivered'],['견적 받음','k-domestic']],fmtD=d=>d?d.slice(2).replace(/-/g,'/'):'';
  const drafts=D.kakaoDrafts||{};
  const rows=shown.map(x=>{const [label,cls]=KTYPE[x.type],h=x.hist,t=h&&TIER[h.tier],dr=draftOf(x),st=sendState(x.id);
    const fin=kFilter==='done',chk=fin?`<input type="checkbox" checked data-done="${esc(x.id)}" ${x.auto?'disabled title="카카오에서 답변돼 자동으로 옮겨졌어요. 새 메시지가 오면 다시 누락 탭으로 돌아가요."':'title="체크를 풀면 원래 탭으로 돌아가요"'} aria-label="처리완료">`
      :`<input type="checkbox" data-done="${esc(x.id)}" title="처리완료로 옮기기 (고객이 새 메시지를 보내면 다시 돌아와요)" aria-label="처리완료">`;
    return `<tr class="${x.late&&!fin?'late':''}"><td class="kdone">${chk}</td><td><span class="pill ${cls}">${esc(label)}</span>${x.auto?'<div class="muted small">카카오에서 처리됨</div>':''}</td>`+
      `<td><b>${esc(x.name)}</b>${t?` <span class="pill ${t[1]}">${t[0]}</span>`:''}${h&&h.ctype?` <span class="pill">${h.ctype}</span>`:''}${st?` <span class="pill ${st.cls}" title="${esc(st.text)}">${esc(st.label)}</span>`:''}</td>`+
      `<td title="${esc(new Date(x.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}">${x.auto?`<span class="muted small">처리 ${waited(x.resolvedAt)} 전</span>`:waited(x.at)}${x.late&&!fin?' <span class="pill k-customs">늦음</span>':''}${x.viaBot?' <span class="pill k-unknown" title="고객 질문 뒤에 챗봇 대화가 이어져 목록에서 놓치기 쉬운 상담">챗봇 뒤에 묻힘</span>':''}</td>`+
      `<td class="kmsg kclick" data-chat="${esc(x.id)}" title="눌러서 지난 대화 보기">${x.type==='bot'?'<span class="muted small">챗봇 메뉴: </span>':''}${esc(x.last||'')}${x.viaBot?`<div class="muted small">↳ 이후 챗봇만 사용${x.botTaps?`: ${esc(x.botTaps)}`:''}</div>`:''}${x.context?`<div class="muted small">↳ 그 전 마지막 대화 — ${esc(x.context)}</div>`:''}${x.reply?`<div class="small kreply">↳ ${esc(x.by||'직원')}: ${esc(x.reply)}</div>`:''}</td>`+
      `<td>${dr?`<button class="mini kctx-btn" data-ctx="${esc(x.id)}">맥락 이해하기</button>`:''}</td>`+
      `<td>${dr?`<button class="mini krec-btn${kOpen.has(x.id)?' on':''}" data-rec="${esc(x.id)}">추천 답변</button>`:''}</td>`+
      (h?`<td>${esc(h.stage||'')}</td><td>${esc(h.service||'')}</td>`
        :'<td colspan="2" class="muted small">새 상담 · 기록 없음</td>')+`<td>${fmtD((x.created||'').slice(0,10))}${h&&h.msgs?`<span class="muted small"> · ${h.msgs.toLocaleString()}개</span>`:''}</td>`+
      `<td>${esc(x.staff||'')}</td>`+
      `<td class="kact"><a class="mini" href="https://business.kakao.com/_xdetxmG/chats/${encodeURIComponent(x.id)}" target="_blank" rel="noopener" title="열면 읽음 처리돼요. 직접 응대할 때만 여세요.">열기 ↗</a></td></tr>`+
      (dr&&kOpen.has(x.id)?`<tr class="kd-row"><td colspan="12"><div class="kd"><div class="kd-head"><b>추천 답변</b><span class="muted small">누르면 5초 뒤 이 문구 그대로 카카오로 보내요 (그 사이 취소 가능)</span></div>${optButtons(x.id,dr)}</div></td></tr>`:'')});
  $('#kTable').innerHTML='<thead><tr><th title="처리완료">완료</th><th>구분</th><th>채팅방</th><th>기다린 시간</th><th>마지막 메시지</th><th>맥락</th><th>추천 답변</th><th>진행 단계</th><th>서비스</th><th>처음 문의</th><th>담당</th><th></th></tr></thead><tbody>'+
    (rows.join('')||`<tr><td colspan="12" class="muted">${kFilter==='done'?'처리완료로 옮긴 상담이 없어요.':'누락된 상담이 없어요.'}</td></tr>`)+'</tbody>';
  $('#kNote').textContent=(K.historyAsOf?`진행 단계·서비스는 ${new Date(K.historyAsOf).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 상담 기록이에요. 결제 고객 = 이전에 결제·배송까지 간 고객. `:'')+`늦음: 기다린 시간 2시간부터 (주말 포함 실제 경과 시간).`;
  renderInsight();
}
const AUTOCLS={'높음':'k-delivered','중간':'k-handover','낮음':'k-unknown'};
function renderInsight(){
  const I=D.kakaoInsight,K=D.kakao,sec=$('#kInsight');
  if(!I){sec.classList.add('hidden');return}sec.classList.remove('hidden');
  const at=t=>new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'});
  $('#kiAt').innerHTML=`${at(I.basedOn)} 데이터 · ${I.total}건 분석`+(K&&I.basedOn!==K.updatedAt?' <span class="pill k-handover">이전 데이터 기준 분석</span>':'');
  $('#kiSummary').innerHTML=I.summary.map(t=>`<li>${esc(t)}</li>`).join('');
  $('#kiTopics').innerHTML='<thead><tr><th>질문 유형</th><th>건수</th><th>예시</th><th>자동화</th><th>방법</th></tr></thead><tbody>'+
    I.topics.map((t,i)=>`<tr class="ki-row${kTopic&&kTopic.name===t.name?' on':''}" data-ti="${i}"><td><b>${esc(t.name)}</b></td><td class="num">${t.count}<span class="muted small"> · ${Math.round(t.count/I.total*100)}%</span></td>`+
      `<td class="muted">${t.examples.map(e=>`“${esc(e)}”`).join('<br>')}</td><td><span class="pill ${AUTOCLS[t.auto]||''}">${esc(t.auto)}</span></td><td>${esc(t.how)}</td></tr>`).join('')+'</tbody>';
  $('#kiActions').innerHTML=I.actions.map(a=>`<li><b>${esc(a.title)}</b> <span class="pill">영향 ${esc(a.impact)}</span> <span class="pill">작업 ${esc(a.effort)}</span><div class="muted small">${esc(a.detail)}</div></li>`).join('');
}
$('#kiTopics').addEventListener('click',e=>{const r=e.target.closest('[data-ti]');if(!r)return;const t=D.kakaoInsight.topics[+r.dataset.ti];
  kTopic=kTopic&&kTopic.name===t.name?null:t;kFilter='';renderKakao();if(kTopic)$('#tabKakao').scrollIntoView({behavior:'smooth'})});
$('#kCount').addEventListener('click',e=>{if(e.target.id==='kTopicClear'){kTopic=null;renderKakao()}});
// ── 카카오 답장: conversation popup, 맥락 card, 추천 답변, and sending through the 접수창구 (Claude on the Mac sends) ──
const KSEND='woomyvesta-ksend';
const draftOf=x=>{const d=(D.kakaoDrafts||{})[x.id];return d&&d.at===x.at&&d.options?d:null};
const itemOf=id=>(D.kakao?.items||[]).find(x=>x.id===id)||(D.kakao?.resolved||[]).find(x=>x.id===id);
const ksends=()=>{try{return JSON.parse(localStorage.getItem(KSEND)||'{}')}catch{return {}}};
const SSTAT={'대기':['발송 대기','k-handover'],'발송 중':['발송 중','k-domestic'],'발송완료':['발송완료','k-delivered']};
function sendState(id){const r=ksends()[id];if(!r||Date.now()-r.since>6*36e5)return null;
  const [label,cls]=SSTAT[r.status]||(String(r.status).startsWith('실패')?[r.status,'k-customs']:['발송 대기','k-handover']);return {label,cls,text:r.text}}
const optButtons=(id,dr,withCheck=true)=>`<div class="kopts">${dr.options.map((o,i)=>`<button type="button" class="kopt" data-send="${esc(id)}" data-opt="${i}"><span class="kopt-n">${i+1}</span>${esc(o)}</button>`).join('')}</div>`+
  (withCheck&&dr.check&&dr.check.length?`<div class="kd-check"><b>보내기 전 확인</b><ul>${dr.check.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`:'');
let kUndo=null;
function kSend(id,text){text=(text||'').trim();
  if(!text){toast('보낼 문구를 입력해 주세요.');return false}
  if(/[\[\]]/.test(text)){toast('대괄호 [ ] 부분을 채운 뒤 보내 주세요.');return false}
  if(!D.smsIntake){toast('발송 창구가 연결되지 않았어요. 관리자에게 알려 주세요.');return false}
  const x=itemOf(id);clearTimeout(kUndo?.t);
  const bar=$('#kUndo');bar.querySelector('.ku-text').textContent=`${x?x.name:'상담'}에 5초 뒤 보내요: “${text.length>40?text.slice(0,40)+'…':text}”`;bar.classList.remove('hidden');
  const go=async()=>{bar.classList.add('hidden');const at=new Date().toISOString();
    try{const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({kind:'send',chat:id,text,at})})).json();
      if(!r.ok)throw Error(r.error);const all=ksends();all[id]={at,text,status:'대기',since:Date.now()};try{localStorage.setItem(KSEND,JSON.stringify(all))}catch{}
      toast('발송 요청했어요. 보통 1분 안에 보내지고, 이 줄에 발송완료로 표시돼요.');renderKakao();watchSends()}
    catch{toast('발송 요청을 보내지 못했어요. 잠시 뒤 다시 시도하거나 카카오에서 직접 보내 주세요.')}};
  kUndo={t:setTimeout(go,5000)};
  bar.querySelector('.ku-cancel').onclick=()=>{clearTimeout(kUndo.t);bar.classList.add('hidden');toast('보내기를 취소했어요.')};
  return true}
let sTimer=null;
function watchSends(){clearTimeout(sTimer);const all=ksends(),open=Object.entries(all).filter(([,r])=>!(r.status==='발송완료'||String(r.status).startsWith('실패'))&&Date.now()-r.since<6*36e5);
  if(!open.length||!D.smsIntake)return;
  sTimer=setTimeout(async()=>{let changed=false;for(const [id,r] of open){try{const s=(await (await fetch(`${D.smsIntake}?action=sendStatus&at=${encodeURIComponent(r.at)}`)).json()).status;
      if(s&&s!==r.status){r.status=s;changed=true;if(s==='발송완료')toast(`${itemOf(id)?.name||'상담'}에 보냈어요.`)}}catch{}}
    if(changed){try{localStorage.setItem(KSEND,JSON.stringify(all))}catch{}renderKakao()}watchSends()},4e3)}
const bubble=m=>`<div class="kb ${m.who==='S'?'me':m.who==='B'||m.who==='CB'?'bot':'you'}${m.unread?' unread':''}"><div class="kb-meta">${m.who==='S'?esc(m.staff||'직원'):m.who==='B'?'챗봇·자동':m.who==='CB'?'고객 → 챗봇':'고객'} · ${esc(new Date(m.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'}))}${m.unread?' · 아직 안 읽음(미리보기)':''}</div>${m.imgs&&/^(photo|\d+ photos|사진)$/i.test(m.text||'')?'':`<div class="kb-text">${esc(m.text)}</div>`}${m.imgs?`<div class="kb-imgs">${m.imgs.map(i=>`<button type="button" class="kimg" data-img="${esc(i)}" aria-label="사진 크게 보기"><span>사진</span></button>`).join('')}</div>`:''}</div>`;
// Fill the photo boxes once the photo vault is in; a photo Kakao no longer served when it was saved stays a label.
async function fillPhotos(){const boxes=[...document.querySelectorAll('#kcLog .kimg[data-img]')];if(!boxes.length)return;
  const ph=await photosFor();for(const b of boxes){const p=ph[b.dataset.img];
    if(p){b.innerHTML=`<img src="${p.t}" alt="고객이 보낸 사진">`}else{b.classList.add('gone');b.innerHTML='<span>사진<br>카카오에서 보기</span>'}}}
let kImgs=[],kImgAt=0;
async function showImg(i){kImgAt=(i+kImgs.length)%kImgs.length;const ph=await photosFor(),p=ph[kImgs[kImgAt]];if(!p)return;
  $('#kiImg').src=p.l;$('#kiCount').textContent=kImgs.length>1?`${kImgAt+1} / ${kImgs.length}`:'';
  $('#kiPrev').hidden=$('#kiNext').hidden=kImgs.length<2;const d=$('#kImgDlg');if(!d.open)d.showModal()}
$('#kcLog').addEventListener('click',e=>{const b=e.target.closest('.kimg[data-img]');if(!b||b.classList.contains('gone'))return;
  kImgs=[...$('#kcLog').querySelectorAll('.kimg[data-img]:not(.gone)')].map(x=>x.dataset.img);showImg(kImgs.indexOf(b.dataset.img))});
$('#kiPrev').onclick=()=>showImg(kImgAt-1);$('#kiNext').onclick=()=>showImg(kImgAt+1);
$('#kImgDlg').addEventListener('click',e=>{if(e.target.id==='kImgDlg'||e.target.id==='kiImg'||e.target.id==='kiClose')$('#kImgDlg').close()});
$('#kImgDlg').addEventListener('keydown',e=>{if(e.key==='ArrowLeft')showImg(kImgAt-1);if(e.key==='ArrowRight')showImg(kImgAt+1)});
let kDlgChat=null;
const kakaoUrl=id=>`https://business.kakao.com/_xdetxmG/chats/${encodeURIComponent(id)}`;
function openChat(id){const x=itemOf(id),th=(D.kakaoThreads||{})[id];if(!x)return;kDlgChat=id;
  $('#kcName').textContent=x.name;$('#kcOpen').href=kakaoUrl(id);$('#kcSub').textContent=[x.hist?.stage,x.hist?.service,`기다린 시간 ${waited(x.at)}`].filter(Boolean).join(' · ');
  $('#kcLog').innerHTML=(th&&th.more?'<p class="muted small center">더 이전 대화는 카카오에서 확인해 주세요.</p>':'')+((th?.messages||[]).map(bubble).join('')||'<p class="muted">저장된 대화가 없어요. 안 읽은 새 상담이면 카카오에서 열어 확인해 주세요.</p>');
  const dr=draftOf(x);$('#kcBrief').innerHTML=briefHtml(dr);$('#kcOpts').innerHTML=dr?optButtons(id,dr,false):'<p class="muted small">추천 답변이 아직 없어요. 직접 입력해서 보내 주세요.</p>';
  $('#kcText').value='';const d=$('#kChatDlg');d.showModal();$('#kcBrief').closest('.kmerge-right').scrollTop=0;const log=$('#kcLog');log.scrollTop=log.scrollHeight;fillPhotos()}
// 맥락 brief in the staff's handover style (kakao_drafts.py): what to do, a dashed line, then the sections.
function briefHtml(d){
  if(!d)return '<p class="muted">아직 맥락 요약이 없어요. 다음 전체 업데이트(매시 정각) 때 만들어져요.</p>';
  if(!d.situation)return `<p class="kb-p">${esc(d.summary||'')}</p>`;   // older drafts
  const ol=a=>`<ol>${a.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>`,sec=(t,b)=>`<div class="kb-sec"><b>(${t})</b>${b}</div>`;
  return `<div class="kb-ask"><p><b>${esc(d.ask)}</b></p>${ol(d.todo)}</div><hr class="kb-dash">`+
    sec('현재 상황',`<p class="kb-p">${esc(d.situation)}</p>`)+sec('고객에게 필요한 것',ol(d.needs))+
    sec('답변 직원의 역할',`<p class="kb-p">${esc(d.role)}</p>`)+sec('지금 해야 할 것',ol(d.now))+
    (d.note?sec('오해 소지·보충 설명',`<p class="kb-p">${esc(d.note)}</p>`):'')+
    (d.check&&d.check.length?sec('보내기 전 확인',`<ul>${d.check.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`):'')}
$('#kTable').addEventListener('click',e=>{
  const c=e.target.closest('[data-chat]');if(c&&!e.target.closest('a,button')){openChat(c.dataset.chat);return}
  const x=e.target.closest('[data-ctx]');if(x){openChat(x.dataset.ctx);return}
  const r=e.target.closest('[data-rec]');if(r){const id=r.dataset.rec;kOpen.has(id)?kOpen.delete(id):kOpen.add(id);renderKakao();return}
  const o=e.target.closest('[data-send]');if(o){const d=draftOf(itemOf(o.dataset.send));if(d)kSend(o.dataset.send,d.options[+o.dataset.opt])}});
$('#kTable').addEventListener('change',e=>{const c=e.target.closest('[data-done]');if(!c)return;
  const x=(D.kakao?.items||[]).find(i=>i.id===c.dataset.done);if(x)setDone(x,c.checked)});
$('#kChatDlg').addEventListener('click',e=>{const o=e.target.closest('[data-send]');if(o){const d=draftOf(itemOf(o.dataset.send));if(d&&kSend(o.dataset.send,d.options[+o.dataset.opt]))$('#kChatDlg').close()}});
$('#kcSend').onclick=()=>{if(kSend(kDlgChat,$('#kcText').value))$('#kChatDlg').close()};
// [새로고침]: reload the latest published vault now, and ask the Mac to fetch Kakao again (same 접수창구 as 문자 요청).
// The request is just {kind:'refresh', at}; the page then polls its status and reloads itself when the new data is live.
const RREQ='woomyvesta-krefresh';
const rmsg=t=>{$('#kRefreshMsg').textContent=t};
async function reloadData(){let pw=null;try{pw=sessionStorage.getItem(SS)}catch{}
  if(!pw){location.reload();return false}const d=await open(pw);D=d;render();return true}
let rTimer=null,rCount=null;
// The Mac picks requests up every 5 minutes from 9:00 to 21:55 KST (task vesta-kakao-refresh), so a waiting request
// shows a countdown to the next pick-up instead of "곧".
function nextPickup(now=Date.now()){
  const kst=new Date(now+9*36e5),h=kst.getUTCHours(),m=kst.getUTCMinutes(),base=now-(kst.getUTCMinutes()*6e4+kst.getUTCSeconds()*1e3+kst.getUTCMilliseconds());
  if(h>=9&&h<22){const t=base+Math.ceil((m*6e4+kst.getUTCSeconds()*1e3+kst.getUTCMilliseconds()+1)/3e5)*3e5;if(new Date(t+9*36e5).getUTCHours()<22)return t}
  return base-h*36e5+(h<9?9:33)*36e5}   // 오전 9시 (오늘 또는 내일)
// The target is kept until 3 minutes past it (a run takes a moment to pick the request up), then moves to the next one.
let rTarget=0;
function waitMsg(){const now=Date.now();if(!rTarget||now>rTarget+3*6e4)rTarget=nextPickup(now);
  const s=Math.ceil((rTarget-now)/1e3);
  if(s<=2)return '새로고침 요청됨 · 곧 시작해요';
  if(s>3600){const t=new Date(rTarget+9*36e5),today=new Date(now+9*36e5).getUTCDate()===t.getUTCDate();return `새로고침 요청됨 · ${today?'오늘':'내일'} 오전 9시에 시작해요`}
  return `새로고침 요청됨 · ${s>=60?`${Math.floor(s/60)}분 `:''}${s%60}초 후 시작해요`}
function countdown(on){if(on&&rCount)return;clearInterval(rCount);rCount=null;if(on){rTarget=0;rmsg(waitMsg());rCount=setInterval(()=>rmsg(waitMsg()),1e3)}}
function watchRefresh(req){clearTimeout(rTimer);
  const tick=async()=>{if(Date.now()-req.since>40*60e3){countdown(false);rmsg('새로고침이 오래 걸리고 있어요. 관리자에게 알려 주세요.');try{localStorage.removeItem(RREQ)}catch{}return}
    try{const r=await (await fetch(`${D.smsIntake}?action=refreshStatus&at=${encodeURIComponent(req.at)}`)).json();const st=r.status||'';
      countdown(st!=='진행 중'&&st!=='완료'&&!st.startsWith('실패'));
      if(st==='완료'){try{localStorage.removeItem(RREQ)}catch{}await reloadData();rmsg('');toast('카카오 누락 목록을 새로 가져왔어요.');return}
      if(st.startsWith('실패')){try{localStorage.removeItem(RREQ)}catch{}countdown(false);rmsg(`새로고침 실패 · ${st.replace(/^실패:?\s*/,'')}`);return}
      if(st==='진행 중')rmsg('카카오에서 가져오고 분석하는 중이에요…');
    }catch{countdown(false);rmsg('상태를 확인하지 못했어요. 잠시 뒤 다시 확인해요.')}
    rTimer=setTimeout(tick,20e3)};
  tick()}
$('#kRefresh').onclick=async()=>{const b=$('#kRefresh');b.disabled=true;rmsg('최신 데이터 불러오는 중…');
  try{await reloadData()}catch{rmsg('데이터를 다시 불러오지 못했어요.');b.disabled=false;return}
  let req=null;try{req=JSON.parse(localStorage.getItem(RREQ)||'null')}catch{}
  if(req&&Date.now()-req.since<40*60e3){watchRefresh(req);b.disabled=false;return}
  if(!D.smsIntake){rmsg('최신 공개 데이터로 다시 불러왔어요.');b.disabled=false;return}
  try{const at=new Date().toISOString();
    const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({kind:'refresh',at})})).json();
    if(!r.ok)throw Error(r.error);req={at:r.at||at,since:Date.now()};try{localStorage.setItem(RREQ,JSON.stringify(req))}catch{}
    if(r.joined)rmsg('이미 요청된 새로고침이 있어요 · 진행 상황을 보여 드릴게요');else countdown(true);watchRefresh(req)}
  catch{rmsg('새로고침 요청을 보내지 못했어요. 지금 화면은 최신 공개 데이터예요.')}
  finally{b.disabled=false}};
$('#kChips').addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;kFilter=b.dataset.k;renderKakao()});
function setTab(t,push){
  $('#tabs').querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  $('#tabShip').classList.toggle('hidden',t!=='ship');$('#tabKakao').classList.toggle('hidden',t!=='kakao');
  if(push){const u=new URL(location.href);t==='ship'?u.searchParams.delete('tab'):u.searchParams.set('tab',t);history.replaceState(null,'',u)}
}
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)setTab(b.dataset.tab,true)});
setTab(new URLSearchParams(location.search).get('tab')==='kakao'?'kakao':'ship');
async function unlock(pw){const d=await open(pw);if(D)return;D=d;try{sessionStorage.setItem(SS,pw)}catch{}$('#gate')?.remove();$('#app').classList.remove('hidden');render();
  try{const req=JSON.parse(localStorage.getItem(RREQ)||'null');if(req&&D.smsIntake&&Date.now()-req.since<40*60e3)watchRefresh(req)}catch{}watchSends();
  loadDone();setInterval(loadDone,60e3)}   // other staff's 처리완료 ticks
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
