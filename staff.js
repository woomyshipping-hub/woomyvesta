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
// The search box at the top filters both tabs, so an empty table says which word hides the rows.
const noneMsg=()=>{const q=$('#gq').value.trim();return q?`‘${esc(q)}’ 검색 결과가 없어요. <button type="button" class="mini" data-clearq>검색어 지우기</button>`:'조건에 맞는 주문이 없어요.'};
document.addEventListener('click',e=>{if(!e.target.closest('[data-clearq]'))return;$('#gq').value='';renderAlerts();renderList();renderKakao()});
const toast=t=>{const el=$('#toast');el.textContent=t;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),2600)};
const KPI_ORDER=['통관 시작','국내배송','해운 출발','특송업체 픽업','배송 완료'];
// One spreadsheet-like line per order; multi-box waybills stack one per line. Long text is cut with … (full text on hover).
function row(o){
  const link=TRACK[o.courier];
  const cp=n=>`<button class="copybtn" data-copy="${esc(n)}" title="운송장번호 복사" aria-label="운송장번호 복사">⧉</button>`;
  const no=o.courierNo?o.courierNo.split(/\s+/).map(n=>(link?`<a href="${link(n)}" target="_blank" rel="noopener">${esc(n)}</a>`:esc(n))+cp(n)).join('<br>'):'—';
  const since=o.sinceDeparture!=null&&o.stage<4?`+${o.sinceDeparture}일`:'';
  const dm=o.doneMark,alerts=dm?['✓ 완료 처리',...new Set([ODMEMO[dm.how]??dm.how,dm.memo].filter(Boolean)),dm.ts&&when(dm.ts)].filter(Boolean).join(' · '):o.alerts.join(' · ');
  return `<tr${o.alerts.length?' class="warnrow"':''}>
  <td>${o.alerts.length?`<button class="mini odbtn" data-od="${esc(o.order)}" title="독차 등으로 이미 나간 주문을 완료로 넘기기">완료</button>`:
    dm?`<button class="mini" data-odundo="${esc(o.order)}" title="완료 처리를 취소하고 원래 상태로">되돌리기</button>`:''}</td>
  <td>${o.hbl?`<button class="mini" data-cus="${esc(o.order)}" title="통관 진행정보 보기">통관조회</button>`:''}</td>
  <td class="mono" title="ERP: ${esc(o.order)}">${esc(adm(o))}<button class="copybtn" data-copy="${esc(adm(o))}" title="주문번호 복사" aria-label="주문번호 복사">⧉</button>${part(o)?` <span class="tag">${esc(part(o))}</span>`:''}${o.upload?` <span class="tag" title="마르코 개별 업로드 (별도 송장 체계)">${esc(o.upload)}</span>`:''}</td>
  <td class="mono waybill">${no}</td><td>${esc(o.name)}</td>
  <td class="clip" title="${o.writer?esc(`${o.writer.name} (${o.writer.id}) ${o.writer.box} · 신청 ${o.writer.app}`):o.writerMissing?'개별 업로드 주문이라 관리자에서 요청서를 찾을 수 없어요':''}">${o.writer?`${esc(o.writer.name)} <span class="muted small">${esc(o.writer.box)}</span>`:o.writerMissing?'<span class="k-handover">작성자 확인 필요</span>':''}</td><td class="clip" title="${esc(o.item)}">${esc(o.item)}</td>
  <td><span class="pill s${o.stage}" title="ERP: ${esc(o.erp)}">${esc(D.stages[o.stage])}</span></td>
  <td class="clip alertline ${dm?'k-done':o.kind?KIND[o.kind][1]:''}" title="${esc(alerts)}">${esc(alerts)}</td>
  <td class="num">${md(o.orderDate)}</td><td class="num">${md(o.obDate)}</td><td class="num">${md(o.arDate)}</td><td class="num">${since}</td>
  <td>${esc(o.courier||'미정')}</td>
  <td class="msgcell">${msgCell(o)}</td></tr>`;
}
const HEAD='<thead><tr><th title="독차 등으로 이미 나간 주문을 완료로 넘기기 · 완료 처리한 주문은 되돌리기">완료</th><th>통관</th><th>주문번호</th><th>운송장번호</th><th>받는 분</th><th title="알림 대상: 우마이직구 요청서 작성자 (구매대행 사업자 또는 본인)">작성자</th><th>상품</th><th>단계</th><th>확인할 점<small class="thnote">(+N일)은 영업일 · 통관은 해운 출발부터, 택배 인계는 통관 완료부터 센 날</small></th><th>특송업체 픽업</th><th>해운 출발</th><th>국내 도착</th><th title="해운 출발 후 지난 영업일 (+1일까지 정상, +2일부터 확인)">경과</th><th>택배사</th><th title="작성자에게 지연 안내 문자 (우마이직구 관리자에서 발송)">문자</th></tr></thead>';
const matches=(o,q)=>!q||[o.order,adm(o),o.hbl,o.courierNo,o.item,o.name,o.writer&&o.writer.name,o.writer&&o.writer.id,o.writer&&o.writer.box,o.courier,D.stages[o.stage],o.alerts.join(' ')].some(v=>String(v||'').toLowerCase().includes(q));
// 정렬: click a column title (not its border) to sort ▲, again ▼, a third time back to the default order.
const KORDER={customs:0,handover:1,unknown:2,domestic:3};
const SORTKEY=[o=>o.doneMark?o.doneMark.ts||'1':'',o=>o.hbl,o=>adm(o),o=>o.courierNo,o=>o.name,o=>o.writer?o.writer.name:'',o=>o.item,o=>o.stage,
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
  const q=$('#gq').value.trim().toLowerCase(),al=D.orders.filter(o=>o.alerts.length),dn=D.orders.filter(o=>o.doneMark&&o._base.alerts.length);
  if(kindFilter==='done'&&!dn.length)kindFilter='';
  const pick=()=>kindFilter==='done'?dn.filter(o=>matches(o,q)):al.filter(o=>(!kindFilter||o.kind===kindFilter)&&matches(o,q));
  let shown=pick();alertHits=q?al.filter(o=>matches(o,q)).length+dn.filter(o=>matches(o,q)).length:0;
  // a search hit hidden by the chip filter: switch to the chip that holds it instead of saying "no results"
  if(q&&!shown.length&&alertHits){kindFilter=al.some(o=>matches(o,q))?'':'done';shown=pick()}
  $('#alertCount').textContent=shown.length===al.length?`${al.length}건`:`${shown.length} / ${al.length}건`;
  $('#kindChips').innerHTML=`<button class="chip${kindFilter?'':' on'}" data-kind="">전체 ${al.length}</button>`+
    Object.entries(KIND).filter(([k])=>D.kinds[k]).map(([k,[label,cls]])=>`<button class="chip ${cls}${kindFilter===k?' on':''}" data-kind="${k}">${esc(label)} ${D.kinds[k]}</button>`).join('')+
    (dn.length?`<button class="chip k-done${kindFilter==='done'?' on':''}" data-kind="done" title="독차 등으로 직원이 완료로 넘긴 주문">✓ 완료 처리 ${dn.length}</button>`:'');
  if(kindFilter==='done')$('#alertCount').textContent=`완료 처리 ${shown.length}건`;
  shownAlerts=sorted(shown,'alerts');
  $('#alerts').innerHTML=HEAD+'<tbody>'+(shownAlerts.map(row).join('')||`<tr><td colspan="15" class="muted">${noneMsg()}</td></tr>`)+'</tbody>';
  searchLayout();
}
let dayFilter='',listPage=1,listKey='';const PAGE=300;
document.addEventListener('click',e=>{const b=e.target.closest('#pager [data-page]');if(!b||b.disabled)return;
  listPage=+b.dataset.page;renderList();$('#listSec').scrollIntoView({behavior:'smooth',block:'start'})});
function renderList(){
  const q=$('#gq').value.trim().toLowerCase(),st=$('#stage').value,fl=$('#flag').value;
  const list=D.orders.filter(o=>(!st||String(o.stage)===st)&&(!dayFilter||o.orderDate===dayFilter)&&(!fl||(fl==='alert'?o.alerts.length:o.flags.includes(fl)))&&matches(o,q));
  // 300 rows a page; a new search or filter starts again at page 1 (search and filters always look at every order)
  const key=[q,st,fl,dayFilter].join('|');if(key!==listKey){listKey=key;listPage=1}
  const pages=Math.max(1,Math.ceil(list.length/PAGE));listPage=Math.min(listPage,pages);const from=(listPage-1)*PAGE;
  $('#count').innerHTML=(dayFilter?`<button class="daychip" data-clearday title="주문일 필터 해제">${md(dayFilter)} 주문만 ✕</button> `:'')+`${list.length.toLocaleString()}건`+
    (pages>1?` · ${(from+1).toLocaleString()}–${Math.min(from+PAGE,list.length).toLocaleString()}번째 (${listPage} / ${pages}페이지)`:'');
  $('#orders').innerHTML=HEAD+'<tbody>'+(sorted(list,'orders').slice(from,from+PAGE).map(row).join('')||`<tr><td colspan="15" class="muted">${noneMsg()}</td></tr>`)+'</tbody>';
  $('#pager').innerHTML=pages>1?`<button class="btn small-btn" data-page="${listPage-1}"${listPage>1?'':' disabled'}>‹ 이전</button>`+
    Array.from({length:pages},(_,i)=>`<button class="btn small-btn pg${i+1===listPage?' on':''}" data-page="${i+1}">${i+1}</button>`).join('')+
    `<button class="btn small-btn" data-page="${listPage+1}"${listPage<pages?'':' disabled'}>다음 ›</button>`:'';
  listHits=list.length;searchLayout();
}
// While searching, show only the cards holding matches: staff missed results sitting at the bottom under the chart.
// With no match anywhere, the 전체 주문 card stays to say so.
let alertHits=0,listHits=0;
function searchLayout(){
  const q=!!$('#gq').value.trim(),hide=(el,h)=>el&&el.classList.toggle('qhide',h);
  hide($('.vesta-myth'),q);hide($('#kpis'),q);hide($('#batchSec'),q);hide($('#kInsight'),q);
  hide($('#alertSec'),q&&!alertHits);hide($('#listSec'),q&&!listHits&&!!alertHits);
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-day],[data-clearday]');if(!b)return;
  dayFilter=b.dataset.day||'';if(b.dataset.day){$('#stage').value=b.dataset.st==='alert'?'':b.dataset.st;$('#flag').value=b.dataset.st==='alert'?'alert':''}
  renderList();if(b.dataset.day)$('#listSec').scrollIntoView({behavior:'smooth',block:'start'})});
document.addEventListener('click',e=>{const m=e.target.closest('[data-bmore]');if(!m)return;document.querySelectorAll('#batches .brow[hidden]').forEach(r=>r.hidden=false);m.remove()});
document.addEventListener('click',e=>{const c=e.target.closest('[data-kind]');if(!c)return;kindFilter=c.dataset.kind;renderAlerts()});
document.addEventListener('click',e=>{const k=e.target.closest('[data-go]');if(!k)return;const go=k.dataset.go;
  if(go==='alert'){kindFilter='';renderAlerts();$('#alertSec').scrollIntoView({behavior:'smooth',block:'start'});return}
  $('#stage').value=go;$('#flag').value='';dayFilter='';renderList();$('#listSec').scrollIntoView({behavior:'smooth',block:'start'})});
// A section that fails to draw is logged and skipped so the rest of the page still shows (see healthy()).
const safe=f=>{try{f()}catch(e){console.error('[vesta]',e)}};
// 완료 처리 (독차 등): staff mark an order the couriers cannot track as done. Marks are shared through the 접수창구
// (sheet 주문완료); the build bakes them in as o.manual, live marks win, and this browser's own clicks win for a few minutes.
const OKEY='woomyvesta-odone';let OMARKS={};
const oLocal=()=>{try{return JSON.parse(localStorage.getItem(OKEY)||'{}')}catch{return {}}};
function oMarkOf(o){const l=oLocal()[o.order],s=OMARKS[o.order];
  if(l&&(!s||Date.now()-l.since<5*60e3))return l;if(s)return s;
  return o.manual?{done:true,how:o.manual.how,memo:o.manual.memo,ts:o.manual.at}:null}
function applyMarks(){
  for(const o of D.orders){
    o._base??=o.manual?{alerts:o.manual.alerts,kind:o.manual.kind,stage:o.manual.stage}:{alerts:o.alerts,kind:o.kind,stage:o.stage};
    const m=oMarkOf(o);
    if(m&&m.done)Object.assign(o,{alerts:[],kind:'',stage:4,doneMark:m});else Object.assign(o,o._base,{doneMark:null})}
  const cnt=f=>{const c={};D.orders.forEach(o=>{const k=f(o);if(k)c[k]=(c[k]||0)+1});return c};
  D.summary=cnt(o=>D.stages[o.stage]);D.kinds=cnt(o=>o.kind);D.alerts=D.orders.filter(o=>o.alerts.length).length;
  const by={};D.orders.forEach(o=>{const b=by[o.orderDate]??={orderDate:o.orderDate};b[D.stages[o.stage]]=(b[D.stages[o.stage]]||0)+1});
  D.batches=Object.values(by).sort((a,b)=>b.orderDate.localeCompare(a.orderDate))}
async function loadODone(){if(!D?.smsIntake)return;try{const r=await (await fetch(`${D.smsIntake}?action=orderDoneList`)).json();
  if(r.ok&&JSON.stringify(r.marks)!==JSON.stringify(OMARKS)){OMARKS=r.marks||{};render()}}catch{}}
async function setODone(o,done,how,memo){
  const m={done,how,memo,ts:new Date().toISOString()},all=oLocal();all[o.order]={...m,since:Date.now()};
  try{localStorage.setItem(OKEY,JSON.stringify(all))}catch{}
  render();toast(done?`${adm(o)} 주문을 완료 처리했어요.`:`${adm(o)} 주문의 완료 처리를 되돌렸어요.`);
  if(!D.smsIntake)return;
  try{const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({kind:'odone',order:o.order,...m})})).json();if(!r.ok)throw Error(r.error)}
  catch{toast('이 화면에는 반영했지만 다른 직원 화면에는 아직 반영되지 않았어요. (접수창구 새 버전 배포 필요)')}}
// Marks made before the memo-only dialog carry a 독차 choice; shown as its label (once, even if the memo repeats it).
const ODMEMO={'독차(우리)':'독차 (우리가 부름)','독차(화주)':'독차 (화주가 부름)','기타':''};
let odOrder=null;
document.addEventListener('click',e=>{const b=e.target.closest('[data-od]');if(!b)return;
  const o=D.orders.find(x=>x.order===b.dataset.od);if(!o)return;odOrder=o;
  $('#odOrder').textContent=adm(o);$('#odWho').textContent=`${o.name||''}${o.courier?' · '+o.courier:''}`;$('#odIssue').textContent=o.alerts.join(' · ');
  $('#odMemo').value='';$('#odDlg').showModal();$('#odMemo').focus()});
document.addEventListener('click',e=>{if(e.target.id!=='odSave'||!odOrder)return;
  setODone(odOrder,true,'기타',$('#odMemo').value.trim().slice(0,100));$('#odDlg').close()});
document.addEventListener('click',e=>{const b=e.target.closest('[data-odundo]');if(!b)return;
  const o=D.orders.find(x=>x.order===b.dataset.odundo);if(o)setODone(o,false,o.doneMark?.how||'기타',o.doneMark?.memo||'')});
// 업데이트 멈춤 경고: 배송현황 is due on weekdays at 8·12·18시 (+90분), 카카오 누락 every hour 8:30–21:30 (late after 2h).
// Mirrors vesta-tools/freshness.py (which also skips public holidays) so a stalled update is seen on the page too.
function staleCheck(){
  const now=new Date(),kst=new Date(now.getTime()+9*36e5),late=[];
  const slot=()=>{for(let d=0;d<10;d++){const t=new Date(Date.UTC(kst.getUTCFullYear(),kst.getUTCMonth(),kst.getUTCDate()-d));if(t.getUTCDay()%6===0)continue;
    for(const h of [18,12,8]){const s=t.getTime()+(h-9)*36e5;if(s+90*6e4<=now)return s}}};
  const ago=t=>{const m=Math.round((now-t)/6e4);return m>=1440?`${Math.floor(m/1440)}일 ${Math.floor(m%1440/60)}시간`:`${Math.floor(m/60)}시간 ${m%60}분`};
  const due=slot(),s=new Date(D.updatedAt);if(due&&s<due)late.push(`배송현황이 ${ago(s)}째 업데이트되지 않았어요 (마지막 ${when(D.updatedAt)})`);
  const h=kst.getUTCHours()+kst.getUTCMinutes()/60;
  if(D.kakao&&h>=10.5&&h<=22.5&&now-new Date(D.kakao.updatedAt)>2*36e5)late.push(`카카오 누락이 ${ago(new Date(D.kakao.updatedAt))}째 업데이트되지 않았어요`);
  $('#stale').classList.toggle('hidden',!late.length);
  $('#stale').innerHTML=late.length?`⚠️ ${late.map(esc).join('<br>')}<span class="small"> · 아래 정보가 최신이 아닐 수 있어요. 담당자에게 알려 주세요.</span>`:'';
}
setInterval(()=>{if(typeof D!=='undefined'&&D)safe(staleCheck)},5*60e3);
function render(){
  applyMarks();safe(staleCheck);
  $('#updated').textContent=`· ${new Date(D.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 · 최근 ${D.range[0]} ~ ${D.range[1]} 주문`;
  // Cards in the order staff should look at them; each jumps to the table holding those orders.
  $('#kpis').innerHTML=`<button class="kpi alert" data-go="alert"><span>확인 필요</span><b>${D.alerts.toLocaleString()}</b></button>`+
    KPI_ORDER.map(s=>D.stages.indexOf(s)).filter(i=>i>=0).map(i=>`<button class="kpi" data-go="${i}"><span>${esc(D.stages[i])}</span><b>${(D.summary[D.stages[i]]||0).toLocaleString()}</b></button>`).join('');
  $('#rules').textContent=`기준: 해운 출발 후 영업일로 +${D.alertDays}일이 지나도 실제로 배송완료가 안 된 주문 (+1일까지는 정상, 주말·공휴일 제외, ERP에 반영 안 됐어도 택배사에서 배송완료면 제외). 확인할 점은 택배사 조회(CJ·경동·일양) → 없으면 유니패스 통관 상태 순서로 판단해요.`;
  safe(renderAlerts);safe(renderKakao);
  // 주문일별 진행: one stacked bar per order date (length = orders, color = stage), red badge = 확인 필요.
  const tot=b=>D.stages.reduce((a,s)=>a+(b[s]||0),0),most=Math.max(1,...D.batches.map(tot));
  const late={};D.orders.forEach(o=>{if(o.alerts.length)late[o.orderDate]=(late[o.orderDate]||0)+1});
  $('#blegend').innerHTML=D.stages.map((s,i)=>`<span><i class="bs${i}"></i>${esc(s)}</span>`).join('')+'<span><i class="bl"></i>확인 필요</span>';
  const BSHOW=14;$('#batches').innerHTML=D.batches.map((b,n)=>{const t=tot(b);return `<div class="brow"${n>=BSHOW?' hidden':''}><span class="bdate">${md(b.orderDate)}</span>
    <div class="btrack"><div class="bbar" style="width:${t/most*100}%">${D.stages.map((s,i)=>b[s]?`<button class="bs${i}${b[s]/most<.04?' tiny':''}" style="flex:${b[s]}" data-day="${esc(b.orderDate)}" data-st="${i}" title="${esc(md(b.orderDate))} · ${esc(s)} ${b[s]}건">${b[s]}</button>`:'').join('')}</div></div>
    <span class="btot"><b>${t}</b>건${late[b.orderDate]?`<button class="blate" data-day="${esc(b.orderDate)}" data-st="alert" title="확인 필요 ${late[b.orderDate]}건만 보기">${late[b.orderDate]}</button>`:''}</span></div>`}).join('')+(D.batches.length>BSHOW?`<button class="btn small-btn bmore" data-bmore>이전 주문일 ${D.batches.length-BSHOW}개 더 보기</button>`:'');
  const st=$('#stage').value;$('#stage').innerHTML='<option value="">전체 단계</option>'+D.stages.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('');$('#stage').value=st;
  safe(renderList);
}
// Self-check whenever a tab is shown: if the data is loaded but the page has no tables, draw again, and if that still
// fails, load the page again (what F5 did when staff reported the page going blank after switching tabs and 새로고침).
const healthy=()=>!!($('#kpis').children.length&&$('#orders thead')&&$('#alerts thead')&&(!D.kakao||$('#kTable thead')));
function heal(){if(!D||healthy())return;console.warn('[vesta] page was empty; drawing again');safe(render);if(!healthy())location.reload()}
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
const COLW='woomyvesta-colw2';  // v2: 완료 column added on the left, old widths no longer line up
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
// first a plain-language card staff can copy as an image for 사업자 고객 (출항 → 부산항 도착 → 통관 → 국내 배송, and
// whether the customer has to do anything), then the UNIPASS-style timeline, must-check cards and every field under 더보기.
const dt=s=>s?s.replace('T',' ').slice(0,16):'—';
const PORTS={osaka:'오사카',tokyo:'도쿄',kobe:'고베',yokohama:'요코하마',hakata:'하카타',fukuoka:'후쿠오카',shimonoseki:'시모노세키',nagoya:'나고야'};
const mdt=s=>s?md(s)+(/\d{2}:\d{2}/.test(s.slice(11,16))&&s.slice(11,16)!=='00:00'?' '+s.slice(11,16):''):'';
function cusPlain(o){
  const u=o.unipass||{},steps=u.steps||[],info=Object.fromEntries(u.info||[]);
  const at=re=>(steps.find(s=>re.test(s.step||''))||{}).at||'';
  const port=(info['적재항']||'').split(':').pop().split(',')[0].trim().toLowerCase();
  const all=[u.cargo,u.customs,...steps.map(s=>s.step)].join(' ');
  const into=at(/반입신고/),cleared=u.clearedAt||at(/수입신고수리|통관목록심사완료/),out=u.releasedAt||at(/반출신고/);
  const isCleared=!!cleared||/수리|심사완료/.test(u.customs||'')||o.stage>=3,isOut=!!out||u.cargo==='반출완료'||o.stage>=3;
  const arrived=u.arrival||o.arDate;
  // 통관: the plainest true sentence for where customs stands, and whether the customer must act ('need') or may be asked ('watch')
  let cus,act=null;
  const avg=(steps.find(s=>/평균 소요시간/.test(s.note||''))||{}).note;
  if(/불합격|반송|폐기|멸각/.test(all)){
    cus={state:'bad',title:/불합격/.test(all)?'검역 불합격':'통관 보류',date:mdt(u.customsAt),text:/불합격/.test(all)?
      `검역 검사에서 불합격 판정이 났어요 (${u.cargo||'검사/검역'}). 이 물품은 이대로는 국내로 들여올 수 없어요.`:`세관에서 통관이 멈춘 상태예요 (${u.cargo||u.customs}).`};
    act={level:'need',text:'해당 물품을 반송할지 폐기할지 알려 주세요. 결정해 주시면 바로 처리를 진행할게요.'}}
  else if(u.inspect==='Y'||/검사|검역/.test(all)&&!isCleared){
    cus={state:'now',title:'세관 검사·검역 중',date:mdt(u.customsAt),text:'세관에서 물품을 직접 확인하는 검사(또는 검역) 대상으로 선별돼 결과를 기다리고 있어요.'+(avg?` 보통 결과까지 ${avg.match(/(\d+)일/)?.[1]||'며칠'}일 정도 걸려요.`:' 결과가 나오면 통관이 이어져요.')};
    act={level:'watch',text:'지금은 기다리시면 돼요. 세관에서 구매 영수증·상품 설명 같은 자료를 요청하면 바로 알려 드릴게요.'}}
  else if(isCleared)cus={state:'done',title:'통관 완료',date:mdt(cleared),text:'세관 통관을 마쳤어요.'};
  else if(/결재통보/.test(u.customs||'')){
    cus={state:'now',title:'세관 담당자 확인 중',date:mdt(u.customsAt),text:'수입신고를 세관 담당자가 직접 확인하는 단계예요. 대부분 그대로 통과하지만 하루 이틀 더 걸릴 수 있어요.'};
    act={level:'watch',text:'지금은 기다리시면 돼요. 세관에서 구매 영수증·인보이스를 요청할 수 있으니 구매 내역을 준비해 두시면 빨라요.'}}
  else if(/심사진행|수입신고$/.test(u.customs||''))cus={state:'now',title:'통관 심사 중',date:mdt(u.customsAt),text:'수입신고를 마치고 세관에서 심사하고 있어요. 문제가 없으면 곧 통관이 끝나요.'};
  else if(/통관목록/.test(u.customs||''))cus={state:'now',title:'통관 심사 중',date:mdt(u.customsAt),text:'간이 통관 목록이 접수돼 세관 심사를 기다리고 있어요.'};
  else if(into||/반입/.test(u.cargo||''))cus={state:'now',title:'통관 준비 중',date:mdt(into),text:'부산 세관 창고에 들어와 통관 신고를 기다리고 있어요.'};
  else if(arrived)cus={state:'now',title:'통관 준비 중',date:'',text:'부산항에 도착해 세관 창고로 옮겨지는 중이에요.'};
  else cus={state:'todo',title:'통관',date:'',text:'부산항에 도착하면 통관이 시작돼요.'};
  const rows=[
    {state:o.obDate?'done':'now',title:'일본 출항',date:o.obDate?md(o.obDate):'',text:o.obDate?`${PORTS[port]?PORTS[port]+'항':'일본'}에서 배로 출발했어요.`:'아직 배에 실리기 전이에요.'},
    {state:arrived?'done':o.obDate?'now':'todo',title:'부산항 도착',date:arrived?md(arrived):'',text:arrived?'부산항에 도착했어요.'+(into?` ${mdt(into)}에 세관 창고에 들어갔어요.`:''):o.obDate?'바다를 건너오고 있어요.':'출항 후 보통 다음 날 도착해요.'},
    cus,
    {state:o.stage>=4?'done':isOut?'now':'todo',title:o.stage>=4?'배송 완료':'국내 배송',date:isOut&&o.stage<4?mdt(out):'',
      text:(o.stage>=4?'국내 배송까지 모두 끝났어요.':isOut?'세관 창고에서 나와 국내 택배로 넘어갔어요.':'통관이 끝나면 국내 택배로 넘어가요.')+
        (isOut&&o.courierNo?` 택배사 ${o.courier||'—'} · 운송장 ${o.courierNo}`:'')}];
  const now=act&&act.level==='need'?cus:[...rows].reverse().find(r=>r.state==='now')||[...rows].reverse().find(r=>r.state==='done')||rows[0];
  const head=now===cus?cus.title:now.title==='국내 배송'?'통관 완료 · 국내 배송 중':now.title==='부산항 도착'&&now.state==='now'?'바다를 건너오는 중':now.title==='일본 출항'&&now.state==='now'?'일본 출항 준비 중':now.title;
  return {rows,act,head,tone:act?act.level:o.stage>=4||isCleared?'good':'now'};
}
function plainHtml(o){
  const p=cusPlain(o),u=o.unipass||{};
  const act=p.act?`<div class="cp-act ${p.act.level}"><b>${p.act.level==='need'?'⚠️ 화주님 조치가 필요해요':'ℹ️ 참고해 주세요'}</b><p>${esc(p.act.text)}</p></div>`:
    `<div class="cp-act ok"><b>✓ 지금은 따로 하실 일이 없어요</b><p>진행되는 대로 저희가 확인하고 있어요.</p></div>`;
  return `<div class="cp-top"><span class="cp-brand">우마이직구 · 수입 통관 진행 안내</span><span class="cp-when">${u.checkedAt?esc(when(u.checkedAt))+' 기준':''}</span></div>`+
    `<div class="cp-id"><b>${esc(adm(o))}</b>${part(o)?` · ${esc(part(o))}`:''} · ${esc(o.item||'')}<br><span>받는 분 ${esc(o.name||'—')} · H B/L ${esc(o.hbl||'—')}</span></div>`+
    `<div class="cp-now ${p.tone}"><span>지금 상황</span><b>${esc(p.head)}</b></div>`+act+
    `<ol class="cp-steps">${p.rows.map(r=>`<li class="${r.state}"><div class="cp-h"><b>${esc(r.title)}</b><span>${esc(r.date||'')}</span></div><p>${esc(r.text)}</p></li>`).join('')}</ol>`;
}
// 이미지 복사: the plain card as a PNG on the clipboard (paste into 카카오톡); saved as a file where the browser blocks it.
let h2c;const loadH2C=()=>h2c??=new Promise((ok,no)=>{const s=document.createElement('script');
  s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';s.onload=()=>ok(window.html2canvas);s.onerror=no;document.head.append(s)});
$('#cusImg').addEventListener('click',async()=>{const el=$('#cusPlain'),b=$('#cusImg'),name=(el.dataset.order||'통관안내')+'.png';
  b.disabled=true;
  const blob=loadH2C().then(f=>f(el,{scale:2,backgroundColor:'#ffffff',logging:false})).then(c=>new Promise(r=>c.toBlob(r,'image/png')));
  try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);toast('이미지를 복사했어요. 카카오톡 대화창에 붙여넣기(⌘V / Ctrl+V) 하세요.')}
  catch{try{const a=document.createElement('a');a.href=URL.createObjectURL(await blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5e3);
    toast('브라우저가 복사를 막아 이미지 파일로 내려받았어요.')}catch{toast('이미지를 만들지 못했어요. 화면을 캡처해 주세요.')}}
  finally{b.disabled=false}});
function openCus(order){
  const o=D.orders.find(x=>x.order===order);if(!o)return;const u=o.unipass||{};
  $('#cusPlain').innerHTML=plainHtml(o);$('#cusPlain').dataset.order=adm(o);
  $('#cusStaff').classList.toggle('hidden',!o.alerts.length);$('#cusStaff').textContent=o.alerts.length?`직원 확인용: ${o.alerts.join(' · ')}`:'';
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
  $('#cusMore').open=false;
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
const KTYPE={unread:['안 읽음','k-customs','아직 아무도 읽지 않은 상담'],noReply:['읽고 답 안함','k-handover','읽었지만 고객 메시지에 아무도 답하지 않은 상담'],
  pending:['확인 후 안내 필요','k-domestic','"확인해 보겠습니다"라고 답한 뒤 추가 안내가 없는 상담'],
  bot:['챗봇만 응대','k-unknown','마지막 대화 뒤 고객이 챗봇 메뉴만 눌렀고 직원 답이 없는 상담']};
let kFilter='',kTopic=null;
// [처리완료]: staff tick a row to set it aside until the customer writes again (the mark is tied to the message time
// it answers). Marks are shared through the 접수창구 (sheet 처리완료); this browser's own ticks show at once and win
// for a few minutes until the shared list has them. Chats answered in Kakao itself arrive as K.resolved.
// KMARKS = everyone's 처리완료 from the intake sheet; the last list is kept so the first count is right before doneList answers
const KDONE='woomyvesta-kdone',KMARKC='woomyvesta-kmarks';let KMARKS=(()=>{try{return JSON.parse(localStorage.getItem(KMARKC)||'{}')}catch{return {}}})();
const localDone=()=>{try{return JSON.parse(localStorage.getItem(KDONE)||'{}')}catch{return {}}};
const markOf=id=>{const l=localDone()[id],s=KMARKS[id];return l&&(!s||Date.now()-l.since<5*60e3)?l:s};
const isDone=x=>{const m=markOf(x.id);return !!(m&&m.done&&m.at===x.at)};
async function loadDone(){if(!D?.smsIntake)return;try{const r=await (await fetch(`${D.smsIntake}?action=doneList`)).json();
  if(r.ok){KMARKS=r.marks||{};try{localStorage.setItem(KMARKC,JSON.stringify(KMARKS))}catch{}renderKakao()}}catch{}}
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
  const shown=all.filter(x=>(!kFilter||kFilter==='done'||x.type===kFilter)&&(!topicIds||topicIds.has(x.id))&&(!q||[x.name,x.last,x.botTaps,x.context,x.staff,x.hist&&x.hist.stage,x.hist&&x.hist.service,kMemoOf(x.id)?.memo].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>new Date(a.at)-new Date(b.at));   // oldest message first (user, 2026-10-29)
  $('#kakaoBadge').textContent=open.length||'';
  $('#kCount').innerHTML=(shown.length===all.length?`${all.length}건`:`${shown.length} / ${all.length}건`)+(kTopic?` · <button class="chip on" id="kTopicClear" title="유형 필터 해제">${esc(kTopic.name)} ✕</button>`:'');
  $('#kRules').textContent=`${new Date(K.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 · 최근 ${K.windowDays}일 안에 움직인 상담만 봐요. 메시지가 오래된 순서(오래 기다린 순서)로 보여 줘요. 고객이 "감사합니다·네 알겠습니다"처럼 인사로 끝낸 대화는 빼요. 챗봇 대화는 따로 떼어 보고, 그 위의 직원·고객 대화로 판단해요.`;
  $('#kChips').innerHTML=`<button class="chip${kFilter?'':' on'}" data-k="">전체 ${open.length}</button>`+
    Object.entries(KTYPE).map(([k,[label,cls,tip]])=>`<button class="chip ${cls}${kFilter===k?' on':''}" data-k="${k}" title="${esc(tip)}">${esc(label)} ${cnt(k)}</button>`).join('')+
    `<button class="chip k-delivered${kFilter==='done'?' on':''}" data-k="done" title="직원이 처리완료로 체크했거나 카카오에서 답변돼 정리된 상담 (새 메시지가 오면 다시 누락 탭으로 돌아가요)">✓ 처리완료 ${done.length}</button>`;
  const fmtD=d=>d?d.slice(2).replace(/-/g,'/'):'';
  const drafts=D.kakaoDrafts||{};
  const rows=shown.map(x=>{const [label,cls]=KTYPE[x.type],h=x.hist,dr=draftOf(x),st=sendState(x.id);
    const fin=kFilter==='done',mm=kMemoOf(x.id),btn=!fin?`<button class="mini odbtn" data-kdone="${esc(x.id)}" title="처리완료로 넘기기 (고객이 새 메시지를 보내면 다시 돌아와요)">완료</button>`
      :x.auto?'':`<button class="mini" data-kundo="${esc(x.id)}" title="처리완료를 취소하고 원래 탭으로">되돌리기</button>`;
    return `<tr class="${x.late&&!fin?'late':''}"><td class="kdone">${btn}</td><td><span class="pill ${cls}">${esc(label)}</span>${x.auto?'<div class="muted small">카카오에서 처리됨</div>':''}${x.type==='unread'&&x.unread>1?`<div class="muted small">${x.unread}건 안 읽음</div>`:''}</td>`+
      `<td><b>${esc(x.name)}</b>${st?` <span class="pill ${st.cls}" title="${esc(st.text)}">${esc(st.label)}</span>`:''}</td>`+
      `<td title="${esc(new Date(x.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}">${x.auto?`<span class="muted small">처리 ${waited(x.resolvedAt)} 전</span>`:waited(x.at)}${x.late&&!fin?' <span class="pill k-customs">늦음</span>':''}${x.viaBot?' <span class="pill k-unknown" title="고객 질문 뒤에 챗봇 대화가 이어져 목록에서 놓치기 쉬운 상담">챗봇 뒤에 묻힘</span>':''}</td>`+
      `<td class="kmsg kclick" data-chat="${esc(x.id)}" title="눌러서 지난 대화 · 맥락 요약 · 추천 답변 보기">${x.type==='bot'?'<span class="muted small">챗봇 메뉴: </span>':''}${esc(x.last||'')}${x.viaBot?`<div class="muted small">↳ 이후 챗봇만 사용${x.botTaps?`: ${esc(x.botTaps)}`:''}</div>`:''}${x.context?`<div class="muted small">↳ 그 전 마지막 대화 — ${esc(x.context)}</div>`:''}${x.reply?`<div class="small kreply">↳ ${esc(x.by||'직원')}: ${esc(x.reply)}</div>`:''}</td>`+
      `<td class="kact"><a class="mini" href="${kakaoUrl(x.id)}" target="_blank" rel="noopener" title="열면 읽음 처리돼요. 직접 응대할 때만 여세요.">열기 ↗</a></td>`+
      `<td class="kmemo"><div class="kmemo-row"><button class="mini" data-kmemo="${esc(x.id)}" title="이 상담에 메모 남기기 (다른 직원 화면에도 보여요)">${mm?'메모 수정':'메모'}</button>${mm?`<span class="small kmemo-text" title="${esc(when(mm.ts))}">${esc(mm.memo)}</span>`:''}</div></td>`+
      (h?`<td>${esc(h.stage||'')}</td><td>${esc(h.service||'')}</td>`
        :'<td colspan="2" class="muted small">새 상담 · 기록 없음</td>')+`<td>${fmtD((x.created||'').slice(0,10))}${h&&h.msgs?`<span class="muted small"> · ${h.msgs.toLocaleString()}개</span>`:''}</td>`+
      `<td>${esc(x.staff||'')}</td></tr>`});
  $('#kTable').innerHTML='<thead><tr><th title="처리완료로 넘기기 · 처리완료 탭에서는 되돌리기">완료</th><th>구분</th><th>채팅방</th><th>기다린 시간</th><th>마지막 메시지</th><th></th><th>메모</th><th>진행 단계</th><th>서비스</th><th>처음 문의</th><th>담당</th></tr></thead><tbody>'+
    (rows.join('')||`<tr><td colspan="11" class="muted">${$('#gq').value.trim()?noneMsg():kFilter==='done'?'처리완료로 옮긴 상담이 없어요.':'누락된 상담이 없어요.'}</td></tr>`)+'</tbody>';
  $('#kNote').textContent=(K.historyAsOf?`진행 단계·서비스는 ${new Date(K.historyAsOf).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} 기준 상담 기록이에요. `:'')+`늦음: 기다린 시간 2시간부터 (주말 포함 실제 경과 시간).`;
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
// Unread chats are never opened, so the popup has the saved history plus Kakao's one-line preview of the latest
// message; Kakao's unread count says how many more sit between them.
const unreadGap=n=>`<div class="kgap">${n>1?`확인했던 대화 이후 안 읽은 메시지 <b>${n}건</b> · 아래 미리보기 앞에 <b>${n-1}건</b>이 더 있어요 (카카오에서 열어야 보여요)`:'확인했던 대화 이후 안 읽은 메시지 <b>1건</b> (아래 미리보기)'}</div>`;
let kDlgChat=null;
const kakaoUrl=id=>`https://business.kakao.com/_xdetxmG/chats/${encodeURIComponent(id)}`;
function openChat(id){const x=itemOf(id),th=(D.kakaoThreads||{})[id];if(!x)return;kDlgChat=id;
  $('#kcName').textContent=x.name;$('#kcOpen').href=kakaoUrl(id);$('#kcSub').textContent=[x.hist?.stage,x.hist?.service,`기다린 시간 ${waited(x.at)}`].filter(Boolean).join(' · ');
  $('#kcLog').innerHTML=(th&&th.more?'<p class="muted small center">더 이전 대화는 카카오에서 확인해 주세요.</p>':'')+((th?.messages||[]).map(m=>(m.unread&&m.count?unreadGap(m.count):'')+bubble(m)).join('')||'<p class="muted">저장된 대화가 없어요. 안 읽은 새 상담이면 카카오에서 열어 확인해 주세요.</p>');
  const dr=draftOf(x);$('#kcBrief').innerHTML=briefHtml(dr);$('#kcOpts').innerHTML=dr?optButtons(id,dr,false):'<p class="muted small">추천 답변이 아직 없어요. 직접 입력해서 보내 주세요.</p>';
  $('#kcText').value='';const d=$('#kChatDlg');d.showModal();$('#kcBrief').closest('.kmerge-right').scrollTop=0;const log=$('#kcLog');log.scrollTop=log.scrollHeight;fillPhotos()}
// 맥락 brief in the staff's handover style (kakao_drafts.py): what to do, a dashed line, then the sections.
function briefHtml(d){
  if(!d)return '<p class="muted">아직 맥락 요약이 없어요. 다음 전체 업데이트(매시 정각) 때 만들어져요.</p>';
  if(!d.situation)return `<p class="kb-p">${esc(d.summary||'')}</p>`;   // older drafts
  const ol=a=>`<ol>${a.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>`,sec=(t,b)=>`<div class="kb-sec"><b>(${t})</b>${b}</div>`;
  const facts=d.facts&&d.facts.length?`<div class="kb-facts"><b>답변에 쓸 정보</b><table>${d.facts.map(f=>{const miss=/^못 찾음/.test(f.a);
    return `<tr${miss?' class="miss"':''}><th>${esc(f.q)}</th><td>${esc(f.a)}<div class="kb-src">${esc(f.src)}</div></td></tr>`}).join('')}</table></div>`:'';
  return `<div class="kb-ask"><p><b>${esc(d.ask)}</b></p>${ol(d.todo)}</div>${facts}<hr class="kb-dash">`+
    sec('현재 상황',`<p class="kb-p">${esc(d.situation)}</p>`)+sec('고객에게 필요한 것',ol(d.needs))+
    sec('답변 직원의 역할',`<p class="kb-p">${esc(d.role)}</p>`)+sec('지금 해야 할 것',ol(d.now))+
    (d.note?sec('오해 소지·보충 설명',`<p class="kb-p">${esc(d.note)}</p>`):'')+
    (d.check&&d.check.length?sec('보내기 전 확인',`<ul>${d.check.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`):'')}
$('#kTable').addEventListener('click',e=>{
  const c=e.target.closest('[data-chat]');if(c&&!e.target.closest('a,button')){openChat(c.dataset.chat);return}
  const o=e.target.closest('[data-send]');if(o){const d=draftOf(itemOf(o.dataset.send));if(d)kSend(o.dataset.send,d.options[+o.dataset.opt])}});
$('#kTable').addEventListener('click',e=>{const b=e.target.closest('[data-kdone],[data-kundo]');if(!b)return;
  const x=(D.kakao?.items||[]).find(i=>i.id===(b.dataset.kdone||b.dataset.kundo));if(x)setDone(x,!!b.dataset.kdone)});
// 메모: a short staff note per chat (kept across new messages), in the same dialog style as 배송 현황 [완료].
// Shared through the 접수창구 (sheet 카카오메모); this browser's own edits show at once and win for a few minutes.
const KMEMO='woomyvesta-kmemo';let KMEMOS={},kmChat=null;
const kmLocal=()=>{try{return JSON.parse(localStorage.getItem(KMEMO)||'{}')}catch{return {}}};
function kMemoOf(id){const l=kmLocal()[id],s=KMEMOS[id],m=l&&(!s||Date.now()-l.since<5*60e3)?l:s;return m&&m.memo?m:null}
async function loadMemos(){if(!D?.smsIntake)return;try{const r=await (await fetch(`${D.smsIntake}?action=memoList`)).json();
  if(r.ok&&JSON.stringify(r.memos)!==JSON.stringify(KMEMOS)){KMEMOS=r.memos||{};renderKakao()}}catch{}}
$('#kTable').addEventListener('click',e=>{const b=e.target.closest('[data-kmemo]');if(!b)return;const x=itemOf(b.dataset.kmemo);if(!x)return;kmChat=x.id;
  $('#kmName').textContent=x.name;$('#kmLast').textContent=x.last||'';$('#kmMemo').value=kMemoOf(x.id)?.memo||'';$('#kmDlg').showModal();$('#kmMemo').focus()});
$('#kmSave').onclick=async()=>{const id=kmChat,x=itemOf(id);if(!x)return;const memo=$('#kmMemo').value.trim().slice(0,100),ts=new Date().toISOString();
  const all=kmLocal();all[id]={memo,ts,since:Date.now()};try{localStorage.setItem(KMEMO,JSON.stringify(all))}catch{}
  $('#kmDlg').close();renderKakao();toast(memo?`‘${x.name}’ 메모를 저장했어요.`:`‘${x.name}’ 메모를 지웠어요.`);
  if(!D.smsIntake)return;
  try{const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({kind:'kmemo',chat:id,memo,ts})})).json();if(!r.ok)throw Error(r.error)}
  catch{toast('이 화면에는 저장했지만 다른 직원 화면에는 아직 보이지 않아요. (접수창구 새 버전 배포 필요)')}};
$('#kChatDlg').addEventListener('click',e=>{const o=e.target.closest('[data-send]');if(o){const d=draftOf(itemOf(o.dataset.send));if(d&&kSend(o.dataset.send,d.options[+o.dataset.opt]))$('#kChatDlg').close()}});
$('#kcSend').onclick=()=>{if(kSend(kDlgChat,$('#kcText').value))$('#kChatDlg').close()};
// [새로고침]: reload the latest published vault now, and ask the Mac to fetch Kakao again (same 접수창구 as 문자 요청).
// The request is just {kind:'refresh', at}; the page then polls its status and reloads itself when the new data is live.
const RREQ='woomyvesta-krefresh';
const rmsg=t=>{$('#kRefreshMsg').textContent=t};
// The page can outlive a publish: when the live staff.js is newer than the one running, load the page again (as F5 does)
// instead of drawing new data with old code. One reload at a time; data without orders is never swapped in.
const MYV=(document.querySelector('script[src*="staff.js"]')?.src.match(/v=(\w+)/)||[])[1];
async function stale(){try{const v=((await (await fetch('staff.html',{cache:'no-store'})).text()).match(/staff\.js\?v=(\w+)/)||[])[1];return !!(v&&MYV&&v!==MYV)}catch{return false}}
let reloading=null;
function reloadData(){return reloading||(reloading=(async()=>{try{let pw=null;try{pw=sessionStorage.getItem(SS)}catch{}
    if(!pw||await stale()){location.reload();return new Promise(()=>{})}
    const d=await open(pw);if(!d||!Array.isArray(d.orders)||!d.orders.length)throw Error('empty');
    D=d;render();return true}finally{reloading=null}})())}
// A page left open (another PC, a tab nobody touched for hours) keeps itself current: every 3 minutes while visible, and
// whenever it comes back into view, it checks the live page and data. New code -> reload (login is kept for this tab);
// new data only -> draw it in place. Skipped while staff are in a dialog or typing, and tried again next round.
let dataTag=null;
const vaultTag=async()=>{try{const r=await fetch('data/staff-vault.json',{method:'HEAD',cache:'no-store'});
  return r.ok?(r.headers.get('etag')||r.headers.get('last-modified')||r.headers.get('content-length')):null}catch{return null}};
const busy=()=>!!document.querySelector('dialog[open]')||(()=>{const a=document.activeElement;
  return a&&(a.tagName==='TEXTAREA'||a.tagName==='INPUT'&&a.type!=='button')&&a.id!=='gq'&&!!a.value})();
let freshAt=0;
async function keepFresh(){
  if(!D||document.hidden||busy()||reloading||Date.now()-freshAt<60e3)return;freshAt=Date.now();
  if(await stale()){location.reload();return}
  const t=await vaultTag();if(!t)return;
  if(dataTag===null){dataTag=t;return}
  if(t!==dataTag){try{await reloadData();dataTag=t;toast('최신 배송 현황으로 업데이트했어요.')}catch{}}}
setInterval(keepFresh,3*60e3);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)keepFresh()});
window.addEventListener('focus',keepFresh);
let rTimer=null,rCount=null;
// The Mac's watcher (task vesta-kakao-send-watch, any hour) picks a request up within seconds, so a waiting request
// just shows how long it has waited; past 3 minutes the watcher is probably busy sending or not running.
let rSince=0;
function waitMsg(){const s=Math.floor((Date.now()-rSince)/1e3);
  return s<180?'새로고침 요청됨 · 곧 시작해요':`새로고침 요청됨 · 아직 시작 전이에요 (${Math.floor(s/60)}분째 대기 · 다른 작업이 끝나면 시작해요)`}
function countdown(on){if(on&&rCount)return;clearInterval(rCount);rCount=null;if(on){rmsg(waitMsg());rCount=setInterval(()=>rmsg(waitMsg()),1e3)}}
let rGen=0;   // only the newest watcher keeps polling (each [새로고침] click used to start another loop)
function watchRefresh(req){clearTimeout(rTimer);const gen=++rGen;rSince=req.since;
  const tick=async()=>{if(gen!==rGen)return;if(Date.now()-req.since>40*60e3){countdown(false);rmsg('새로고침이 오래 걸리고 있어요. 관리자에게 알려 주세요.');try{localStorage.removeItem(RREQ)}catch{}return}
    try{const r=await (await fetch(`${D.smsIntake}?action=refreshStatus&at=${encodeURIComponent(req.at)}`)).json();const st=r.status||'';if(gen!==rGen)return;
      countdown(st!=='진행 중'&&st!=='완료'&&!st.startsWith('실패'));
      if(st==='완료'){try{localStorage.removeItem(RREQ)}catch{}await reloadData();rmsg('');toast('카카오 누락 목록을 새로 가져왔어요.');return}
      if(st.startsWith('실패')){try{localStorage.removeItem(RREQ)}catch{}countdown(false);rmsg(`새로고침 실패 · ${st.replace(/^실패:?\s*/,'')}`);return}
      if(st==='진행 중')rmsg('카카오에서 가져오고 분석하는 중이에요…');
    }catch{countdown(false);rmsg('상태를 확인하지 못했어요. 잠시 뒤 다시 확인해요.')}
    if(gen===rGen)rTimer=setTimeout(tick,8e3)};
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
// 견적서 tab: 구매 견적서 (상품 링크 -> 상품가·현지배송비·구매수수료) and 배송대행 견적서, laid out like 견적서 예시.xlsx.
// [자동 견적] sends each link to the 접수창구: the script reads the page at once, and links it cannot read (메루카리·아마존)
// wait for Claude on the Mac, who fills them in. Staff can change anything; [견적서 제작] takes a shared 견적번호
// (오늘날짜_101부터) and copies + saves the preview as a PNG. 공급자·입금 정보 and the signature come from the vault.
// adj: staff's own 현지배송비 / 구매수수료 (엔) and their 비고; '' = the automatic value
const QADJ=()=>({ship:'',shipNote:'',fee:'',feeNote:''});
const Q={type:'구매',items:[],lines:{'구매':[],'배송':[]},no:'',adj:QADJ()};
const QLINES={'구매':[],'배송':[]};   // 배송비 견적서 lines come from [배송비 계산] (or + 항목 추가)
const QNOTE={'구매':'우마이직구 이용 시 제품에 따라 입고비, 해외배송비, 사이즈 오버비용, 재포장비용, 국내화물 택배비 등이 추가로 발생할 수 있습니다. 상품 가격·현지배송비는 구매 시점의 판매 가격과 환율에 따라 달라질 수 있습니다.',
  '배송':'실제 입고 후 무게·부피 실측에 따라 비용이 달라질 수 있으며, 해외배송비·사업자통관비용·관부가세는 별도로 안내드립니다.'};
const QKEY='woomyvesta-quote';
const won=n=>Math.round(Number(n)||0).toLocaleString('ko-KR');
const yen=n=>'¥'+Math.round(Number(n)||0).toLocaleString('ja-JP');
const qnum=v=>{const n=parseFloat(String(v??'').replace(/[^\d.]/g,''));return isFinite(n)?n:null};
const qrate=()=>qnum($('#qRate').value)||0;
const qtoday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
// 구매수수료 for one request (one quote), as the user set it on 2026-10-30: (상품가×수량+현지배송비) of every product together
// × 5% (개인) or 3% (사업자), 원 미만 버림. Minimum 1,500엔 for one product from a shop that takes Korean cards; 2,000엔 when
// the request has more than one product or any 야후옥션·야후쇼핑·메루카리·페이페이플리마 product (Korean cards are refused
// there). Many orders: the notice charges again past 5 orders, and past quotes charged each separate 야후옥션·메루카리
// seller its own 2,000엔 — so each order beyond 5 adds its minimum (one shop = one order; each 옥션·메루카리 listing = one).
// 티켓 keep their own fee: 1매 3,000엔, 2매부터 매당 2,500엔.
const QNOCARD=/(auctions|page\.auctions|shopping)\.yahoo\.co\.jp|mercari\.com|paypayfleamarket/i;
const qshopOf=u=>QNOCARD.test(u)?'auction':/l-tike|t\.pia\.jp|eplus|ticket/i.test(u)?'ticket':'';
function qfeeAll(shipTotal){
  const priced=Q.items.filter(it=>qnum(it.price)),tickets=priced.filter(it=>it.shop==='ticket'),goods=priced.filter(it=>it.shop!=='ticket');
  const tfee=tickets.reduce((a,it)=>{const q=qnum(it.qty)||1;return a+(q>1?2500*q:3000)},0),parts=[],short=[];
  let fee=tfee;
  const g=$('#qGrade').value,fixed=g==='fix1500'?1500:g==='fix2000'?2000:0;
  if(goods.length&&fixed){fee+=fixed;parts.push(`고정 수수료 ${yen(fixed)} (직원 선택)`);short.push('고정 수수료')}
  else if(goods.length){const biz=g==='biz',pct=biz?3:5,nocard=goods.some(it=>it.shop==='auction');
    const total=goods.reduce((a,it)=>a+qnum(it.price)*(qnum(it.qty)||1),0)+(shipTotal||0),raw=Math.floor(total*pct/100);
    const min=goods.length>1||nocard?2000:1500,base=Math.max(min,raw);
    const orders=[...new Map(goods.map((it,i)=>[it.shop==='auction'||!it.url?'#'+i:(it.url.match(/^https?:\/\/(?:www\.)?([^/]+)/)||[])[1]||'#'+i,it])).values()];
    const extra=orders.slice(5).reduce((a,it)=>a+(it.shop==='auction'?2000:1500),0);
    fee+=base+extra;
    parts.push(`${goods.length>1?`상품 ${goods.length}개 합계 `:''}${yen(total)} × ${pct}%${raw<min?` → 최소 ${yen(min)}${nocard?' (야후·메루카리는 한국 카드 결제 불가)':goods.length>1?' (여러 상품)':''}`:` = ${yen(raw)}`}`);
    if(extra)parts.push(`주문 ${orders.length}건 중 5건 초과 ${orders.length-5}건 +${yen(extra)}`);
    // one line on the document: the rule that set the fee, without the arithmetic
    short.push(raw<min?"최소 수수료":`결제금액의 ${pct}%`);if(extra)short.push(`주문 초과 ${orders.length-5}건`)}
  if(tfee)short.push(`티켓 ${tickets.reduce((a,it)=>a+(qnum(it.qty)||1),0)}매`);
  if(tfee)parts.push(`티켓 ${yen(tfee)} (1매 3,000엔 · 2매부터 매당 2,500엔)`);
  return {fee,note:parts.join(' · '),short:short.join(' + ')}}
// The lines the document shows, each with the key of the editor row that feeds it: 구매 = 상품가 per product (p0…),
// 현지배송비 (ship), 구매수수료 (fee), then the added rows (l0…). Rows without a price are left out of the document.
// 현지배송비 and 구매수수료 take staff's own 엔 value when one is typed, else the automatic one.
// 현지배송비 of one product for the quantity on the quote. Claude reads 送料 for one piece from the detail page, plus the
// page's own rule when it states one (shipRule): unit = 送料 per piece, box = pieces per 1個口 (3개, box 2 -> 送料 × 2),
// freeOver = 상품가×수량 at or above this is 送料無料. Without a rule the product pays its 送料 once, whatever the quantity.
function qshipOf(it){const s=qnum(it.ship);if(s==null)return null;const r=it.shipRule||{},q=qnum(it.qty)||1;
  if(r.freeOver&&qnum(it.price)*q>=r.freeOver)return 0;
  return r.unit?s*q:r.box?s*Math.ceil(q/r.box):s}
function qship(){const known=Q.items.filter(it=>qshipOf(it)!=null),auto=known.reduce((a,it)=>a+qshipOf(it),0);
  const byQty=known.some(it=>qshipOf(it)!==qnum(it.ship))?' (수량별 送料 적용)':'';
  const autoNote=known.length<Q.items.length?(auto?`${yen(auto)}${byQty} · 일부 구매처 확인 후 변동 가능`:'구매처 확인 후 안내 (변동 가능)'):auto?yen(auto)+byQty:'무료 (送料込み)';
  const own=qnum(Q.adj.ship);return {auto,autoNote,yen:own??auto,note:Q.adj.shipNote||(own!=null?yen(own):autoNote)}}
function qfee(){const sh=qship(),{fee,note,short}=qfeeAll(sh.yen),own=qnum(Q.adj.fee);
  return {auto:fee,autoNote:fee?`${yen(fee)} · ${note}`:'',yen:own??fee,note:Q.adj.feeNote||(own!=null?yen(own):fee?`${yen(fee)} · ${short}`:'')}}
function qrows(){const r=qrate(),out=[];
  if(Q.type==='구매'&&Q.items.length){
    Q.items.forEach((it,i)=>{if(qnum(it.price))out.push({k:'p'+i,name:(it.title||'상품').slice(0,40),qty:qnum(it.qty)||1,unit:Math.round(qnum(it.price)*r),note:it.note||yen(it.price)})});
    const sh=qship();out.push({k:'ship',name:'현지배송비',qty:1,unit:Math.round(sh.yen*r),note:sh.note});
    const f=qfee();if(f.yen)out.push({k:'fee',name:'구매수수료',qty:1,unit:Math.round(f.yen*r),note:f.note})}
  Q.lines[Q.type].forEach((l,i)=>{if(l[2]!==''&&qnum(l[2])!=null)out.push({k:'l'+i,name:l[0],qty:qnum(l[1])||1,unit:qnum(l[2]),note:l[3]})});
  return out}
// The document, laid out like a Japanese 見積書: title 見積書, the customer's name + 様 on the left and the date on the right
// of the first line, then the quote facts beside the company block with its seal, then 항목 (상품명) · 수량 · 단가 · 비고 and
// one 총 합계. Labels are Korean only (the company's katakana name stays). 단가 already include 부가세: no 부가세 line.
const qdate=()=>{const [y,m,d]=qtoday().split('-').map(Number);return `${y}年 ${m}月 ${d}日`};
// A4 pages (760 × 1075px = 210 × 297mm). Page 1 carries the title, customer, 견적번호 and the company block; a later page
// starts with a short 見積書 (계속) line. Rows fill each page until it would overflow; the last page ends with 총 합계,
// 입금안내 and the fine print, and its spare space gets ruled blank rows like the Excel template. More rows -> more pages.
const QPAGE_H=1075;
function qhead(first,I,sup,page,pages){
  if(!first)return `<div class="qd-cont"><b>見積書</b> <span>(계속)</span><span class="qd-contno">${esc($('#qTo').value.trim())} 様 · 견적번호 ${esc(Q.no||'(제작 시 발급)')}</span></div>`;
  return `<h2 class="qd-title">見積書</h2>
    <div class="qd-line"><div class="qd-to"><span class="qd-toname">${esc($('#qTo').value.trim()||'　')}</span><span class="qd-sama">様</span></div>
      <div class="qd-date">${esc(qdate())}</div></div>
    <div class="qd-top"><div class="qd-left">
      <table class="qd-meta"><tr><th>견적번호</th><td>${esc(Q.no||'(제작 시 발급)')}</td></tr>
        ${Q.type==='구매'?`<tr><th>적용 환율</th><td>¥100 = ₩${(Math.round(qrate()*10000)/100).toLocaleString('ko-KR',{maximumFractionDigits:2})}</td></tr>`:''}</table>
      <p class="qd-say">아래와 같이 견적합니다</p></div>
      <div class="qd-co"><div class="qd-coname">${esc(sup['상호명']||'우마이직구')} <span class="qd-ja">${esc(I.nameJa||'')}</span>${I.stamp?`<img class="qd-stamp" src="${I.stamp}" alt="">`:''}</div>
        <p>${esc(sup['사업장주소']||'')}</p><p>tel ${esc(sup['전화번호']||'')}</p>
        <p>사업자등록번호 ${esc(sup['사업자등록번호']||'')} · ${esc(sup['업태']||'')}</p>
        <p class="qd-rep">대표 ${esc(sup['대표자']||'')}</p></div></div>`}
function qpage(o){const {I,sup,rows,from,last,blank,total,page,pages}=o;
  const body=rows.map((x,k)=>`<tr><td>${from+k+1}</td><td class="qd-item">${esc(x.name)}</td><td>${x.qty}</td><td>₩${won(x.unit)}</td><td class="qd-note">${esc(x.note||'')}</td></tr>`).join('')||
    (last&&!from?'<tr><td colspan="5" class="qd-empty">항목이 없어요</td></tr>':'');
  return `<div class="q-doc">${qhead(page===1,I,sup,page,pages)}
    <table class="qd-items"><thead><tr><th>구분</th><th>항목</th><th>수량</th><th>단가</th><th>비고</th></tr></thead><tbody>${body}${
      '<tr class="qd-blank"><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(blank)}${
      last?`<tr class="qd-total"><td colspan="2">총 합계</td><td colspan="2">₩${won(total)}</td><td>입금하실 금액</td></tr>`:''}</tbody></table>
    ${last?`<div class="qd-bottom"><div class="qd-foot"><div class="qd-bank"><b>입금안내</b><span>${esc(I.bank||'')}<br>예금주 : ${esc(I.holder||'')}</span></div></div>
    <p class="qd-fine">※ ${esc(QNOTE[Q.type])}</p></div>`:'<div class="qd-bottom"></div>'}
    ${pages>1?`<p class="qd-pageno">${page} / ${pages}</p>`:''}</div>`}
function qdoc(){const I=D.quoteInfo||{},rows=qrows(),total=rows.reduce((a,x)=>a+x.qty*x.unit,0),sup=Object.fromEntries(I.supplier||[]);
  // measure in an off-screen copy of the preview: does this page's content still fit in one A4 sheet?
  const m=qdoc.m||(qdoc.m=Object.assign(document.createElement('div'),{className:'q-pages q-measure'}));if(!m.isConnected)document.body.appendChild(m);
  const fits=o=>{m.innerHTML=qpage({...o,pages:2});const d=m.firstElementChild;return d.scrollHeight<=QPAGE_H+1};
  const parts=[];let i=0;
  for(let guard=0;guard<60;guard++){const page=parts.length+1,base={I,sup,from:i,total,page,blank:0};
    if(fits({...base,rows:rows.slice(i),last:true})){parts.push({from:i,rows:rows.slice(i),last:true});break}
    let j=i+1;while(j<rows.length&&fits({...base,rows:rows.slice(i,j+1),last:false}))j++;
    if(j>=rows.length){   // the rest fits without 총 합계 but not with it: share it between this page and the last one
      const rest=rows.length-i;let k=1;   // k = rows the last page holds above 총 합계
      while(k<rest-1&&fits({I,sup,from:rows.length-k-1,total,page:page+1,blank:0,rows:rows.slice(rows.length-k-1),last:true}))k++;
      j=Math.max(i+1,rows.length-Math.min(k,Math.ceil(rest/2)))}
    parts.push({from:i,rows:rows.slice(i,j),last:false});i=j}
  const L=parts.at(-1);let blank=0;   // ruled blank rows on the last page, up to 12 lines in all on a single page
  const cap=parts.length===1?Math.max(0,12-Math.max(rows.length,1)):40;
  while(blank<cap&&fits({I,sup,...L,total,page:parts.length,blank:blank+1}))blank++;
  L.blank=blank;m.innerHTML='';
  const pages=parts.length;Q.page=Math.min(Q.page||1,pages);
  $('#qDoc').innerHTML=parts.map((x,k)=>qpage({I,sup,total,blank:0,...x,page:k+1,pages})).join('');
  $('#qDoc').querySelectorAll('.q-doc').forEach((d,k)=>d.classList.toggle('qd-off',k+1!==Q.page));
  $('#qPager').classList.toggle('hidden',pages<2);$('#qPageNo').textContent=`${Q.page} / ${pages} 페이지`;
  if($('#qTable tbody'))qkrw();
  return {sub:total,vat:0,total,pages}}
$('#qPager').addEventListener('click',e=>{const b=e.target.closest('[data-qpg]');if(!b)return;
  const n=$('#qDoc').children.length;Q.page=Math.min(n,Math.max(1,(Q.page||1)+ +b.dataset.qpg));qdoc()});
// one page as a PNG blob (pages the pager hides are shown just for the capture)
async function qpng(k){const d=$('#qDoc').children[k],off=d.classList.contains('qd-off');d.classList.remove('qd-off');
  try{const c=await (await loadH2C())(d,{scale:2,backgroundColor:'#ffffff',logging:false});return await new Promise(r=>c.toBlob(r,'image/png'))}
  finally{if(off)d.classList.add('qd-off')}}
$('#qCopyPage').onclick=async()=>{const k=(Q.page||1)-1;
  try{await navigator.clipboard.write([new ClipboardItem({'image/png':qpng(k)})]);toast(`${k+1}페이지를 복사했어요. 카카오톡에 붙여넣기 하면 돼요.`)}catch{toast('복사하지 못했어요. 저장된 파일을 보내 주세요.')}};
// 비슷한 지난 견적 (D.quoteExamples, the staff sheet without names): same shop or shared words in the item name, newest
// first. Shows what we charged for 현지배송비·수수료 and the size, so staff can judge an unknown 送料.
const qwords=t=>new Set(String(t||'').toLowerCase().match(/[a-z0-9]{3,}|[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]{2,}/g)||[]);
function qpast(it){const E=D.quoteExamples||[];if(!E.length||!(it.title||it.url))return '';
  const dom=(it.url.match(/^https?:\/\/(?:www\.)?([^/]+)/)||[])[1]||'',w=qwords(it.title);
  const k=qkey(it.url||'');const score=x=>{let n=x.url&&qkey(x.url)===k?20:0;for(const t of qwords(x.title+' '+x.item))if(w.has(t))n+=2;if(dom&&x.url.includes(dom))n+=1;if(x.ship)n+=.5;return n};
  const top=E.map(x=>[score(x),x]).filter(([n])=>n>=2).sort((a,b)=>b[0]-a[0]||b[1].d.localeCompare(a[1].d)).slice(0,it.shop==='ticket'?6:3);
  if(!top.length)return '';
  return `<details class="q-past"><summary>비슷한 지난 견적 ${top.length}건</summary>${top.map(([,x])=>`<div>${esc(x.d.slice(5))} · ${esc(x.shop)} · ${esc(x.item)}${x.size?` <span class="muted">(${esc(x.size.slice(0,60))})</span>`:''}<br>`+
    `상품 ${yen(x.price)}${x.qty>1?` ×${x.qty}`:''} · 현지배송비 ${x.ship!=null?yen(x.ship):'—'} · 수수료 ${x.fee!=null?yen(x.fee):'—'}${x.rate?` · 환율 ${x.rate}`:''}`+
    `${x.ship!=null?` <button type="button" class="mini" data-qship="${x.ship}">배송비 적용</button>`:''}</div>`).join('')}</details>`}
// 배송비 견적서 (user, 2026-10-30). A 배송비 quote is needed once a bought item reached the 일본 센터 and was put in the
// 팬스타 ERP, so 수신 lists that customer's ERP shipments (D.shipQuote.recent, ship_quote.py) to pick from. Each picked
// shipment is priced by the rules:
//   해외배송비  해운 요금표 column C (엔) at the ERP W/T × the 우마이직구 적용환율 of its 주문일자
//   사이즈오버  per box by 세변합: <180 none · 180–199 1.5만 … 291–300+ 5만;  입고비 per box: ≥180 5만 · ≥300 10만
//   재포장      what staff charged for the most similar past shipment, else the usual amount for the item type
//   국내화물    경동택배 표준운임 (택배, 경남권 → 고객 권역, 박스마다, 무게는 올림 정수): max(부피 운임, 무게 운임) ×
//               (1 + 권역 %), 100원 반올림, from kdexp.com's own tables (D.shipQuote.kd; matched its calculator 40/40)
// The box is bigger than the product: the page's 梱包 size when known, else product size + the padding learned from
// past shipments, else a guess from the weight. Staff see the basis of every number and can change it before [넣기].
const SQ=()=>D.shipQuote||{};
const qsNames=t=>[...new Set((String(t).match(/[가-힣]{2,5}|[A-Za-z]{3,}/g)||[]).filter(w=>!/^(주식회사|상점|님|고객|사업자|개인)$/.test(w)))];
function qsCands(){const to=$('#qTo').value,ns=qsNames(to);if(!ns.length)return [];
  return (SQ().recent||[]).filter(r=>{const n=String(r.name||'').replace(/\s/g,'');return ns.some(w=>n===w||n.includes(w)&&w.length>=3)})
    .sort((a,b)=>b.date.localeCompare(a.date)||b.order.localeCompare(a.order)).slice(0,20)}
const qsYen=kg=>{const F=SQ().fee||[];for(const [to,y] of F)if(kg<=to+1e-9)return y;if(F.length<2)return 0;
  const [a,ya]=F.at(-2),[b,yb]=F.at(-1);return Math.round(yb+(yb-ya)*(kg-b)/(b-a))};
const qsOverFee=s=>{let f=50000;for(const [upto,v] of SQ().over||[])if(s<upto)return v;return f};
const qsIn=s=>s>=300?100000:s>=180?50000:0;
function qsKd(to,d,kg){const K=SQ().kd;if(!K)return null;const at=(T,x)=>(T.find(([u])=>x<=u)||T.at(-1))[1];
  const base=Math.max(at(K.vol,d[0]*d[1]*d[2]),at(K.kg,Math.ceil(kg)));return Math.round(base*(100+(K.region[to]??25))/100/100)*100}
// rate per 100엔 → per 엔. The 접수창구 log (qsRate.log) wins, then the rates staff's own past 해외배송비 imply.
function qsRate(date){const all={...Object.fromEntries(Object.entries(SQ().rates||{}).map(([d,r])=>[d,r*100])),...(qsRate.log||{})};
  if(all[date])return {r:all[date]/100,note:`${date} 적용환율`};
  const prev=Object.keys(all).filter(d=>d<=date).sort().pop(),any=Object.keys(all).sort().pop();
  const d=prev||any;return d?{r:all[d]/100,note:`${d} 적용환율${d!==date?` (${date} 기록 없음, 가장 가까운 날)`:''}`}:{r:0,note:'환율 기록 없음 — 직접 넣어 주세요'}}
async function qsLoadRates(){if(qsRate.log||!D.smsIntake)return;try{const r=await (await fetch(`${D.smsIntake}?action=siteRate`)).json();if(r.ok)qsRate.log=r.rates}catch{}}
// The box: the page's 梱包 size, else product size + learned padding, else the 세변합 band staff charged for the most
// similar past shipment, else 세변합 from the weight per box (fit on past shipments). Shape 1.6 : 1 : 0.7 when only the
// 세변합 is known.
const qsWords=t=>new Set(String(t||'').toLowerCase().match(/[a-z0-9]{2,}|[぀-ヿ一-鿿가-힣]{2,}/g)||[]);
// past shipments by shared item words (2+ words, or the same product link)
function qsSimilar(r,has){const w=qsWords(r.item+' '+r.buyItem);
  return (SQ().past||[]).filter(has).map(x=>{let n=0;for(const t of qsWords(x.item+' '+x.erpItem))if(w.has(t))n++;if(r.url&&x.url&&x.url===r.url)n+=5;return [n,x]})
    .filter(([n])=>n>=2).sort((a,b)=>b[0]-a[0])[0]}
const qsShape=s=>[1.6,1,0.7].map(k=>Math.round(s*k/3.3));
function qsBox(r){const sp=r.spec||{},M=SQ().model||{},pad=M.padCm||6,b=r.boxes||1;
  if(sp.pdims)return {d:sp.pdims.map(Math.round),why:'상품 페이지 梱包 사이즈'};
  if(sp.dims)return {d:sp.dims.map(x=>Math.round(x+pad)),why:`상품 사이즈 ${sp.dims.join('×')}cm + 포장 ${pad}cm (지난 배송에서 배운 값)`};
  const sim=qsSimilar(r,x=>x.sum);
  if(sim)return {d:qsShape(sim[1].sum),why:`비슷한 지난 배송 "${sim[1].item}"의 사이즈오버로 본 세변합 약 ${sim[1].sum}cm — 꼭 확인해 주세요`};
  const s=Math.round((M.sumA??60)+(M.sumB??60)*Math.cbrt(r.kg/b));
  return {d:qsShape(s),why:`상품 사이즈를 몰라 박스당 무게 ${Math.round(r.kg/b*10)/10}kg로 추정 (지난 ${M.sumN||0}건 기준) — 꼭 확인해 주세요`}}
function qsRepack(r){const top=qsSimilar(r,x=>x.re!=null);
  if(top)return {v:top[1].re,why:`비슷한 지난 배송 "${top[1].item}"에 ${won(top[1].re)}원`};
  const t=Object.entries(SQ().retype||{}).find(([,v])=>new RegExp(v.rx,'i').test(r.item+' '+r.buyItem));
  return t?{v:t[1].median,why:`${t[0]} 재포장 보통 ${won(t[1].median)}원 (지난 ${t[1].n}건)`}:{v:0,why:'비슷한 지난 배송이 없어요 — 판단해 넣어 주세요'}}
const QAREA=['수도권','경남권','경북권','전남권','충청권','강원권','전북권','제주권'];
function qsList(){const box=$('#qShipList'),C=qsCands();Q.ship=Q.ship||[];
  if(!SQ().recent){box.innerHTML='<p class="small bad">배송비 데이터가 아직 없어요 (Claude가 ERP 기록을 모으면 나와요).</p>';return}
  if(!qsNames($('#qTo').value).length){box.innerHTML='';return}
  if(!C.length){box.innerHTML=`<p class="small muted">"${esc($('#qTo').value.trim())}" 이름으로 최근 75일 ERP 화물을 찾지 못했어요. 이름을 ERP 수취인과 같게 넣어 보세요.</p>`;return}
  box.innerHTML=`<p class="small"><b>${C.length}건</b> · ERP 수취인 이름이 같은 화물 (최근 순) — 견적이 필요한 것을 고르세요</p>`+C.map(r=>{const on=Q.ship.some(x=>x.order===r.order);
    return `<label class="qs-c${on?' on':''}"><input type="checkbox" data-qs="${esc(r.order)}"${on?' checked':''}><span><b>${esc(r.buyItem||r.item)}</b>${r.buyItem?` <span class="muted">(${esc(r.item)})</span>`:''}<br>`+
      `<span class="small muted">${esc(r.date.slice(5))} 주문 · ${esc(r.order)} · ${r.kg}kg · ${r.boxes}박스 · ${esc(r.status)}${r.region?' · '+esc(r.region):''}</span></span></label>`}).join('')}
function qsPick(order,on){const r=(SQ().recent||[]).find(x=>x.order===order);if(!r)return;Q.ship=(Q.ship||[]).filter(x=>x.order!==order);
  if(on){const bx=qsBox(r),rp=qsRepack(r);Q.ship.push({order,date:r.date,item:r.buyItem||r.item,kg:r.kg,boxes:r.boxes||1,dims:bx.d.join('×'),dimsWhy:bx.why,
    re:rp.v,reWhy:rp.why,region:r.region||'수도권'})}
  qsCalc();qsave()}
function qsCalc(){const S=Q.ship||[];$('#qShipAuto').classList.toggle('hidden',!S.length);
  $('#qShipCalc').innerHTML=S.length?`<div class="tablewrap"><table class="q-edit qs-calc"><thead><tr><th>화물</th><th>W/T kg</th><th>박스</th><th>박스 크기 cm (가로×세로×높이)</th><th>재포장 ₩</th><th>도착 권역</th></tr></thead><tbody>`+
    S.map((x,i)=>`<tr data-qsi="${i}"><td class="small"><b>${esc(x.item)}</b><br><span class="muted">${esc(x.order)}</span></td><td><input data-s="kg" class="q-num" inputmode="decimal" value="${esc(x.kg)}"></td>`+
      `<td><input data-s="boxes" class="q-num" inputmode="numeric" value="${esc(x.boxes)}"></td><td><input data-s="dims" value="${esc(x.dims)}"><div class="small muted">${esc(x.dimsWhy)}</div></td>`+
      `<td><input data-s="re" class="q-num" inputmode="numeric" value="${esc(x.re)}"><div class="small muted">${esc(x.reWhy)}</div></td>`+
      `<td><select data-s="region">${QAREA.map(a=>`<option${a===x.region?' selected':''}>${a}</option>`).join('')}</select></td></tr>`).join('')+'</tbody></table></div>':''}
async function qsFill(){const S=Q.ship||[],msg=t=>$('#qShipMsg').textContent=t;if(!S.length)return;
  const b=$('#qShipAuto');b.disabled=true;msg('계산하는 중…');await qsLoadRates();
  const lines=[],many=S.length>1,tag=x=>many?` (${x.item.slice(0,14)})`:'';
  try{for(const x of S){const kg=qnum(x.kg)||0,n=Math.max(1,qnum(x.boxes)||1),d=String(x.dims).split(/[x×*,\s]+/).map(Number).filter(v=>v>0);
    if(d.length!==3)throw Error(`${x.item}: 박스 크기를 가로×세로×높이로 넣어 주세요`);
    const sum=d[0]+d[1]+d[2],y=qsYen(kg),rt=qsRate(x.date);
    lines.push(['해외배송비'+tag(x),1,Math.round(y*rt.r),`W/T ${kg}kg · ¥${y.toLocaleString()} × ${(rt.r*100).toFixed(1)}원/100엔 (${rt.note})`]);
    const ov=qsOverFee(sum);if(ov)lines.push(['사이즈오버'+tag(x),n,ov,`세변합 ${sum}cm`]);
    const inn=qsIn(sum);if(inn)lines.push(['입고비'+tag(x),n,inn,`세변합 ${sum}cm (${sum>=300?'300':'180'}cm 이상)`]);
    if(qnum(x.re))lines.push(['재포장'+tag(x),1,qnum(x.re),'포장 상태에 따라 변동 가능']);
    const one=qsKd(x.region,d,kg/n),dom=one==null?null:one*n;
    lines.push(['국내화물 택배비'+tag(x),1,dom??'',dom!=null?`경동택배 경남권→${x.region} · ${n}박스 × ${won(one)}원 (박스당 ${Math.ceil(kg/n)}kg)`:'경동택배 운임표가 없어요 — 직접 넣어 주세요'])}
    Q.lines['배송']=lines;Q.no='';qeditors();qsave();msg(`견적 항목 ${lines.length}줄을 넣었어요. 환율·크기·재포장은 비고의 근거를 보고 고쳐 주세요.`)}
  catch(e){msg(e.message||'계산하지 못했어요.')}finally{b.disabled=false}}
$('#qShipList').addEventListener('change',e=>{const c=e.target.closest('[data-qs]');if(c)qsPick(c.dataset.qs,c.checked),qsList()});
$('#qShipCalc').addEventListener('input',e=>{const el=e.target.closest('[data-s]'),tr=el&&el.closest('[data-qsi]');if(!tr)return;Q.ship[+tr.dataset.qsi][el.dataset.s]=el.value;qsave()});
$('#qShipCalc').addEventListener('change',e=>{const el=e.target.closest('select[data-s]'),tr=el&&el.closest('[data-qsi]');if(tr){Q.ship[+tr.dataset.qsi].region=el.value;qsave()}});
$('#qShipAuto').onclick=qsFill;
// The editor is laid out like the document: 구분 · 항목 (상품명) · 수량 · 단가 · 비고. 상품가·현지배송비·구매수수료 are typed
// in 엔 (the 원 환산 column shows the 원 the document will print); added rows are in 원. Each product's reading status and
// 비슷한 지난 견적 sit in a thin row under it.
const qin=(f,v,o={})=>`<input data-f="${f}" value="${esc(v??'')}"${o.num?' inputmode="numeric" class="q-num"':''}${o.ph?` placeholder="${esc(o.ph)}"`:''}>`;
function qeditors(){
  $('#qBuy').classList.toggle('hidden',Q.type!=='구매');$('#qAddItem').classList.toggle('hidden',Q.type!=='구매');
  if($('#qShipBox').classList.toggle('hidden',Q.type!=='배송')===false){qsList();qsCalc();qsLoadRates()}
  let n=0;const rows=[];
  if(Q.type==='구매'){
    Q.items.forEach((it,i)=>{rows.push(`<tr data-qi="${i}"><td class="q-n">${++n}</td><td><textarea data-f="title" rows="2" class="q-title" placeholder="상품명">${esc(it.title||'')}</textarea></td><td>${qin('qty',it.qty??1,{num:1})}</td><td><span class="q-cur">¥</span>${qin('price',it.price,{num:1,ph:'1개 가격'})}<div class=\"q-krw\" data-krw=\"${'p'+i}\"></div></td><td>${qin('note',it.note,{ph:qnum(it.price)?yen(it.price):'비고'})}</td><td><button type="button" class="mini" data-qdel="${i}" aria-label="삭제">✕</button></td></tr>`);
      const st=it.state?`<div class="small q-st ${it.state==='fail'?'bad':it.state==='wait'?'wait':''}">${esc(it.msg||'')}</div>`:'',past=qpast(it,i);
      if(st||past||it.url)rows.push(`<tr class="q-sub" data-qi="${i}"><td></td><td colspan="5">${it.url?`<a class="small muted q-link" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url.replace(/^https?:\/\/(www\.)?/,'').slice(0,60))} ↗</a>`:''}${st}${past}</td></tr>`)});
    if(!Q.items.length)rows.push('<tr><td></td><td colspan="5" class="muted small">링크를 넣고 [자동 견적]을 누르거나, [+ 상품 추가]로 직접 넣으세요.</td></tr>');
    const sh=qship(),f=qfee();
    rows.push(`<tr data-qa="ship" class="q-fixed"><td class="q-n">${++n}</td><td>현지배송비</td><td>1</td><td><span class="q-cur">¥</span>${qin('ship',Q.adj.ship,{num:1,ph:Q.items.some(it=>qnum(it.ship)!=null)?'자동 '+sh.auto.toLocaleString():'모름'})}<div class=\"q-krw\" data-krw=\"${'ship'}\"></div></td><td>${qin('shipNote',Q.adj.shipNote,{ph:sh.autoNote})}</td><td>${Q.adj.ship||Q.adj.shipNote?'<button type="button" class="mini" data-qauto="ship" title="자동 값으로">↺</button>':''}</td></tr>`);
    rows.push(`<tr data-qa="fee" class="q-fixed"><td class="q-n">${++n}</td><td>구매수수료</td><td>1</td><td><span class="q-cur">¥</span>${qin('fee',Q.adj.fee,{num:1,ph:f.auto?'자동 '+f.auto.toLocaleString():'자동'})}<div class=\"q-krw\" data-krw=\"${'fee'}\"></div></td><td>${qin('feeNote',Q.adj.feeNote,{ph:f.autoNote||'상품 가격을 넣으면 계산돼요'})}</td><td>${Q.adj.fee||Q.adj.feeNote?'<button type="button" class="mini" data-qauto="fee" title="자동 값으로">↺</button>':''}</td></tr>`)}
  Q.lines[Q.type].forEach((l,i)=>rows.push(`<tr data-ql="${i}"><td class="q-n">${++n}</td><td>${qin('0',l[0],{ph:'항목'})}</td><td>${qin('1',l[1],{num:1})}</td><td><span class="q-cur">₩</span>${qin('2',l[2],{num:1,ph:'비우면 제외'})}<div class=\"q-krw\" data-krw=\"${'l'+i}\"></div></td><td>${qin('3',l[3],{ph:'비고'})}</td><td><button type="button" class="mini" data-qldel="${i}" aria-label="삭제">✕</button></td></tr>`));
  $('#qTable').innerHTML='<thead><tr><th>구분</th><th>항목</th><th>수량</th><th>단가</th><th>비고</th><th></th></tr></thead><tbody>'+rows.join('')+'</tbody>';
  qdoc()}
// 원 환산 cells follow every keystroke without redrawing the inputs.
function qkrw(){const m=Object.fromEntries(qrows().map(x=>[x.k,x]));
  document.querySelectorAll('#qTable [data-krw]').forEach(td=>{const x=m[td.dataset.krw];td.textContent=x?'= ₩'+won(x.qty*x.unit):''});
  document.querySelectorAll('#qTable tr[data-qi]:not(.q-sub) [data-f="note"]').forEach(el=>{const it=Q.items[+el.closest('tr').dataset.qi];if(it)el.placeholder=qnum(it.price)?yen(it.price):'비고'});
  for(const [k,f] of [['ship',qship],['fee',qfee]]){const tr=document.querySelector(`#qTable tr[data-qa="${k}"]`);if(!tr)continue;const v=f();
    tr.querySelector('[data-f="'+k+'"]').placeholder=v.auto?'자동 '+v.auto.toLocaleString():k==='ship'?'모름':'자동';tr.querySelector('[data-f="'+k+'Note"]').placeholder=v.autoNote||''}}
function qsave(){try{localStorage.setItem(QKEY,JSON.stringify({type:Q.type,items:Q.items.map(({state,msg,...x})=>x),lines:Q.lines,no:Q.no,adj:Q.adj,ship:Q.ship||[],
  to:$('#qTo').value,links:$('#qLinks').value,grade:$('#qGrade').value,rate:$('#qRate').value,rateManual:Q.rateManual}))}catch{}}
function qreset(keepType){Q.items=[];Q.adj=QADJ();Q.ship=[];Q.lines={'구매':QLINES['구매'].map(l=>[...l]),'배송':QLINES['배송'].map(l=>[...l])};Q.no='';
  $('#qTo').value='';$('#qLinks').value='';$('#qAutoMsg').textContent='';$('#qMakeMsg').textContent='';if(!keepType)Q.type='구매';
  document.querySelectorAll('[data-qtype]').forEach(b=>b.classList.toggle('on',b.dataset.qtype===Q.type));qeditors();qsave()}
async function qloadRate(force){if(!force&&qnum($('#qRate').value))return;
  // 적용 환율 = 시장 환율 × 1.02: what 2026 quotes used (applied ÷ market, monthly median 1.018–1.021 since August)
  try{const r=await (await fetch('https://open.er-api.com/v6/latest/JPY')).json();const v=r.rates&&r.rates.KRW;if(!v)throw 0;
    $('#qRate').value=(Math.round(v*1.02*100)/100).toString();
    $('#qRateNote').textContent=`시장 환율 ¥100 = ₩${(v*100).toFixed(0)} × 1.02 → ¥100 = ₩${Math.round(qrate()*100)} (${new Date(r.time_last_update_unix*1e3).toLocaleDateString('ko-KR')} 기준, 지난 견적과 같은 방식). 필요하면 고쳐 주세요.`;qdoc();qsave()}
  catch{$('#qRateNote').textContent='환율을 불러오지 못했어요. 직접 넣어 주세요.'}}
function qinit(){if(qinit.done||!D)return;qinit.done=true;
  let s=null;try{s=JSON.parse(localStorage.getItem(QKEY)||'null')}catch{}
  qreset();if(s){Object.assign(Q,{type:s.type||'구매',items:s.items||[],lines:s.lines||Q.lines,no:s.no||'',adj:{...QADJ(),...s.adj},ship:s.ship||[]});
    $('#qTo').value=s.to||'';$('#qLinks').value=s.links||'';$('#qGrade').value=['normal','biz','fix1500','fix2000'].includes(s.grade)?s.grade:'normal';Q.rateManual=!!s.rateManual;if(Q.rateManual)$('#qRate').value=s.rate||''}
  document.querySelectorAll('[data-qtype]').forEach(b=>b.classList.toggle('on',b.dataset.qtype===Q.type));qeditors();qsave();qloadRate()}
// One link -> 접수창구, which reads most shops itself in 3–15 s (the shop's own page speed: 라쿠텐 ~10 s, 이케아 ~3 s).
// A link it cannot read (메루카리·아마존) waits for Claude on the Mac, polled every 5 s for up to 15 minutes. While a link
// is out, its row shows a live timer and how long that step usually takes; only the status text is redrawn, so typing in
// the other fields is not interrupted.
const QWAIT={read:[3,15,'쇼핑몰 페이지를 읽는 중'],claude:[60,180,'Claude가 링크를 열어 확인하는 중'],ship:[60,180,'Claude가 상세페이지에서 현지배송비 확인 중']};
const mmss=s=>s>=60?`${Math.floor(s/60)}분`+(s%60?` ${s%60}초`:''):`${s}초`;
// While links are out, a model of each product's type (made in Blender: vesta-tools/quote-models.blend -> models/*.glb)
// turns slowly in the middle of the screen. The type comes from words in the link and product name; anything else is a
// parcel box. Several links take turns every 6 s. model-viewer is loaded from the CDN the first time it is needed.
const Q3D=[['wallclock','벽시계',/clock|クロック|掛け?時計|置き?時計|目覚まし|벽시계|벽걸이 ?시계|탁상 ?시계/],
  ['watch','손목시계',/watch|ウォッチ|ウオッチ|時計|시계|seiko|rolex|\bcasio|g-?shock|citizen|omega|richard-?mille|hamilton|longines|tissot|tudor/],
  ['stroller','유모차·카시트',/stroller|ベビーカー|유모차|buggy|バギー|カーシート|チャイルドシート|카시트|car-?seat/],
  ['helmet','헬멧',/helmet|ヘルメット|헬멧/],
  ['motorbike','오토바이',/motorcycle|motorbike|オートバイ|오토바이|honda|ホンダ|yamaha|kawasaki|カワサキ|ducati|agusta|アグスタ|スーパーフォア|フュージョン|scooter|スクーター|스쿠터|cb\d{3,4}/],
  ['car','자동차·미니카',/\bcar\b|自動車|자동차|차량|ミニカー|minicar|1\/18|1:18|ラジコン|rc ?(car|카)|rc자동차|toyota|トヨタ|nissan|日産|bmw|porsche|ポルシェ|mazda|lancia|スープラ|スカイライン|bumper|バンパー|범퍼|フロントガラス|スポイラー/],
  ['tire','타이어·휠',/tire|tyre|タイヤ|타이어|ホイール|휠|geolandar|mudstar/],
  ['lighter','라이터·담배',/lighter|ライター|라이터|zippo|ジッポ|dupont|デュポン|iqos|アイコス|아이코스|담배|タバコ|煙草|cigar|vape/],
  ['sofa','소파',/sofa|ソファ|소파|쇼파|togo|トーゴ|オットマン|ottoman|couch|カウチ|리네로제|ligne ?roset|リーンロゼ|마라룽가|maralunga|아르플렉스|arflex|드세데|de ?sede/],['chair','의자',/chair|チェア|椅子|의자|スツール|stool|체어|アームチェ|가리모쿠|カリモク|karimoku|텐도|天童|텍타|tecta|lafuma|칼한센|carl ?hansen|콘데 ?하우스|condehouse|飛騨/],
  ['bed','침대',/\bbed|ベッド|침대|mattress|マットレス|매트리스/],
  ['mirror','거울',/mirror|ミラー|거울|鏡|ドレッサー|dresser|드레서/],
  ['suitcase','캐리어',/suitcase|スーツケース|캐리어|rimowa|リモワ|trunk|トランク|트렁크|キャリー/],
  ['drawer','서랍장',/drawer|チェスト|\bchest|引出|引き出し|서랍|タンス|箪笥|수납장|ワゴン/],
  ['fridge','냉장고',/冷蔵|冷凍|refrigerator|fridge|냉장고|냉동|ショーケース|熟成庫/],
  ['table','테이블·선반',/table|テーブル|테이블|desk|デスク|책상|食卓|shelf|shelving|シェルフ|棚|선반|rack|(?<![ブト])ラック|収納/],['lamp','조명',/lamp|ランプ|照明|조명|akari|ライト|light/],
  ['bicycle','자전거',/bicycle|bike|自転車|자전거|cycle|surly|strider|電動アシスト|フォーク|ペダル|pedal/],
  ['sneaker','신발',/shoe|sneaker|スニーカー|靴|신발|운동화|nike|hoka|vans|adidas|new-?balance|asics|onitsuka|mexico ?66/],
  ['shirt','의류',/scarf|スカーフ|스카프/],
  ['bag','가방',/bag|バッグ|가방|tote|goyard|hermes|louis|wallet|財布|지갑|pouch|ポーチ|파우치/],
  ['ticket','티켓',/ticket|チケット|티켓|l-tike|t\.pia|eplus|fチケ/],
  ['cards','카드·복권',/card|カード|카드|pokemon|ポケモン|ポケカ|遊戯王|トレカ|booster|拡張パック|복권|宝くじ|lottery|loto/],
  ['figure','피규어·인형',/figure|フィギュア|피규어|인형|ぬいぐるみ|plush|doll|ドール|ねんどろいど|nendoroid|bandai|バンダイ|반다이|ドラえもん|도라에몽|一番くじ|이치방|ガンプラ|プラモ|ホビー|ソフビ|레진|resin|ヒロアカ/],
  ['keyring','키링·굿즈',/キーホルダー|keyring|key-?chain|키링|열쇠고리|アクスタ|アクリルスタンド|acrylic|아크릴|缶バッジ|뱃지|badge|ステッカー|sticker|스티커|シール|グッズ|굿즈|응원봉|ペンライト/],
  ['book','책·악보',/楽譜|악보|book|ブック|書籍|서적|도서|다이어리|diary|手帳|漫画|コミック|manga|雑誌|magazine/],
  ['guitar','악기',/guitar|ギター|악기|ベース|ukulele|ウクレレ|piano|ピアノ|楽器|esp ?snapper/],
  ['disc','CD·DVD',/\bcd\b|dvd|blu-?ray|ブルーレイ|レコード|vinyl|アルバム|album|음반/],
  ['racket','스포츠용품',/racket|ラケット|라켓|yonex|ヨネックス|tennis|テニス|badminton|卓球|탁구|golf|ゴルフ|釣|fishing|リール|낚시|ユニフォーム|유니폼/],
  ['drill','공구·기계',/drill|ドリル|インパクト|impact|드릴|工具|공구|ヤスリ|wrench|レンチ|makita|マキタ|農機|コンバイン|田植|クボタ|kubota|iseki|イセキ|エンジン|engine|엔진/],
  ['faucet','수전·싱크',/混合栓|水栓|faucet|수전|수도꼭지|蛇口|sink|シンク|싱크|세면대|洗面|개수대/],
  ['fan','선풍기',/扇風機|\bfan\b|선풍기|サーキュレーター|circulator/],
  ['pot','주방용품',/鍋|\bpot\b|냄비|フライパン|\bpan\b|le-?creuset|staub|ストウブ|kettle|ケトル|주방/],
  ['snack','식품·과자',/お菓子|菓子|snack|スナック|과자|food|食品|식품|食材|식자재|粉|밀가루|わさび|wasabi|와사비|梅|매실|海苔|茶|\btea\b|호지차|chocolate|チョコ|초콜|candy|飴|ラーメン|noodle|調味|sauce|ソース|소스|시즈닝|seasoning|coffee|コーヒー|커피|우유|milk|ミルク|케이크|cake|ケーキ/],
  ['bottle','술·음료',/whisky|whiskey|ウイスキー|위스키|焼酎|소주|sake|日本酒|酒|beer|ビール|맥주|wine|ワイン|와인|ハイボール|liquor|(^|\s)술/],
  ['cosmetic','화장품·헤어·영양제',/화장품|cosmetic|コスメ|化粧|skincare|lotion|ローション|serum|美容|shampoo|シャンプー|ヘア|hair|헤어|염색|탈색|ブリーチ|bleach|k\.?fix|ナプラ|napla|립스틱|lipstick|口紅|サプリ|supplement|영양제|ビタミン|vitamin|救心|医薬|perfume|香水|향수/],
  ['basket','바구니·러그',/basket|バスケット|바구니|かご|カゴ|籠|ラタン|rattan|\brug\b|ラグ(?!ジュ)|러그|カーペット|carpet|cushion|クッション|쿠션/],
  ['firepit','캠핑·화로대',/キャンプ|캠핑|\bcamping\b|焚.?火|화로|fire-?pit|outdoor|アウトドア|bbq|バーベキュー/],
  ['shirt','의류',/shirt|シャツ|셔츠|\btee\b|jacket|ジャケット|자켓|재킷|\bcoat\b|コート|pants|パンツ|바지|denim|デニム|jeans|ジーンズ|청바지|hoodie|パーカー|sweater|ニット|knit|scarf|スカーフ|스카프|ワンピース|의류|아동복|잠옷|socks|靴下|levi|arc.?teryx|アークテリクス|patagonia|mccoy/],
  ['vase','유리·도자기',/glass|グラス|花瓶|vase|陶器|도자기|유리|食器|器|cup|カップ|usuhari|그릇|tray|トレイ|タンブラー|tumbler|オブジェ/]];
// Shops that sell mostly one kind of thing, for links whose name is not known yet (메루카리 etc. are read later by Claude).
const Q3DSHOP=[[/ikea\./,'table'],[/l-tike|pia\.jp|eplus|ticket|fighters\.co/,'ticket'],[/tomiz|kanpai|sake|saketen/,'bottle'],
  [/beauty|cosme|azzurro|kfix/,'cosmetic'],[/yonex/,'racket'],[/hamiltonwatch|casio\.com|seiko|watch|shinzone/,'watch'],
  [/onitsuka|newbalance|hoka|nike\.com|adidas|asics/,'sneaker'],[/rimowa/,'suitcase'],[/hermes|louisvuitton|goyard/,'bag'],
  [/tokyobike|cycle|bike|strider/,'bicycle'],[/actus|karimoku|tendo|condehouse|carlhansen/,'chair'],[/ligne-?roset|cassina|arflex/,'sofa'],
  [/romapri/,'drawer'],[/zarahome|p-f-s|pfs/,'table'],[/receno/,'basket'],[/giants|uniform/,'shirt'],[/camping|snowpeak|coleman/,'firepit'],
  [/goodsmile|bandai|animate|toranoana/,'figure']];
// Nearest model: every clue votes — the page's product name (from the link) counts most, then the names staff gave the same
// link in past quotes, then words in the URL; a shop that sells one kind of thing decides only when nothing else does.
function q3dType(it){let u=String(it.url||'');try{u+=' '+decodeURIComponent(u)}catch{}u=u.toLowerCase();
  const past=qpastOf(it).slice(0,5).map(x=>`${x.item||''} ${x.title||''}`).join(' ');
  const clues=[[it.title,4],[it.hint,4],[past,2],[u,1]].map(([t,w])=>[String(t||'').toLowerCase(),w]).filter(([t])=>t.trim());
  let best=null,top=0;
  Q3D.forEach(c=>{const sc=clues.reduce((n,[t,w])=>n+(c[2].test(t)?w:0),0);if(sc>top){top=sc;best=c}});
  if(best)return best;
  const host=(u.match(/^https?:\/\/([^/\s]+)/)||[])[1]||'',sh=Q3DSHOP.find(([re])=>re.test(host)||re.test(u.slice(0,120)));
  return (sh&&Q3D.find(c=>c[0]===sh[1]))||['box','상품',null]}
function q3d(){const box=$('#q3d'),wait=Q.items.filter(x=>x.state==='wait');
  if(!wait.length){box.classList.add('hidden');q3d.off=false;return}
  if(q3d.off||$('#tabQuote').classList.contains('hidden')){box.classList.add('hidden');return}
  if(!q3d.lib){q3d.lib=document.createElement('script');q3d.lib.type='module';q3d.lib.src='https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';document.head.appendChild(q3d.lib)}
  const it=wait[Math.floor(Date.now()/6000)%wait.length],[key,name]=q3dType(it),v=$('#q3dView'),src=`models/${key}.glb`;
  if(v.getAttribute('src')!==src)v.setAttribute('src',src);
  const [,,what]=QWAIT[it.step||'read'];
  const pn=String(it.title||it.hint||'').replace(/\s+/g,' ').slice(0,28);
  $('#q3dCap').innerHTML=`<b>${esc(name)}</b>${pn?` <span class="q3d-pn">${esc(pn)}</span>`:''} · ${esc(what)}… ${mmss(Math.round((Date.now()-it.t0)/1000))}${wait.length>1?` · ${wait.length}개 확인 중`:''}`;
  box.classList.remove('hidden')}
$('#q3dHide').onclick=()=>{q3d.off=true;$('#q3d').classList.add('hidden')};
function qtick(){q3d();let busy=0;
  Q.items.forEach((it,i)=>{if(it.state!=='wait')return;busy++;
    const el=document.querySelector(`#qTable tr.q-sub[data-qi="${i}"] .q-st`);if(!el)return;
    const [lo,hi,what]=QWAIT[it.step||'read'],t=Math.round((Date.now()-it.t0)/1000);
    el.textContent=`${it.pre||''}⏳ ${what}… ${mmss(t)} 지남 · `+(t<lo?`보통 ${mmss(lo)}~${mmss(hi)}`:t<hi?`약 ${mmss(hi-t)} 남음`:it.step!=='read'?'조금 늦어지고 있어요 (최대 15분)':'곧 끝나요')});
  const b=$('#qAuto');b.disabled=!!busy;b.textContent=busy?`확인 중… (${Q.items.filter(x=>x.state&&x.state!=='wait').length}/${Q.items.filter(x=>x.state).length})`:'자동 견적';
  if(!busy){clearInterval(qtick.t);qtick.t=null;const ok=Q.items.filter(x=>x.state==='ok').length,bad=Q.items.filter(x=>x.state==='fail').length;
    if(ok+bad)$('#qAutoMsg').textContent=`끝났어요 · ${ok}개 채움${bad?` · ${bad}개는 직접 입력이 필요해요`:''}`}}
// Same product, same key (vesta-tools/quote_requests.py key()): 로치케·피아 event, 메루카리 item, 야후옥션 auction, else
// host + path. Links Claude read before (D.quoteMemory) and past purchases in the 구매 정리 sheet (D.quoteExamples) fill
// a row at once, so a slow shop is not waited on twice.
function qkey(url){try{const u=new URL(url.trim()),q=u.searchParams,h=u.hostname.replace(/^www\./,'');
  if(/l-tike\.com/.test(h)&&q.get('gLcode'))return `l-tike:${q.get('gLcode')}:${q.get('gPfKey')||''}`;
  if(/pia\.jp/.test(h)&&q.get('eventCd'))return 'pia:'+q.get('eventCd');
  let m=u.pathname.match(/\/item\/(m\d+)/);if(/mercari/.test(h)&&m)return 'mercari:'+m[1];
  m=u.pathname.match(/\/auction\/([a-z]?\d+)/);if(/auctions\.yahoo/.test(h)&&m)return 'yauc:'+m[1];
  return h+u.pathname.replace(/\/$/,'')}catch{return url}}
const qpastOf=it=>{const k=qkey(it.url);return (D.quoteExamples||[]).filter(x=>x.url&&qkey(x.url)===k)};
const qticketName=url=>{try{const q=new URL(url).searchParams;return (q.get('gPfName')||'').normalize('NFKC').trim()}catch{return ''}};
// true = the row is done without asking the 접수창구 (tickets, links Claude already read); false = fetch, maybe after a prefill.
function qprefill(it){const mem=(D.quoteMemory||{})[qkey(it.url)],past=qpastOf(it),last=past[0];
  if(it.shop==='ticket'){
    it.title=mem?.title||qticketName(it.url)||last?.item||'';it.state='ok';
    it.msg='티켓 · 좌석 등급마다 가격이 달라요. 고른 좌석의 1매 가격과 매수를 넣어 주세요.'+(past.length?` 같은 공연 지난 구매 ${past.length}건이 아래에 있어요.`:'');return true}
  // Remembered or past prices only get the row started: the current page is always read again, and qfill says if it moved.
  const prev=mem&&mem.price?{price:mem.price,ship:mem.ship,title:mem.title,when:`${mem.at.slice(5).replace('-','/')} 확인`}
    :last&&last.price?{price:last.price,ship:last.ship,title:last.title||last.item,when:`${last.d.slice(5).replace('-','/')} 구매`}:null;
  if(prev){Object.assign(it,{title:qshort(prev.title),price:prev.price,ship:prev.ship??'',prev});
    it.pre=`지난 가격 (${prev.when}) ${yen(prev.price)}로 먼저 채움 · 현재 가격 확인 중 · `}
  return false}
async function qfetchLink(it){
  const at=new Date().toISOString();Object.assign(it,{state:'wait',step:'read',t0:Date.now(),msg:''});qeditors();qtick();
  try{if(!D.smsIntake)throw Error('no intake');
    const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({kind:'quote',url:it.url,at})})).json();
    if(!r.ok)throw Error(r.error||'fail');
    if(r.status==='자동완료'&&r.result)return qfill(it,r.result);
    // 가격완료: the price is in now; Claude still opens the detail page for its 送料 (and any 수량별 rule)
    if(r.status==='가격완료'&&r.result){qfill(it,r.result);Object.assign(it,{state:'wait',step:'ship',t0:Date.now(),pre:`✓ 현재 가격 ${yen(r.result.price)} · `})}
    else{if(r.result?.title)it.hint=r.result.title;   // the script found the name but no price: the 3D model can match it now
      Object.assign(it,{step:'claude',t0:Date.now()})}
    qtick();
    for(;Date.now()-it.t0<15*60e3;){await new Promise(z=>setTimeout(z,5000));
      let q;try{q=await (await fetch(`${D.smsIntake}?action=quoteStatus&at=${encodeURIComponent(at)}`)).json()}catch{continue}
      if(q.status==='완료'&&q.result)return qfill(it,q.result);
      if(q.result?.title)it.hint=q.result.title;
      if(/^실패/.test(q.status||'')){const why=q.status.replace(/^실패:?\s*/,'');
        if(it.step==='ship'){it.state='ok';it.msg=`✓ 현재 가격 ${yen(it.price)} · 현지배송비는 읽지 못했어요 (${why}). 직접 확인해 주세요.`}
        else{it.state='fail';it.msg=`읽지 못했어요 (${why}). 직접 입력해 주세요.`}qeditors();return}}
    if(it.step==='ship'){it.state='ok';it.msg=`✓ 현재 가격 ${yen(it.price)} · 현지배송비는 15분 동안 답이 없어 직접 확인해 주세요.`;qeditors();return}
    it.state='fail';it.msg='15분 동안 답이 없어요. Claude가 꺼져 있을 수 있어요 — 직접 입력해 주세요.';qeditors()}
  catch(e){it.state='fail';it.msg=/invalid|no intake/.test(e.message)?'자동 견적 접수창구가 아직 연결되지 않았어요. 직접 입력해 주세요.':'링크를 보내지 못했어요. 직접 입력해 주세요.';qeditors()}
  finally{qtick()}}
// Shop titles are long keyword lists ("ソファー ウレタンソファー 1人掛け 2人掛け …"). The quote gets a short name: brackets,
// shop suffixes and "1円" openers dropped, then the model number (letters + digits, e.g. SFA-33GY, DW-5600) with the first
// words around it, at most ~28 characters. Staff can still edit it; the full title stays in it.fullTitle.
function qshort(t){t=String(t||'').replace(/【[^】]*】|\[[^\]]*\]|［[^］]*］|（[^）]*）|\([^)]*\)|≪[^≫]*≫|<[^>]*>/g,' ')
    .split(/\s+[-|｜／]\s+|\s*[|｜]\s*/)[0].replace(/^\s*((\d+円|送料無料|即決|新品|中古|美品|未使用|展示品|在庫あり)\s*)+/g,'').replace(/\s+/g,' ').trim();
  const w=t.split(' '),model=w.find(x=>/[A-Za-z]/.test(x)&&/\d/.test(x)&&x.length>=4&&!/^[WDHφ]?\d+(\.\d+)?(cm|mm|L|kg)?$/i.test(x)&&!/\d\s*[x×*]\s*\d/i.test(x));   // not a size like W1600 or 80x28x202
  let out=w.slice(0,2).join(' ');if(model&&!out.includes(model))out=(w[0]===model?model:w[0]+' '+model);
  for(const x of w.slice(2)){if((out+' '+x).length>28)break;if(out.length<14)out+=' '+x;else break}
  return out.slice(0,32)}
function qfill(it,r){if(!Q.items.includes(it))return;Object.assign(it,{fullTitle:r.title||it.fullTitle,title:it.title||qshort(r.title),price:r.price??it.price,ship:r.ship??it.ship,shipRule:r.shipRule??it.shipRule,shop:it.url?qshopOf(it.url):r.shop||it.shop||''});
  const took=it.t0?` (${mmss(Math.round((Date.now()-it.t0)/1000))})`:'';
  const moved=it.prev&&r.price&&r.price!==it.prev.price?` (지난 ${yen(it.prev.price)} → 지금 ${yen(r.price)}, 가격이 바뀌었어요)`:it.prev&&r.price?' (지난 가격과 같아요)':'';
  it.state='ok';it.msg=r.price?`✓ 현재 가격 확인${took}: ${yen(r.price)}${moved}${r.ship!=null?` · 현지배송비 ${yen(r.ship)}`:' · 현지배송비는 직접 확인해 주세요'}${r.shipNote?` (${r.shipNote})`:''}`:`가격을 찾지 못했어요. ${r.shipNote||'직접 입력해 주세요.'}`;
  if(!r.price){it.state='fail';if(it.prev)it.msg+=` 지난 가격 ${yen(it.prev.price)} (${it.prev.when})이 들어 있으니 현재 가격을 확인해 주세요.`}qeditors();qsave()}
// Each press starts a new 구매 견적서 from the links in the box: products and added rows are cleared and the next
// [견적서 제작] takes a new 견적번호. 수신, 등급 and 환율 stay, since staff usually set them just before pressing.
$('#qAuto').onclick=()=>{const urls=[...new Set($('#qLinks').value.split(/\s+/).filter(u=>/^https?:\/\/\S{4,}$/.test(u)))];
  if(!urls.length){$('#qAutoMsg').textContent='http로 시작하는 상품 링크를 넣어 주세요.';return}
  Q.items=urls.map(u=>({url:u,title:'',qty:1,price:'',ship:'',shop:qshopOf(u)}));Q.lines['구매']=[];Q.no='';Q.adj=QADJ();$('#qMakeMsg').textContent='';
  const todo=Q.items;
  $('#qAutoMsg').textContent=`새 견적서 · 링크 ${urls.length}개를 확인해요. 라쿠텐 같은 큰 쇼핑몰은 10초쯤 걸려요.`;
  todo.filter(it=>!qprefill(it)).forEach(qfetchLink);qeditors();qsave();if(!qtick.t)qtick.t=setInterval(qtick,1000);qtick()};
$('#qAddItem').onclick=()=>{Q.items.push({url:'',title:'',qty:1,price:'',ship:'',shop:''});qeditors();qsave()};
$('#qAddLine').onclick=()=>{Q.lines[Q.type].push(['',1,'','']);qeditors();qsave()};
$('#tabQuote').addEventListener('input',e=>{const el=e.target,tr=el.closest('tr');
  if(tr&&tr.dataset.qi!=null){Q.items[+tr.dataset.qi][el.dataset.f]=el.value}
  else if(tr&&tr.dataset.qa){Q.adj[el.dataset.f]=el.value}
  else if(tr&&tr.dataset.ql!=null)Q.lines[Q.type][+tr.dataset.ql][+el.dataset.f]=el.value;
  else if(el.id==='qRate')Q.rateManual=!!qnum(el.value);   // a rate staff typed is kept; otherwise today's is loaded
  else if(el.id==='qTo'){qguess();if(Q.type==='배송')qsList()}
  qdoc();qsave()});
$('#qGrade').addEventListener('change',()=>{Q.gradeManual=true;$('#qGradeNote').textContent='직원이 고른 등급이에요.';qdoc();qsave()});
// 고객 등급 guess from 수신: D.quoteCustomers (vesta-tools/quote_customers.py) holds names with evidence from the 우마이직구
// admin 회원 등급, 카카오 채널 이름 tags ("…/사업자") and the 구매 정리 sheet. A match sets the select unless staff picked
// one themselves for this 수신; no match leaves 일반 and says so. Several people with the name -> the note says 동명이인.
const QLV={normal:'일반',gold:'골드',vip:'VIP',biz:'사업자 회원'};
function qguess(){const to=$('#qTo').value.trim(),C=D.quoteCustomers||[],note=$('#qGradeNote');Q.gradeManual=false;
  if(!to){note.textContent='';return}
  const words=new Set(to.match(/[가-힣]{2,4}/g)||[]),box=((to.match(/(?:OF|WO)[-\s]?0*(\d{2,6})/i)||[])[1]||'');
  let hits=C.filter(e=>words.has(e.n)||(e.co&&e.co.length>1&&to.includes(e.co)));
  if(box&&hits.some(e=>e.box===box))hits=hits.filter(e=>e.box===box);   // 사서함 in 수신 picks the person
  note.className='small q-gradenote';
  if(!hits.length){$('#qGrade').value='normal';
    note.textContent='관리자 회원·카카오 채널·구매 정리 시트에서 이 이름을 못 찾아 일반으로 두었어요. 다르면 골라 주세요.';return}
  // staff tags (카카오 "/사업자", 시트 회사명) win over the site level; otherwise the admin level, 동명이인 noted
  const tagged=hits.find(e=>!e.src[0].startsWith('관리자')),admins=hits.filter(e=>e.src[0].startsWith('관리자'));
  const cnt={};admins.forEach(e=>cnt[e.lv]=(cnt[e.lv]||0)+1);
  const pick=tagged||admins.find(e=>e.lv==='biz')&&admins.length===1&&admins[0]||admins.slice().sort((x,y)=>(cnt[y.lv]||0)-(cnt[x.lv]||0))[0];
  $('#qGrade').value=pick.lv==='biz'?'biz':'normal';note.className='small q-gradenote hit';
  note.textContent=`추정: ${QLV[pick.lv||'normal']} · 근거: ${pick.src[0]}${tagged&&admins.length?` · 관리자 등급 ${[...new Set(admins.map(e=>QLV[e.lv]))].join('/')}`:''}`+
    (admins.length>1?` · 관리자에 같은 이름 ${admins.length}명 (${Object.entries(cnt).map(([k,v])=>QLV[k]+' '+v).join(', ')}) — 수신에 사서함 번호(OF/WO)를 넣으면 정확해요`:'')}
$('#tabQuote').addEventListener('click',e=>{const b=e.target.closest('[data-qdel],[data-qldel],[data-qtype],[data-qship],[data-qauto]');if(!b)return;
  if(b.dataset.qship!=null){Q.adj.ship=b.dataset.qship;Q.adj.shipNote=`${yen(b.dataset.qship)} · 예상 금액 (비슷한 지난 견적), 판매자 확인 후 변동 가능`;qeditors();qsave();return}
  if(b.dataset.qauto){Q.adj[b.dataset.qauto]='';Q.adj[b.dataset.qauto+'Note']='';qeditors();qsave();return}
  if(b.dataset.qdel!=null)Q.items.splice(+b.dataset.qdel,1);
  else if(b.dataset.qldel!=null)Q.lines[Q.type].splice(+b.dataset.qldel,1);
  else{Q.type=b.dataset.qtype;Q.no='';document.querySelectorAll('[data-qtype]').forEach(x=>x.classList.toggle('on',x===b))}
  qeditors();qsave()});
$('#qReset').onclick=()=>{if(confirm('입력한 내용을 지우고 새 견적을 시작할까요?'))qreset(true)};
$('#qMake').onclick=async()=>{const b=$('#qMake'),msg=t=>$('#qMakeMsg').textContent=t;
  if(!$('#qTo').value.trim()){msg('수신(고객 이름)을 먼저 넣어 주세요.');$('#qTo').focus();return}
  if(!qrows().length){msg('견적 항목이 없어요.');return}
  b.disabled=true;
  // The quote itself goes with its number (sheet 견적번호, column 견적 내용) so Claude can write the 구매 정리 row once the
  // customer says they paid; making the image again after edits updates it.
  const detail=()=>{const sh=qship(),f=qfee(),{total}=qdoc();return {type:Q.type,to:$('#qTo').value.trim(),grade:$('#qGrade').value,rate:qrate(),
    items:Q.items.map(({url,title,qty,price,ship,shop,note})=>({url,title,qty,price,ship,shop,note})),ship:sh.yen,shipNote:sh.note,fee:f.yen,feeNote:f.note,
    lines:Q.lines[Q.type],total}};
  try{if(Q.no&&D.smsIntake)fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({kind:'quoteSave',no:Q.no,total:qdoc().total,detail:detail()})}).catch(()=>{});
    if(!Q.no){msg('견적번호를 받는 중…');const {total}=qdoc();
      try{const r=await (await fetch(D.smsIntake,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({kind:'quoteNo',type:Q.type,to:$('#qTo').value.trim(),total,detail:detail(),at:new Date().toISOString()})})).json();if(!r.ok||!r.no)throw 0;Q.no=r.no}
      catch{const day=qtoday().replace(/-/g,''),k='woomyvesta-qno-'+day,n=(+localStorage.getItem(k)||100)+1;localStorage.setItem(k,n);Q.no=`${day}_${n}`;
        toast('공용 견적번호를 받지 못해 이 PC 번호로 만들었어요. 다른 직원 번호와 겹칠 수 있어요.')}
      qsave()}
    const {pages}=qdoc(),base=`견적서_${Q.no}_${$('#qTo').value.trim().replace(/[\\/:*?"<>|\s]+/g,'_').slice(0,30)}`;
    // every page is its own A4 PNG (…_1of2.png); the clipboard holds page 1, and the pager's [이 페이지 복사] copies the others
    const first=qpng(0);let copied=false;try{await navigator.clipboard.write([new ClipboardItem({'image/png':first})]);copied=true}catch{}
    const names=[];
    for(let k=0;k<pages;k++){const name=pages>1?`${base}_${k+1}of${pages}.png`:`${base}.png`;names.push(name);
      const a=document.createElement('a');a.href=URL.createObjectURL(k?await qpng(k):await first);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5e3);
      if(pages>1)await new Promise(r=>setTimeout(r,400))}   // browsers drop downloads fired in the same instant
    msg(pages>1?`견적번호 ${Q.no} · A4 ${pages}페이지를 파일 ${pages}개로 저장했어요${copied?' (1페이지는 복사됨 — 다른 페이지는 위쪽 ◀▶로 넘겨 [이 페이지 복사])':''}.`
      :`견적번호 ${Q.no} · ${copied?'이미지를 복사하고 ':''}${names[0]} 파일로 저장했어요.${copied?' 카카오톡에 붙여넣기(⌘V / Ctrl+V) 하면 돼요.':''}`)}
  catch{msg('이미지를 만들지 못했어요. 다시 눌러 주세요.')}
  finally{b.disabled=false}};
$('#qRate').addEventListener('change',()=>{if(!qnum($('#qRate').value))qloadRate(true)});
function setTab(t,push){
  $('#tabs').querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  $('#tabShip').classList.toggle('hidden',t!=='ship');$('#tabKakao').classList.toggle('hidden',t!=='kakao');$('#tabQuote').classList.toggle('hidden',t!=='quote');
  if(t==='quote')qinit();
  if(push){const u=new URL(location.href);t==='ship'?u.searchParams.delete('tab'):u.searchParams.set('tab',t);history.replaceState(null,'',u)}
  heal()}
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)setTab(b.dataset.tab,true)});
setTab(['kakao','quote'].includes(new URLSearchParams(location.search).get('tab'))?new URLSearchParams(location.search).get('tab'):'ship');
async function unlock(pw){const d=await open(pw);if(D)return;D=d;try{sessionStorage.setItem(SS,pw)}catch{}$('#gate')?.remove();$('#app').classList.remove('hidden');render();
  if(!$('#tabQuote').classList.contains('hidden'))qinit();
  try{const req=JSON.parse(localStorage.getItem(RREQ)||'null');if(req&&D.smsIntake&&Date.now()-req.since<40*60e3)watchRefresh(req)}catch{}watchSends();
  loadDone();setInterval(loadDone,60e3);loadMemos();setInterval(loadMemos,60e3);loadODone();setInterval(loadODone,60e3);vaultTag().then(t=>{dataTag=t})}   // other staff's 처리완료 ticks
$('#gateForm').onsubmit=async e=>{e.preventDefault();const b=$('#pwBtn');b.disabled=true;b.textContent='확인 중…';$('#pwErr').textContent='';
  try{await unlock($('#pw').value)}catch{const e=$('#pwErr');if(e)e.textContent='비밀번호가 맞지 않거나 데이터를 불러오지 못했어요.'}finally{b.disabled=false;b.textContent='들어가기'}};
$('#gq').addEventListener('input',()=>{renderAlerts();renderList();renderKakao()});
$('#xlsxBtn').onclick=downloadExcel;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)heal()});
$('#msgText').addEventListener('input',countBytes);
$('#msgCopy').onclick=()=>copy($('#msgText').value);
$('#msgSend').onclick=goSend;$('#reSend').onclick=()=>{$('#reDlg').close();goSend()};
$('#msgName').onclick=()=>{const o=$('#msgTo b');if(o)copy(o.textContent)};
$('#msgId').onclick=()=>{const id=$('#msgTo').dataset.id;if(id)copy(id)};
['#stage','#flag'].forEach(s=>$(s).addEventListener('input',renderList));
try{const pw=sessionStorage.getItem(SS);if(pw)unlock(pw).catch(()=>sessionStorage.removeItem(SS))}catch{}
})();
