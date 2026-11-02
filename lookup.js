// Customer lookup by waybill number or full phone number, for 팬스타 (ship) and 나르다 (air, e.air) orders alike.
// data/lookup.json holds status, dates and waybills only, no names or addresses. A phone is only stored as a slow hash:
// PBKDF2-SHA256(SHA-256("PHONE|<digits>"), SALT, ITER), computed the same way in vesta-tools/phone_keys.py.
(()=>{
const $=s=>document.querySelector(s);
let data=null;
const fmt=s=>{if(!s)return'—';const d=new Date(s+'T00:00:00+09:00');return `${d.getMonth()+1}월 ${d.getDate()}일`};
const daysSince=s=>s?Math.floor((Date.now()-new Date(s.slice(0,10)+'T00:00:00+09:00'))/864e5):null;
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('')}
async function phoneKey(p){const enc=new TextEncoder(),k=await crypto.subtle.importKey('raw',enc.encode(await sha(`PHONE|${p}`)),'PBKDF2',false,['deriveBits']);
  const b=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode('woomy-vesta-lookup-v1'),iterations:150000},k,256);
  return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('')}
const TRACK={'CJ대한통운':n=>`https://trace.cjlogistics.com/next/tracking.html?wblNo=${encodeURIComponent(n)}`,
 '경동택배':n=>`https://kdexp.com/service/delivery/etc/delivery.do?barcode=${encodeURIComponent(n)}`,
 '일양로지스':n=>`https://www.ilyanglogis.com/functionality/card_form_waybill.asp?hawb_no=${encodeURIComponent(n)}`};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function load(){
  try{const r=await fetch('data/lookup.json',{cache:'no-store'});if(!r.ok)throw Error();data=await r.json();
    $('#updated').textContent=`배송 정보는 하루 두 번 갱신됩니다 · 마지막 갱신 ${new Date(data.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'})}`}
  catch{$('#updated').textContent='배송 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
}

const md=s=>{if(!s)return'';const d=new Date(s.slice(0,10)+'T00:00:00+09:00');return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}(${'일월화수목금토'[d.getDay()]})`};
const mdt=s=>s?md(s)+(/\d\d:\d\d/.test(s.slice(11,16))&&s.slice(11,16)!=='00:00'?' '+s.slice(11,16):''):'';
const KAKAO='https://pf.kakao.com/_xdetxmG/chat';
const unipass=e=>`https://unipass.customs.go.kr/csp/index.do?tgMenuId=MYC_MNU_00000450&hblNo=${encodeURIComponent(e.h)}&blYy=${encodeURIComponent(e.y||'')}`;
// Same card as the staff 통관조회 window (staff.js cusPlain), from public facts only. It never tells a customer to pay,
// return or destroy anything: a problem says what is seen and points to 상담하기, where staff know the whole story.
function plain(e){
  const u=e.u||{},st=e.st??e.s,air=!!e.air,place=air?(u.p?'인천공항':'한국 공항'):'부산항',wh=air?'공항 세관 창고':'부산 세관 창고';
  const c=u.c||'',g=u.g||'',into=u.i,cleared=u.r,out=u.o,isCleared=!!cleared||/수리|심사완료/.test(c)||st>=3,isOut=!!out||g==='반출완료'||st>=3;
  const ar=u.ar||e.ar,arrived=(ar&&daysSince(ar)>=0?ar:'')||(air&&st>=3?'-':''),airLate=air&&!arrived&&!!e.late;
  const inDays=into?daysSince(into):0;let cus,act=null;
  const ask='아래 카카오 상담하기로 문의해 주시면 담당자가 자세히 안내해 드릴게요.';
  if(/불합격|반송|폐기|멸각/.test(g+c)){cus={state:'bad',title:/불합격/.test(g)?'검역 불합격':'통관 보류',date:mdt(u.a),text:/불합격/.test(g)?'검역 검사에서 불합격 판정이 났어요.':'세관에서 통관이 멈춘 상태예요.'};
    act={level:'need',title:'⚠️ 확인이 필요해요',text:ask}}
  else if(u.x||/검사|검역/.test(g)&&!isCleared){cus={state:'now',title:'세관 검사·검역 중',date:mdt(u.a),text:'세관에서 물품을 직접 확인하는 대상으로 선별돼 결과를 기다리고 있어요.'};
    act={level:'watch',title:'ℹ️ 참고해 주세요',text:'지금은 기다리시면 돼요. 자료가 필요하면 저희가 연락드릴게요.'}}
  else if(isCleared)cus={state:'done',title:'통관 완료',date:mdt(cleared),text:'세관 통관을 마쳤어요.'};
  else if(/결재통보/.test(c)){cus={state:'now',title:'세관 담당자 확인 중',date:mdt(u.a),text:'수입신고를 세관 담당자가 직접 확인하는 단계예요. 대부분 그대로 통과하지만 하루 이틀 더 걸릴 수 있어요.'};
    act={level:'watch',title:'ℹ️ 참고해 주세요',text:'지금은 기다리시면 돼요. 세관에서 구매 영수증·인보이스를 요청할 수 있으니 구매 내역을 준비해 두시면 빨라요.'}}
  else if(/심사진행|수입신고$/.test(c))cus={state:'now',title:'통관 심사 중',date:mdt(u.a),text:'수입신고를 마치고 세관에서 심사하고 있어요. 문제가 없으면 곧 통관이 끝나요.'};
  else if(/통관목록/.test(c))cus={state:'now',title:'통관 심사 중',date:mdt(u.a),text:'간이 통관 목록이 접수돼 세관 심사를 기다리고 있어요.'};
  else if(into&&inDays>=3&&/수입신고전/.test(c)){cus={state:'bad',title:'통관 시작 전',date:mdt(into),text:`${md(into)}에 ${wh}에 들어왔지만 아직 수입신고가 접수되지 않았어요.`};
    act={level:'need',title:'⚠️ 확인이 필요해요',text:ask}}
  else if(into||/반입/.test(g))cus={state:'now',title:'통관 준비 중',date:mdt(into),text:`${wh}에 들어와 통관 신고를 기다리고 있어요.`};
  else if(arrived)cus={state:'now',title:'통관 준비 중',date:'',text:`${place}에 도착해 세관 창고로 옮겨지는 중이에요.`};
  else cus={state:'todo',title:'통관',date:'',text:`${place}에 도착하면 통관이 시작돼요.`};
  if(!act&&e.late&&st<4)act={level:'watch',title:'ℹ️ 평소보다 오래 걸리고 있어요',text:`담당자가 확인하고 있어요. 급하시면 ${ask}`};
  const rows=[
    {state:e.ob?'done':'now',title:air?'일본 출발':'일본 출항',date:e.ob?md(e.ob):'',text:e.ob?(air?'일본에서 비행기로 출발했어요 (항공 배송).':'일본에서 배로 출발했어요.'):(air?'아직 비행기에 실리기 전이에요.':'아직 배에 실리기 전이에요.')},
    {state:arrived?'done':e.ob?'now':'todo',title:air?'한국 도착':'부산항 도착',date:arrived&&arrived!=='-'?md(arrived):ar?md(ar):'',
      text:arrived?`${place}에 도착했어요.`+(into?` ${mdt(into)}에 세관 창고에 들어갔어요.`:''):ar?`${md(ar)} ${place}에 도착할 예정이에요.`:!e.ob?'출발 후 보통 다음 날 도착해요.':airLate?'출발 후 아직 도착·통관 기록이 확인되지 않아요. 저희가 확인하고 있어요.':air?'비행기로 한국에 오고 있어요. 보통 출발 다음 날 도착해요.':'바다를 건너오고 있어요.'},
    cus,
    {state:st>=4?'done':isOut?'now':'todo',title:st>=4?'배송 완료':'국내 배송',date:isOut&&st<4?mdt(out):'',
      text:(st>=4?'국내 배송까지 모두 끝났어요.':isOut?'세관 창고에서 나와 국내 택배로 넘어갔어요.':'통관이 끝나면 국내 택배로 넘어가요.')+(isOut&&e.n?` 택배사 ${e.c||'—'} · 운송장 ${e.n}`:'')}];
  const now=act&&act.level==='need'?cus:[...rows].reverse().find(r=>r.state==='now')||[...rows].reverse().find(r=>r.state==='done')||rows[0];
  const head=now===cus?cus.title:now.title==='국내 배송'?'통관 완료 · 국내 배송 중':now.title==='부산항 도착'&&now.state==='now'?'바다를 건너오는 중':now.title==='한국 도착'&&now.state==='now'?(airLate?'도착·통관 확인 중':'비행기로 오는 중'):now.state==='now'&&/출/.test(now.title)?`${now.title} 준비 중`:now.title;
  return {rows,act,head,tone:act?act.level:st>=4||isCleared?'good':'now'};
}
function render(e){
  const p=plain(e),st=e.st??e.s;
  const act=p.act?`<div class="cp-act ${p.act.level}"><b>${esc(p.act.title)}</b><p>${esc(p.act.text)}</p></div>`:
    `<div class="cp-act ok"><b>✓ 지금은 따로 하실 일이 없어요</b><p>${st>=4?'받지 못하셨다면 아래 카카오 상담하기로 알려 주세요.':'진행되는 대로 저희가 확인하고 있어요.'}</p></div>`;
  const nos=(e.n||'').split(/\s+/).filter(Boolean),track=TRACK[e.c];
  $('#cusPlain').innerHTML=`<div class="cp-top"><span class="cp-brand">우마이직구 · 배송 진행 안내${e.air?' · ✈ 항공':''}</span><span class="cp-when">${fmt(e.od)} 주문</span></div>`+
    `<div class="cp-id"><span>운송장</span> <b>${nos.map(esc).join(' · ')||'아직 없음'}</b></div>`+
    `<div class="cp-now ${p.tone}"><span>지금 상황</span><b>${esc(p.head)}</b></div>`+act+
    `<ol class="cp-steps">${p.rows.map(r=>`<li class="${r.state}"><div class="cp-h"><b>${esc(r.title)}</b><span>${esc(r.date||'')}</span></div><p>${esc(r.text)}</p></li>`).join('')}</ol>`;
  $('#links').innerHTML=(track?nos.map((n,i)=>`<a class="btn" href="${track(n)}" target="_blank" rel="noopener">${esc(e.c)} 조회${nos.length>1?` ${i+1}`:''} ↗</a>`).join(''):'')+
    (e.h&&e.ob?`<a class="btn" href="${unipass(e)}" target="_blank" rel="noopener">유니패스 원문 보기 ↗</a>`:'');
  $('#result').classList.remove('hidden');$('#result').scrollIntoView({behavior:'smooth',block:'start'});
}

// A phone number can have several orders: newest first, one button each (date, ship or air, stage only).
function renderMany(list){
  const m=$('#many');list.sort((a,b)=>(b.od||'').localeCompare(a.od||''));
  m.classList.toggle('hidden',list.length<2);
  m.innerHTML=list.length<2?'':`<p class="small muted">이 번호로 찾은 주문 ${list.length}건이에요. 볼 주문을 눌러 주세요.</p>`+list.map((e,i)=>`<button type="button" class="btn manybtn${i?'':' on'}" data-i="${i}">${fmt(e.od)} 주문 · ${e.air?'항공':'해운'} · ${esc(data.stages[e.s])}</button>`).join('');
  m.onclick=ev=>{const b=ev.target.closest('[data-i]');if(!b)return;m.querySelectorAll('.manybtn').forEach(x=>x.classList.toggle('on',x===b));render(list[+b.dataset.i])};
  render(list[0]);
}
$('#lookup').onsubmit=async ev=>{
  ev.preventDefault();$('#err').textContent='';
  const raw=$('#ref').value.trim(),no=raw.replace(/[\s-]/g,''),digits=no.replace(/^\+?82(?=1)/,'0');
  const isPhone=/^01\d{8,9}$/.test(digits);
  if(!/^\d{9,14}$/.test(digits)){$('#err').textContent='운송장번호 또는 휴대폰 번호 전체를 숫자로 입력해 주세요.';return}
  if(!data){await load();if(!data)return}
  const btn=$('#go');btn.disabled=true;btn.textContent='조회 중…';
  try{
    const found=isPhone?((data.phones||{})[await phoneKey(digits)]||[]).map(i=>data.entries[i]):data.entries.filter(e=>(e.n||'').split(/\s+/).includes(digits));
    if(!found.length){$('#result').classList.add('hidden');$('#many').classList.add('hidden');
      $('#err').textContent=`일치하는 주문을 찾지 못했어요. ${isPhone?'받는 분 휴대폰 번호 전체':'운송장번호'}를 다시 확인해 주세요. 최근 45일 안의 주문만 조회돼요.`;return}
    renderMany(found)}
  finally{btn.disabled=false;btn.textContent='조회하기'}
};
const q=new URLSearchParams(location.search).get('no');if(q)$('#ref').value=q;
load();
})();
