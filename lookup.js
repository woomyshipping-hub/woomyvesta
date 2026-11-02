// Customer lookup by waybill number or full phone number, for 팬스타 (ship) and 나르다 (air, e.air) orders alike.
// data/lookup.json holds status, dates and waybills only, no names or addresses. A phone is only stored as a slow hash:
// PBKDF2-SHA256(SHA-256("PHONE|<digits>"), SALT, ITER), computed the same way in vesta-tools/phone_keys.py.
(()=>{
const $=s=>document.querySelector(s);
let data=null;
const fmt=s=>{if(!s)return'—';const d=new Date(s+'T00:00:00+09:00');return `${d.getMonth()+1}월 ${d.getDate()}일`};
const daysSince=s=>s?Math.floor((Date.now()-new Date(s+'T00:00:00+09:00'))/864e5):null;
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

function render(e){
  const stages=data.stages;
  $('#steps').innerHTML=stages.map((s,i)=>`<li class="${i<e.s?'done':i===e.s?'now':''}">${esc(s)}</li>`).join('');
  const since=daysSince(e.ar);
  // 배송 중 covers the one-day ferry crossing too; the arrival date tells which part of it the parcel is in.
  const onShip=e.s===1&&!(since>=0);
  const headline=[
    '주문이 접수되어 일본에서 출고를 준비하고 있어요',
    e.air?(onShip?'비행기로 한국에 오고 있어요':'한국에 도착해 통관과 국내 배송이 진행 중이에요'):
    onShip?(e.ar?`배를 타고 부산으로 가고 있어요 · ${fmt(e.ar)} 도착 예정`:'배를 타고 부산으로 가고 있어요'):'부산에 도착해 통관과 국내 배송이 진행 중이에요',
    '배송이 완료됐어요'][e.s];
  const explain=[
    e.air?'일본에서 항공편에 실릴 준비를 하고 있어요. 주말·연휴에는 며칠 더 걸릴 수 있어요.':'오사카에서 부산으로 가는 배에 실릴 준비를 하고 있어요. 대부분 주문 다음 날 출항하고, 주말·연휴에는 며칠 더 걸릴 수 있어요.',
    e.air?'항공편은 보통 출발 다음 날 한국에 도착해요. 세관 통관이 끝나면 택배사로 넘어가 배송이 시작돼요.':onShip?'오사카에서 출항한 다음 날 부산항에 도착해요. 도착 후 세관 통관을 거쳐 택배사로 넘어가요.':'세관 통관이 끝나면 택배사로 넘어가 배송이 시작돼요. 아래 운송장번호로 택배사에서 현재 위치를 확인할 수 있어요.',
    '받지 못하셨다면 카카오톡 채널 \'우마이직구\'로 운송장번호와 함께 알려 주세요.'][e.s];
  $('#headline').textContent=headline;$('#explain').textContent=explain;
  $('#dates').innerHTML=[['주문',e.od],[e.air?'일본 출발':'일본 출항',e.ob],[e.air?'한국 도착':'부산 도착',e.ar]].map(([k,v])=>`<div><span class="small muted">${k}</span><b>${fmt(v)}</b></div>`).join('');
  const notes=[];
  if(e.f.includes('inspect')&&e.s<2)notes.push(['warn','세관 검사 대상으로 선별되어 통관에 시간이 더 걸릴 수 있어요. 검사가 끝나면 바로 배송이 시작돼요.']);
  if(e.late)notes.push(['bad',`${e.air?'일본 출발':'부산 도착'} 후 ${e.air?daysSince(e.ob):since}일이 지났어요. 평소보다 오래 걸리고 있어 담당자가 확인하고 있어요. 급하시면 카카오톡 채널 '우마이직구'로 운송장번호를 알려 주세요.`]);
  else if(e.s===1&&!onShip)notes.push(['info','통관이 끝나야 택배사 조회에 배송 정보가 나타나요. 아직 조회되지 않아도 정상 진행 중일 수 있어요.']);
  if(e.s===2)notes.push(['good','배송이 완료된 주문이에요.']);
  $('#notes').innerHTML=notes.map(([k,t])=>`<div class="note ${k}">${esc(t)}</div>`).join('');
  const c=$('#courier');
  if(e.n&&e.s>=1&&!onShip){const link=TRACK[e.c];
    const nos=e.n.split(/\s+/);
    c.innerHTML=`<div><span class="small muted">${esc(e.c||'택배사')} 운송장번호${nos.length>1?` (${nos.length}개 상자)`:''}</span><br><b>${nos.map(esc).join('<br>')}</b></div>${link?nos.map((n,i)=>`<a class="btn" href="${link(n)}" target="_blank" rel="noopener">택배사에서 조회${nos.length>1?' '+(i+1):''} ↗</a>`).join(''):''}`;
    c.classList.remove('hidden')}else c.classList.add('hidden');
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
