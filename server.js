import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 3000);
const privacyHtml = await readFile(new URL('./privacy-policy.html', import.meta.url), 'utf8');
const landingHtml = await readFile(new URL('./landing.html', import.meta.url), 'utf8');
const appointments = [];
const cw = process.env.CHATWOOT_URL;
const token = process.env.CHATWOOT_API_TOKEN;
const account = process.env.CHATWOOT_ACCOUNT_ID || '1';
const inbox = Number(process.env.CHATWOOT_INBOX_ID || '3');
const metaToken = process.env.META_ACCESS_TOKEN;
const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

const json = (res, code, body) => { res.writeHead(code, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); };
const body = req => new Promise((resolve,reject)=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}})});
const norm = p => '+' + String(p).replace(/\D/g,'');
const dayKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

async function cwFetch(path, options={}) {
  return fetch(`${cw}/api/v1/accounts/${account}${path}`, { ...options, headers: { api_access_token: token, 'content-type':'application/json', ...(options.headers||{}) } });
}
async function notify(a) {
  if (!cw || !token) return { skipped: 'Chatwoot не настроен' };
  const phone = norm(a.phone);
  let r = await cwFetch(`/contacts/search?q=${encodeURIComponent(phone.replace('+',''))}`);
  let contacts = (await r.json()).payload || [];
  let contact = contacts.find(x=>x.phone_number===phone);
  if (!contact) {
    r = await cwFetch('/contacts', {method:'POST', body:JSON.stringify({name:a.client_name,phone_number:phone,inbox_id:inbox})});
    const created = await r.json();
    contact = created.payload?.contact || created;
  }
  r = await cwFetch(`/contacts/${contact.id}/conversations`);
  const convs = (await r.json()).payload || [];
  let conv = convs.find(x=>x.inbox_id===inbox && x.status!=='resolved');
  if (!conv) {
    r = await cwFetch('/conversations', {method:'POST',body:JSON.stringify({source_id:String(contact.id),inbox_id:inbox,contact_id:contact.id,status:'open'})});
    conv = await r.json();
  }
  const when = new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeStyle:'short',timeZone:'Asia/Almaty'}).format(new Date(a.starts_at));
  const content = `Здравствуйте, ${a.client_name}! Вы записаны в салон красоты QFlow.\n\nУслуга: ${a.service}\nМастер: ${a.master_name}\nДата и время: ${when}\n\nЖдём вас! Для переноса записи ответьте на это сообщение.`;
  r = await cwFetch(`/conversations/${conv.id}/messages`, {method:'POST',body:JSON.stringify({content,message_type:'outgoing',private:false})});
  const message = await r.json();
  let buttons;
  if (metaToken && phoneNumberId) {
    const br = await fetch(`https://graph.facebook.com/v26.0/${phoneNumberId}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${metaToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone.replace('+',''), type: 'interactive', interactive: {
        type: 'button', body: { text: `Подтвердите запись: ${a.service}, ${when}` },
        action: { buttons: [
          { type:'reply', reply:{ id:`confirm_${a.id}`, title:'Да' } },
          { type:'reply', reply:{ id:`cancel_${a.id}`, title:'Нет' } },
          { type:'reply', reply:{ id:`call_${a.id}`, title:'Позвонить' } }
        ] }
      }})
    });
    const bj = await br.json(); buttons = { status: br.status, message_id: bj.messages?.[0]?.id, error: bj.error?.message };
  }
  return { conversation_id: conv.id, message_id: message.id, status: message.status, error: message.content_attributes?.external_error, buttons };
}

async function syncStatuses() {
  if (!cw || !token) return;
  for (const a of appointments.filter(x=>x.status==='pending' && x.conversation_id)) {
    try {
      const r = await cwFetch(`/conversations/${a.conversation_id}/messages`);
      const messages = (await r.json()).payload || [];
      const since = new Date(a.created_at).getTime()/1000;
      const reply = messages.filter(m=>m.message_type===0 && Number(m.created_at)>=since).find(m=>['да','нет'].includes(String(m.content||'').trim().toLowerCase()));
      if (reply) a.status = String(reply.content).trim().toLowerCase()==='да' ? 'confirmed' : 'rejected';
    } catch (e) { console.error('status sync failed', a.id, e.message); }
  }
}

const bookingHtml = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QFlow — Записи салона</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#172033;font:14px Inter,Arial}.wrap{max-width:1180px;margin:auto;padding:28px}.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}h1{font-size:28px;margin:0}.card{background:white;border:1px solid #e5e9f2;border-radius:16px;box-shadow:0 8px 28px #1e293b0d}.form{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:16px;margin-bottom:18px}input,select,button{height:42px;border:1px solid #d8deea;border-radius:9px;padding:0 11px;background:white}button{background:#176b5b;color:white;border:0;font-weight:700;cursor:pointer}.grid{overflow:auto}.days{display:grid;grid-template-columns:110px repeat(7,minmax(130px,1fr));min-width:1050px}.cell{border-right:1px solid #edf0f5;border-bottom:1px solid #edf0f5;padding:10px;min-height:72px}.day{font-weight:700;background:#f9fafc;min-height:auto}.time{font-weight:600;color:#6b7280}.appt{border-radius:8px;padding:8px;margin-bottom:5px;font-size:12px}.appt.pending{background:#fff7d6;border-left:4px solid #e3a008}.appt.confirmed{background:#dcfce7;border-left:4px solid #16a34a}.appt.rejected{background:#fee2e2;border-left:4px solid #dc2626}.status{font-weight:700;margin-top:5px}.muted{color:#6b7280}.toast{padding:10px 14px;border-radius:9px;background:#172033;color:white;display:none}.back{display:inline-flex;margin-bottom:16px;color:#176b5b;font-weight:700;text-decoration:none}@media(max-width:900px){.form{grid-template-columns:1fr 1fr}}@media(max-width:560px){.wrap{padding:16px}.form{grid-template-columns:1fr}.head{align-items:flex-start;gap:12px}}
</style><body><div class="wrap"><a class="back" href="/">← QFlow</a><div class="head"><div><h1>Сетка записей</h1><div class="muted">Демо салона красоты · WhatsApp уведомления через Chatwoot</div></div><div id="toast" class="toast"></div></div>
<form id="f" class="card form"><input name="client_name" placeholder="Имя клиента" required><input name="phone" placeholder="+7 700 000 0000" required><select name="service"><option>Стрижка</option><option>Маникюр</option><option>Окрашивание</option><option>Укладка</option></select><select name="master_name"><option>Анна</option><option>Мария</option><option>Диана</option></select><input name="starts_at" type="datetime-local" required><button>Записать и уведомить</button></form><div class="card grid"><div id="grid" class="days"></div></div></div>
<script>const times=['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));function key(d){let p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),o=Object.fromEntries(p.map(x=>[x.type,x.value]));return o.year+'-'+o.month+'-'+o.day}function days(){let a=[];for(let i=0;i<7;i++){let d=new Date();d.setDate(d.getDate()+i);a.push(d)}return a}async function load(){let ds=days(),from=key(ds[0]),to=key(ds[6]);let a=await fetch('/api/appointments?from='+from+'&to='+to).then(r=>r.json()),g=document.querySelector('#grid'),labels={pending:'Ожидает ответа',confirmed:'Подтверждено',rejected:'Отказ'};g.innerHTML='<div class="cell day">Время</div>'+ds.map(d=>'<div class="cell day">'+d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Almaty'})+'</div>').join('');for(let t of times){g.innerHTML+='<div class="cell time">'+t+'</div>'+ds.map(d=>{let k=key(d),x=a.filter(v=>key(new Date(v.starts_at))===k&&new Date(v.starts_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Almaty'})===t);return '<div class="cell">'+x.map(v=>'<div class="appt '+esc(v.status)+'"><b>'+esc(v.client_name)+'</b><br>'+esc(v.service)+' · '+esc(v.master_name)+'<div class="status">'+labels[v.status]+'</div></div>').join('')+'</div>'}).join('')}}document.querySelector('#f').onsubmit=async e=>{e.preventDefault();let o=Object.fromEntries(new FormData(e.target));o.starts_at=new Date(o.starts_at).toISOString();let r=await fetch('/api/appointments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)}),j=await r.json(),t=document.querySelector('#toast');t.style.display='block';t.textContent=r.ok?'Запись создана. WhatsApp: '+(j.notification?.status||'отправлено'):(j.error||'Ошибка');setTimeout(()=>t.style.display='none',5000);if(r.ok){e.target.reset();load()}};load();setInterval(load,3000);</script></body></html>`;

http.createServer(async (req,res)=>{try{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(landingHtml)}
  if(req.method==='GET'&&u.pathname==='/booking'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(bookingHtml)}
  if(req.method==='GET'&&u.pathname==='/privacy-policy'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(privacyHtml)}
  if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true});
  if(req.method==='GET'&&u.pathname==='/api/appointments'){const from=u.searchParams.get('from'),to=u.searchParams.get('to');await syncStatuses();return json(res,200,appointments.filter(a=>dayKey(a.starts_at)>=from&&dayKey(a.starts_at)<=to))}
  if(req.method==='POST'&&u.pathname==='/api/appointments'){const a=await body(req);if(!a.client_name||!a.phone||!a.service||!a.master_name||!a.starts_at)return json(res,422,{error:'Заполните все поля'});const appointment={id:Date.now(),...a,phone:norm(a.phone),status:'pending',created_at:new Date().toISOString()};appointments.push(appointment);let notification;try{notification=await notify(appointment);appointment.conversation_id=notification.conversation_id}catch(e){notification={status:'failed',error:e.message}}return json(res,201,{appointment,notification})}
  json(res,404,{error:'Not found'});
}catch(e){console.error(e);json(res,500,{error:e.message})}}).listen(port,()=>console.log('QFlow service on',port));