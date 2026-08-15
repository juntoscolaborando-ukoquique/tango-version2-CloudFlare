const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8', ...extra}});
function cors(env) { return {'access-control-allow-origin': env.ALLOWED_ORIGIN || '*','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization,x-bootstrap-token'}; }

async function sha256Hex(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function auth(request, env) {
  const h=request.headers.get('authorization')||'';
  if(!h.startsWith('Bearer ')) return null;
  const token=h.slice(7);
  const hash=await sha256Hex(token);
  return env.DB.prepare('SELECT device_id FROM device_tokens WHERE token_hash=?').bind(hash).first();
}
function uuid(){return crypto.randomUUID();}
function cleanEnvelope(e){
  if(!e || e.v!==1 || typeof e.tango!=='string' || !e.signature) throw new Error('Envelope inválido');
  const s=JSON.stringify(e); if(s.length>2_000_000) throw new Error('Envelope demasiado grande');
}

export default {
 async fetch(request, env) {
  const headers = cors(env);
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
  const url=new URL(request.url);
  try {
   if(url.pathname==='/v1/health') return json({ok:true,protocol:'TCMP',version:1},200,headers);

   if(url.pathname==='/v1/devices/register' && request.method==='POST') {
    const admin=request.headers.get('x-bootstrap-token');
    if(!admin || admin!==env.ADMIN_BOOTSTRAP_TOKEN) return json({error:'forbidden'},403,headers);
    const body=await request.json();
    if(!body.device_id || !body.user_id || !body.signing_public || !body.receiving_public) return json({error:'missing fields'},400,headers);
    const token=crypto.randomUUID()+crypto.randomUUID();
    const hash=await sha256Hex(token);
    await env.DB.prepare('INSERT OR REPLACE INTO devices(device_id,user_id,signing_public,receiving_public,created_at) VALUES(?,?,?,?,?)').bind(body.device_id,body.user_id,JSON.stringify(body.signing_public),JSON.stringify(body.receiving_public),Date.now()).run();
    await env.DB.prepare('INSERT OR REPLACE INTO device_tokens(device_id,token_hash) VALUES(?,?)').bind(body.device_id,hash).run();
    return json({device_id:body.device_id,device_token:token},201,headers);
   }

   const authDevice=await auth(request,env);
   if(!authDevice) return json({error:'unauthorized'},401,headers);

   if(url.pathname==='/v1/roster' && request.method==='GET') {
    const rows=await env.DB.prepare('SELECT device_id,user_id,signing_public,receiving_public FROM devices ORDER BY user_id,device_id').all();
    return json({devices:rows.results.map(r=>({...r,signing_public:JSON.parse(r.signing_public),receiving_public:JSON.parse(r.receiving_public)}))},200,headers);
   }

   if(url.pathname==='/v1/messages' && request.method==='POST') {
    const body=await request.json(); cleanEnvelope(body.envelope);
    if(body.recipient_device_id!==body.envelope.recipientDeviceId) throw new Error('recipient mismatch');
    if(body.envelope.senderDeviceId!==authDevice.device_id) throw new Error('sender mismatch');
    const target=await env.DB.prepare('SELECT device_id FROM devices WHERE device_id=?').bind(body.recipient_device_id).first();
    if(!target) return json({error:'unknown recipient'},404,headers);
    const id=uuid();
    await env.DB.prepare('INSERT INTO messages(id,recipient_device_id,sender_device_id,envelope,created_at) VALUES(?,?,?,?,?)').bind(id,body.recipient_device_id,authDevice.device_id,JSON.stringify(body.envelope),Date.now()).run();
    return json({id},201,headers);
   }

   const inbox=url.pathname.match(/^\/v1\/inbox\/([^/]+)$/);
   if(inbox && request.method==='GET') {
    if(inbox[1]!==authDevice.device_id) return json({error:'forbidden'},403,headers);
    const rows=await env.DB.prepare('SELECT id,envelope,created_at FROM messages WHERE recipient_device_id=? ORDER BY created_at LIMIT 200').bind(authDevice.device_id).all();
    return json({messages:rows.results.map(r=>({id:r.id,envelope:JSON.parse(r.envelope),created_at:r.created_at}))},200,headers);
   }

   const msg=url.pathname.match(/^\/v1\/messages\/([^/]+)$/);
   if(msg && request.method==='DELETE') {
    const row=await env.DB.prepare('SELECT recipient_device_id FROM messages WHERE id=?').bind(msg[1]).first();
    if(!row || row.recipient_device_id!==authDevice.device_id) return json({error:'not found'},404,headers);
    await env.DB.prepare('DELETE FROM messages WHERE id=?').bind(msg[1]).run();
    return json({ok:true},200,headers);
   }

   const att=url.pathname.match(/^\/v1\/attachments\/([^/]+)\/([^/]+)$/);
   if(att && (request.method==='PUT' || request.method==='GET')) {
    const attachmentId=att[1];
    const objectKey=`attachments/${att[1]}/${att[2]}`;
    // Ownership record — set on first PUT, checked on every PUT and GET.
    const owner=await env.DB.prepare('SELECT owner_device_id FROM attachment_owners WHERE attachment_id=?').bind(attachmentId).first();
    if(request.method==='PUT') {
      // If already owned by someone else, reject.
      if(owner && owner.owner_device_id!==authDevice.device_id) return json({error:'forbidden'},403,headers);
      if(!request.body) return json({error:'empty body'},400,headers);
      await env.BUCKET.put(objectKey,request.body,{httpMetadata:{contentType:'application/octet-stream'}});
      // Claim ownership on first chunk upload.
      if(!owner) {
        await env.DB.prepare('INSERT OR IGNORE INTO attachment_owners(attachment_id,owner_device_id,created_at) VALUES(?,?,?)').bind(attachmentId,authDevice.device_id,Date.now()).run();
      }
      return json({ok:true,key:objectKey},201,headers);
    }
    // GET: allow the uploader (owner), or any device the uploader has sent a message
    // to that references this attachmentId (i.e. the intended recipient).
    // Note: the LIKE scan over envelope is a string-match heuristic that works at
    // this project's scale. If a proper attachment_id column is ever added to messages,
    // replace this with an indexed lookup.
    if(owner && owner.owner_device_id!==authDevice.device_id) {
      const sentToMe=await env.DB.prepare(
        "SELECT 1 FROM messages WHERE sender_device_id=? AND recipient_device_id=? AND envelope LIKE ('%'||?||'%') LIMIT 1"
      ).bind(owner.owner_device_id,authDevice.device_id,attachmentId).first();
      if(!sentToMe) return json({error:'forbidden'},403,headers);
    }
    const obj=await env.BUCKET.get(objectKey);
    if(!obj) return json({error:'not found'},404,headers);
    return new Response(obj.body,{headers:{...headers,'content-type':'application/octet-stream','cache-control':'no-store'}});
   }

   return json({error:'not found'},404,headers);
  } catch(e) {
   return json({error:e?.message||'server error'},400,headers);
  }
 }
};
