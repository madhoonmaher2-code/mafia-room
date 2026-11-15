const socket=io();
const $=id=>document.getElementById(id);
let myRole=null, teammates=[], currentState=null, chosen=null;
const roles={mafia:["مافيا 🕶️","تخلص من أهل القرية ليلاً دون أن ينكشف أمرك."],detective:["محقق 🔎","اختر لاعباً لتعرف إن كان من المافيا."],doctor:["طبيب 🩺","اختر لاعباً لتحميه من القتل الليلة."],villager:["مواطن 🧑‍🌾","ناقش الآخرين وحاول اكتشاف المافيا بالتصويت."]};
function show(id){["home","lobby","game"].forEach(x=>$(x).classList.toggle("hidden",x!==id));}
function name(){return $("name").value.trim();}
function err(id,msg){$(id).textContent=msg||"";}
$("create").onclick=()=>socket.emit("createRoom",{name:name()},r=>{if(r.error)err("homeMsg",r.error);else{ $("roomCode").textContent=r.code;show("lobby");}});
$("join").onclick=()=>socket.emit("joinRoom",{name:name(),code:$("code").value},r=>{if(r.error)err("homeMsg",r.error);else{$("roomCode").textContent=r.code;show("lobby");}});
$("copy").onclick=async()=>{try{await navigator.clipboard.writeText($("roomCode").textContent);$("lobbyMsg").textContent="تم نسخ الكود!";}catch{$("lobbyMsg").textContent="الكود: "+$("roomCode").textContent;}};
$("start").onclick=()=>socket.emit("startGame");
socket.on("state",s=>{currentState=s;$("roomCode").textContent=s.code;
if(s.phase==="lobby"){show("lobby");$("players").innerHTML="";s.players.forEach(p=>$("players").insertAdjacentHTML("beforeend",`<div class="player">${escapeHtml(p.name)} ${p.isHost?'<span class="host">المضيف</span>':''}</div>`));$("start").disabled=s.players.length<5;$("start").textContent=s.players.length<5?`بانتظار ${5-s.players.length} لاعبين`:"ابدأ اللعبة";return;}
show("game");$("round").textContent="الجولة "+s.round;$("phase").textContent=s.phase==="night"?"الليل 🌙":s.phase==="day"?"النهار ☀️":"انتهت";$("gameMessage").textContent=s.message||"";
$("gamePlayers").innerHTML="";s.players.forEach(p=>$("gamePlayers").insertAdjacentHTML("beforeend",`<div class="player ${p.alive?'':'dead'}">${escapeHtml(p.name)} ${p.alive?'':'☠️'}</div>`));
renderActions();
});
socket.on("privateRole",d=>{myRole=d.role;teammates=d.teammates||[];$("roleCard").classList.remove("hidden");$("roleName").textContent=roles[myRole][0];$("roleDesc").textContent=roles[myRole][1];$("teammates").textContent=myRole==="mafia"&&teammates.length?"زملاؤك: "+teammates.join("، "):"";if(myRole==="mafia")$("mafiaBox").classList.remove("hidden");renderActions();});
socket.on("privateInfo",d=>err("notice",d.text));
socket.on("notice",m=>err("notice",m));
socket.on("mafiaMessage",m=>{$("chatLog").insertAdjacentHTML("beforeend",`<p><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</p>`);$("chatLog").scrollTop=$("chatLog").scrollHeight;});
socket.on("gameOver",d=>{err("notice",d.message);$("gameTitle").textContent="انتهت اللعبة 🎉";$("actions").innerHTML="";});
function renderActions(){if(!currentState||!myRole)return;const s=currentState;const me=s.players.find(p=>p.id===socket.id);if(!me||!me.alive){$("actions").innerHTML="<p class='muted'>لقد خرجت من اللعبة. يمكنك متابعة الجولة.</p>";return;}let html="";
if(s.phase==="night"){const action=myRole==="mafia"?"kill":myRole==="detective"?"check":myRole==="doctor"?"save":null;if(action){html=`<p class="muted">${action==="kill"?"اختاروا لاعباً للتخلص منه":action==="check"?"اختر لاعباً للتحقيق معه":"اختر لاعباً لحمايته"}</p>`+s.players.filter(p=>p.alive&&p.id!==socket.id).map(p=>`<button class="actionbtn" data-action="${action}" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join("");}}
if(s.phase==="day")html="<p class='muted'>ناقشوا ثم صوّتوا لإخراج المشتبه به.</p>"+s.players.filter(p=>p.alive&&p.id!==socket.id).map(p=>`<button class="actionbtn" data-action="vote" data-id="${p.id}">🗳️ التصويت ضد ${escapeHtml(p.name)}</button>`).join("");
$("actions").innerHTML=html;$("actions").querySelectorAll("button").forEach(b=>b.onclick=()=>{if(b.dataset.action==="vote")socket.emit("vote",{target:b.dataset.id});else socket.emit("nightAction",{action:b.dataset.action,target:b.dataset.id});b.disabled=true;});}
$("sendChat").onclick=sendChat;$("chatInput").onkeydown=e=>{if(e.key==="Enter")sendChat();};function sendChat(){const t=$("chatInput").value.trim();if(t){socket.emit("mafiaChat",{text:t});$("chatInput").value="";}}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
