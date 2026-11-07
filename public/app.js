const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = { user:null, groups:[], items:[], requests:[], view:"closet", category:"All", authMode:"login", selectedBorrowItem:null };
const categoryIcons = {Tops:"◒",Bottoms:"▤",Outerwear:"♧",Dresses:"♢",Shoes:"⌑",Bags:"▱",Accessories:"✧",Other:"◇"};
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(url, options={}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function jsonOptions(body) { return { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }; }
function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2600); }
function showAuth(mode="login") { state.authMode=mode; $("#authView").classList.remove("hidden"); $("#appView").classList.add("hidden"); $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.authTab===mode)); $("#nameField").classList.toggle("hidden",mode!=="register"); $("#authSubmit").textContent=mode==="login"?"Sign in":"Create account"; $("#authMessage").textContent=""; $("#authForm").reset(); }
function showApp() { $("#authView").classList.add("hidden"); $("#appView").classList.remove("hidden"); $("#userName").textContent=state.user.name; $("#userAvatar").textContent=state.user.name.trim().charAt(0).toUpperCase(); }
async function refresh() { const [g,i,r]=await Promise.all([api("/api/groups"),api("/api/items"),api("/api/requests")]); state.groups=g.groups; state.items=i.items; state.requests=r.requests; render(); }
function render() { renderItems(); renderGroups(); renderRequests(); updateStats(); updateRequestCount(); renderGroupChoices(); }
function itemCard(item, discover=false) {
  const status=item.status==="pending"?"Request pending":item.status==="borrowed"?"On loan":"Available";
  const statusClass=item.status==="available"?"available":item.status;
  const image=item.imageUrl?`<img class="item-photo" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">`:`<div class="item-photo photo-placeholder">${categoryIcons[item.category]||"◇"}</div>`;
  return `<article class="item-card">${image}<div class="item-info"><div class="item-topline"><h3 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3><span class="status ${statusClass}">${status}</span></div><p class="item-category">${escapeHtml(item.category)}${item.size?" · "+escapeHtml(item.size):""}</p><div class="item-footer"><span class="owner-label">${item.isOwner?"Your piece":"By "+escapeHtml(item.ownerName)}</span>${discover?(item.status==="available"?`<button class="small-action" data-borrow="${item.id}">Request</button>`:""):(item.isOwner?`<button class="small-action danger" data-delete="${item.id}">Remove</button>`:"")}</div></div></article>`;
}
function renderItems() {
  const mine=state.items.filter(x=>x.isOwner);
  const visibleMine=state.category==="All"?mine:mine.filter(x=>x.category===state.category);
  $("#myItems").innerHTML=visibleMine.length?visibleMine.map(x=>itemCard(x)).join(""):`<div class="empty-state"><b>Your closet is waiting for its first piece.</b>Add a photo of something you own to get started.</div>`;
  $("#itemCount").textContent=`${visibleMine.length} ${visibleMine.length===1?"piece":"pieces"}`;
  const search=($("#searchItems")?.value||"").toLowerCase();
  const cat=$("#discoverCategory")?.value||"All";
  const shared=state.items.filter(x=>!x.isOwner && x.groups.length && (cat==="All"||x.category===cat) && `${x.name} ${x.category} ${x.ownerName} ${x.description}`.toLowerCase().includes(search));
  $("#sharedItems").innerHTML=shared.length?shared.map(x=>itemCard(x,true)).join(""):`<div class="empty-state"><b>No shared pieces found yet.</b>When friends share items with one of your groups, they'll show up here.</div>`;
}
function updateStats() {
  const mine=state.items.filter(x=>x.isOwner);
  $("#statTotal").textContent=mine.length;
  $("#statShared").textContent=mine.filter(x=>x.groups.length).length;
  $("#statBorrowed").textContent=state.requests.filter(x=>x.isOwner&&x.status==="approved").length;
}
function updateRequestCount() {
  const n=state.requests.filter(x=>x.isOwner&&x.status==="pending").length;
  $("#requestCount").textContent=n; $("#requestCount").classList.toggle("hidden",!n);
}
function renderGroups() {
  $("#groupList").innerHTML=state.groups.length?state.groups.map(g=>`<article class="group-card"><h3>${escapeHtml(g.name)}</h3><p>${g.memberCount} ${g.memberCount===1?"member":"members"} · Private group</p><div class="invite-code"><span>${escapeHtml(g.inviteCode)}</span><button class="copy-button" data-copy="${escapeHtml(g.inviteCode)}">COPY</button></div></article>`).join(""):`<div class="empty-state"><b>Your circle starts here.</b>Create a group or join one with an invite code.</div>`;
}
function requestCard(r, incoming) {
  const img=r.imageUrl?`<img class="request-thumb" src="${escapeHtml(r.imageUrl)}" alt="">`:`<div class="request-thumb photo-placeholder">◇</div>`;
  const person=incoming?`From ${escapeHtml(r.borrowerName)}`:`With ${escapeHtml(r.ownerName)}`;
  const dates=`${escapeHtml(r.startDate)} → ${escapeHtml(r.endDate)}`;
  let actions="";
  if(incoming&&r.status==="pending") actions=`<div class="request-buttons"><button class="primary" data-decision="${r.id}" data-value="approved">Approve</button><button class="secondary" data-decision="${r.id}" data-value="declined">Decline</button></div>`;
  if(r.status==="approved") actions=`<div class="request-buttons"><button class="secondary" data-return="${r.id}">Mark returned</button></div>`;
  return `<article class="request-card">${img}<div class="request-detail"><b>${escapeHtml(r.itemName)}</b><small>${person}<br>${dates}<br>${r.message?escapeHtml(r.message):"No note added."}</small><div class="request-buttons"><span class="status ${r.status==="approved"?"borrowed":r.status==="pending"?"pending":"available"}">${r.status}</span></div>${actions}</div></article>`;
}
function renderRequests() {
  const incoming=state.requests.filter(x=>x.isOwner);
  const outgoing=state.requests.filter(x=>!x.isOwner);
  $("#incomingRequests").innerHTML=incoming.length?incoming.map(x=>requestCard(x,true)).join(""):`<div class="empty-state">No requests for your items yet.</div>`;
  $("#outgoingRequests").innerHTML=outgoing.length?outgoing.map(x=>requestCard(x,false)).join(""):`<div class="empty-state">You haven't requested anything yet.</div>`;
}
function renderGroupChoices() {
  $("#itemGroupChoices").innerHTML=state.groups.length?state.groups.map(g=>`<label class="choice"><input type="checkbox" value="${g.id}">${escapeHtml(g.name)}</label>`).join(""):`<span class="muted tiny">Create or join a group to share pieces.</span>`;
}
function setView(view) {
  state.view=view;
  const labels={closet:["My closet","YOUR PERSONAL WARDROBE","Your closet","Everything you own, all in one place."],discover:["Friends' closets","EXPLORE YOUR CIRCLE","Friends' closets","Find something to borrow before you buy."],requests:["Borrowing","BORROW & LEND","Borrowing","Keep track of requests and returns."],groups:["My groups","YOUR PRIVATE CIRCLES","Your groups","Share pieces with the people you trust."]};
  const [crumb,eyebrow,title,subtitle]=labels[view];
  $("#breadcrumb").innerHTML=`Your space <span>/</span> ${crumb}`; $("#todayLabel").textContent=eyebrow; $("#pageTitle").innerHTML=title+'<span class="period">.</span>'; $("#pageSubtitle").textContent=subtitle;
  $$(".view").forEach(x=>x.classList.add("hidden")); $(`#${view}View`).classList.remove("hidden");
  $$(".nav-link[data-view]").forEach(x=>x.classList.toggle("active",x.dataset.view===view));
  $("#addItemButton").classList.toggle("hidden",view!=="closet");
}
async function boot() {
  try { const data=await api("/api/me"); state.user=data.user; showApp(); await refresh(); }
  catch { showAuth(); }
}
$$(".tab").forEach(b=>b.addEventListener("click",()=>showAuth(b.dataset.authTab)));
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault(); const form=new FormData(e.currentTarget); const body=Object.fromEntries(form.entries());
  $("#authSubmit").disabled=true; $("#authMessage").textContent="";
  try {
    const result=await api(state.authMode==="register"?"/api/auth/register":"/api/auth/login",jsonOptions(body));
    state.user=result.user; showApp(); await refresh(); toast("Welcome to The Shared Closet.");
  } catch(err) { $("#authMessage").textContent=err.message; }
  finally { $("#authSubmit").disabled=false; }
});
$("#logoutButton").addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST"});state.user=null;showAuth();});
$$(".nav-link[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
$("#categoryFilters").addEventListener("click",e=>{const b=e.target.closest("[data-category]");if(!b)return;state.category=b.dataset.category;$$(".filter").forEach(x=>x.classList.toggle("active",x===b));renderItems();});
$("#searchItems").addEventListener("input",renderItems); $("#discoverCategory").addEventListener("change",renderItems);
$("#addItemButton").addEventListener("click",()=>{$("#itemForm").reset();$("#photoPreview").classList.add("hidden");$("#photoPreview").src="";$("#itemMessage").textContent="";renderGroupChoices();$("#itemDialog").showModal();});
$("#photoInput").addEventListener("change",e=>{const file=e.target.files[0];if(!file)return;const img=$("#photoPreview");img.src=URL.createObjectURL(file);img.classList.remove("hidden");});
$("#itemForm").addEventListener("submit",async e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget);const groups=$$('input[type=checkbox]:checked',$("#itemGroupChoices")).map(x=>Number(x.value));fd.set("groupIds",JSON.stringify(groups));
  try{await api("/api/items",{method:"POST",body:fd});$("#itemDialog").close();await refresh();toast("Added to your closet.");}
  catch(err){$("#itemMessage").textContent=err.message;}
});
$("#createGroupForm").addEventListener("submit",async e=>{e.preventDefault();const name=new FormData(e.currentTarget).get("name");try{const d=await api("/api/groups",jsonOptions({name}));await refresh();e.currentTarget.reset();toast(`Group created. Invite code: ${d.group.inviteCode}`);setView("groups");}catch(err){toast(err.message);}});
$("#joinGroupForm").addEventListener("submit",async e=>{e.preventDefault();const code=new FormData(e.currentTarget).get("code");try{await api("/api/groups/join",jsonOptions({code}));await refresh();e.currentTarget.reset();toast("You joined the group.");}catch(err){toast(err.message);}});
$("#groupList").addEventListener("click",async e=>{const b=e.target.closest("[data-copy]");if(!b)return;try{await navigator.clipboard.writeText(b.dataset.copy);toast("Invite code copied.");}catch{toast("Invite code: "+b.dataset.copy);}});
$("#myItems").addEventListener("click",async e=>{const b=e.target.closest("[data-delete]");if(!b)return;if(!confirm("Remove this item from your closet?"))return;try{await api(`/api/items/${b.dataset.delete}`,{method:"DELETE"});await refresh();toast("Item removed.");}catch(err){toast(err.message);}});
$("#sharedItems").addEventListener("click",e=>{const b=e.target.closest("[data-borrow]");if(!b)return;const item=state.items.find(x=>x.id===Number(b.dataset.borrow));if(!item)return;$("#borrowForm").reset();$("#borrowForm [name=itemId]").value=item.id;$("#borrowItemName").textContent=`${item.name} · owned by ${item.ownerName}`;$("#borrowMessage").textContent="";$("#borrowDialog").showModal();});
$("#borrowForm").addEventListener("submit",async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());try{await api("/api/requests",jsonOptions(body));$("#borrowDialog").close();await refresh();toast("Request sent to the owner.");}catch(err){$("#borrowMessage").textContent=err.message;}});
$("#incomingRequests").addEventListener("click",async e=>{const b=e.target.closest("[data-decision]");if(!b)return;try{await api(`/api/requests/${b.dataset.decision}/decision`,jsonOptions({decision:b.dataset.value}));await refresh();toast(b.dataset.value==="approved"?"Request approved.":"Request declined.");}catch(err){toast(err.message);}});
$("#outgoingRequests").addEventListener("click",handleReturn);$("#incomingRequests").addEventListener("click",handleReturn);
async function handleReturn(e){const b=e.target.closest("[data-return]");if(!b)return;try{await api(`/api/requests/${b.dataset.return}/return`,{method:"POST"});await refresh();toast("Marked as returned.");}catch(err){toast(err.message);}}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>$("#"+b.dataset.close).close()));
$("#borrowForm [name=startDate]").addEventListener("change",e=>{$("#borrowForm [name=endDate]").min=e.target.value;});
boot();
