const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static("public"));

const rooms = new Map();
const makeCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const safeName = s => String(s || "").trim().slice(0, 18);
const roomOf = socket => {
  for (const room of rooms.values()) if (room.players.has(socket.id)) return room;
  return null;
};
function publicState(room) {
  return {
    code: room.code, hostId: room.hostId, phase: room.phase,
    round: room.round, players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, alive: p.alive, isHost: p.id === room.hostId
    })),
    message: room.message || ""
  };
}
function broadcast(room) { io.to(room.code).emit("state", publicState(room)); }
function tellRole(room, player) {
  io.to(player.id).emit("privateRole", { role: player.role, teammates:
    [...room.players.values()].filter(p => p.role === "mafia" && p.id !== player.id).map(p => p.name)
  });
}
function endGame(room, winner) {
  room.phase = "ended";
  room.message = winner === "mafia" ? "فازت المافيا!" : "فاز أهل القرية!";
  io.to(room.code).emit("gameOver", { winner, message: room.message });
  broadcast(room);
}
function checkWin(room) {
  const alive = [...room.players.values()].filter(p => p.alive);
  const mafia = alive.filter(p => p.role === "mafia").length;
  const town = alive.length - mafia;
  if (!mafia) endGame(room, "town");
  else if (mafia >= town) endGame(room, "mafia");
}
function assignRoles(room) {
  const n = room.players.size;
  const roles = [];
  const mafiaCount = n >= 7 ? 2 : 1;
  for (let i=0;i<mafiaCount;i++) roles.push("mafia");
  roles.push("detective");
  if (n >= 6) roles.push("doctor");
  while (roles.length < n) roles.push("villager");
  for (let i=roles.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1)); [roles[i],roles[j]]=[roles[j],roles[i]];
  }
  [...room.players.values()].forEach((p,i)=>{ p.role=roles[i]; p.alive=true; });
}
function resolveNight(room) {
  const alive=[...room.players.values()].filter(p=>p.alive);
  const targetVotes=[...room.nightKills.values()];
  const counts={}; targetVotes.forEach(id=>counts[id]=(counts[id]||0)+1);
  let target=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0] || null;
  const saved=[...room.doctorSaves.values()][0] || null;
  let note="";
  if (target && target !== saved) {
    const victim=room.players.get(target);
    if (victim && victim.alive) { victim.alive=false; note=`${victim.name} خرج من اللعبة الليلة.`; }
  } else if (target) note="لم يمت أحد هذه الليلة.";
  else note="لم يتم اختيار ضحية.";
  room.phase="day"; room.message=note; room.votes.clear();
  room.nightKills.clear(); room.detectiveChecks.clear(); room.doctorSaves.clear();
  broadcast(room);
  for (const p of alive) if (p.role==="detective") {
    const check=room.lastCheck && room.lastCheck[p.id];
    if (check) {
      const targetPlayer=room.players.get(check);
      if (targetPlayer) io.to(p.id).emit("privateInfo",{text:`نتيجة التحقيق: ${targetPlayer.name} ${targetPlayer.role==="mafia"?"من المافيا":"ليس من المافيا"}.`});
    }
  }
  room.lastCheck={};
  checkWin(room);
}
io.on("connection", socket => {
  socket.on("createRoom", ({name}, cb=()=>{}) => {
    const playerName=safeName(name);
    if (!playerName) return cb({error:"اكتب اسمك أولاً."});
    let code; do { code=makeCode(); } while(rooms.has(code));
    const room={code,hostId:socket.id,players:new Map(),phase:"lobby",round:0,
      votes:new Map(),nightKills:new Map(),detectiveChecks:new Map(),doctorSaves:new Map(),lastCheck:{},message:"بانتظار اللاعبين..."};
    room.players.set(socket.id,{id:socket.id,name:playerName,alive:true,role:null});
    rooms.set(code,room); socket.join(code); cb({ok:true,code}); broadcast(room);
  });
  socket.on("joinRoom", ({code,name}, cb=()=>{}) => {
    code=String(code||"").trim().toUpperCase();
    const room=rooms.get(code), playerName=safeName(name);
    if (!playerName) return cb({error:"اكتب اسمك أولاً."});
    if (!room) return cb({error:"كود الغرفة غير صحيح."});
    if (room.phase!=="lobby") return cb({error:"اللعبة بدأت بالفعل."});
    if (room.players.size>=8) return cb({error:"الغرفة ممتلئة (8 لاعبين)."});
    room.players.set(socket.id,{id:socket.id,name:playerName,alive:true,role:null});
    socket.join(code); cb({ok:true,code}); broadcast(room);
  });
  socket.on("startGame", () => {
    const room=roomOf(socket); if (!room || room.hostId!==socket.id || room.phase!=="lobby") return;
    if (room.players.size<5) return socket.emit("notice","تحتاج الغرفة إلى 5 لاعبين على الأقل.");
    assignRoles(room); room.phase="night"; room.round=1; room.message="حلّ الليل... المافيا تختار ضحية.";
    for (const p of room.players.values()) tellRole(room,p);
    broadcast(room);
  });
  socket.on("nightAction", ({action,target}) => {
    const room=roomOf(socket); if (!room || room.phase!=="night") return;
    const p=room.players.get(socket.id), t=room.players.get(target);
    if (!p || !p.alive || !t || !t.alive || p.id===t.id) return;
    if (action==="kill" && p.role==="mafia") room.nightKills.set(p.id,target);
    if (action==="check" && p.role==="detective") room.lastCheck[p.id]=target;
    if (action==="save" && p.role==="doctor") room.doctorSaves.set(p.id,target);
    socket.emit("notice","تم تسجيل اختيارك بسرية.");
    const mafia=[...room.players.values()].filter(x=>x.alive&&x.role==="mafia");
    if (mafia.length && mafia.every(x=>room.nightKills.has(x.id)) &&
        [...room.players.values()].filter(x=>x.alive&&x.role==="detective").every(x=>room.lastCheck[x.id]) &&
        [...room.players.values()].filter(x=>x.alive&&x.role==="doctor").every(x=>room.doctorSaves.has(x.id))) {
      resolveNight(room);
    }
  });
  socket.on("vote", ({target}) => {
    const room=roomOf(socket); if (!room || room.phase!=="day") return;
    const p=room.players.get(socket.id), t=room.players.get(target);
    if (!p || !p.alive || !t || !t.alive || p.id===t.id) return;
    room.votes.set(p.id,target);
    const alive=[...room.players.values()].filter(x=>x.alive);
    if (alive.every(x=>room.votes.has(x.id))) {
      const counts={}; [...room.votes.values()].forEach(id=>counts[id]=(counts[id]||0)+1);
      const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
      if (top.length && (!top[1] || top[0][1]>top[1][1])) {
        const out=room.players.get(top[0][0]); if(out) out.alive=false;
        room.message=out?`${out.name} تم إخراجه بالتصويت.`:"انتهى التصويت.";
      } else room.message="تعادل التصويت، لم يخرج أحد.";
      room.votes.clear(); checkWin(room);
      if(room.phase!=="ended"){room.phase="night";room.round++;room.message="حلّ الليل... اختاروا أدواركم.";broadcast(room);}
    } else broadcast(room);
  });
  socket.on("mafiaChat", ({text:msg}) => {
    const room=roomOf(socket), p=room?.players.get(socket.id);
    if (!room || room.phase!=="night" || !p?.alive || p.role!=="mafia") return;
    const message=String(msg||"").trim().slice(0,240); if(!message) return;
    for(const m of room.players.values()) if(m.role==="mafia"&&m.alive)
      io.to(m.id).emit("mafiaMessage",{name:p.name,text:message});
  });
  socket.on("leaveRoom",()=>{ removePlayer(socket); });
  socket.on("disconnect",()=>removePlayer(socket));
});
function removePlayer(socket){
  const room=roomOf(socket); if(!room)return;
  room.players.delete(socket.id);
  if(!room.players.size){rooms.delete(room.code);return;}
  if(room.hostId===socket.id) room.hostId=room.players.keys().next().value;
  if(room.phase==="lobby") broadcast(room);
  else if(room.phase!=="ended") { broadcast(room); checkWin(room); }
}
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Mafia Room running on ${PORT}`));
