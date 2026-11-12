// Uso: PORT=3199 node e2e-full.mjs   (con la app arrancada: PORT=3199 DB_PATH=data/e2e.db node src/server.js)
const B = `http://127.0.0.1:${process.env.PORT ?? 3199}`;
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: b === undefined ? {} : { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) }); let t = await r.text(); try { t = JSON.parse(t); } catch {} return { s: r.status, b: t, h: r.headers }; };
const rows = [];
const ok = (name, cond, extra = "") => { rows.push([cond ? "OK " : "FALLA", name, cond ? "" : String(extra).slice(0, 200)]); };

// ---- H1 crear grupo
const g = await j("POST", "/api/groups", { name: "Piso 3B", currency: "EUR" });
ok("H1 crear grupo (201, token y enlace)", g.s === 201 && g.b.token?.length === 22 && g.b.url === `/g/${g.b.token}`, JSON.stringify(g));
const T = g.b.token;
ok("H1 moneda por defecto EUR", (await j("POST", "/api/groups", { name: "Sin moneda" })).b.currency === "EUR");
ok("H1 moneda USD/GBP/MXN aceptadas", (await Promise.all(["USD", "GBP", "MXN"].map((c) => j("POST", "/api/groups", { name: "m" + c, currency: c })))).every((r) => r.s === 201));
ok("H1 moneda no admitida → 4xx", (await j("POST", "/api/groups", { name: "x", currency: "JPY" })).s >= 400);
ok("H1 nombre vacío → 422", (await j("POST", "/api/groups", { name: "   " })).s === 422);
ok("H1 nombre de 51 caracteres → 422", (await j("POST", "/api/groups", { name: "a".repeat(51) })).s === 422);
ok("H1 abrir por enlace sin login", (await j("GET", `/api/groups/${T}`)).s === 200);
ok("H1 token inexistente → 404", (await j("GET", "/api/groups/AAAAAAAAAAAAAAAAAAAAAA")).s === 404);
ok("H1 token inválido → 404 uniforme", (await j("GET", "/api/groups/" + "z".repeat(600))).s === 404);

// ---- H2 miembros
const m = {};
for (const n of ["Ana", "Luis", "Marta", "Pablo"]) m[n] = (await j("POST", `/api/groups/${T}/members`, { name: n })).b.id;
ok("H2 añadir 4 miembros", Object.values(m).every(Number.isInteger));
ok("H2 listar en el grupo", (await j("GET", `/api/groups/${T}`)).b.members?.length === 4);
ok("H2 nombre vacío → 422", (await j("POST", `/api/groups/${T}/members`, { name: " " })).s === 422);
ok("H2 duplicado exacto → 409", (await j("POST", `/api/groups/${T}/members`, { name: "Ana" })).s === 409);
ok("H2 duplicado por mayúsculas → 409", (await j("POST", `/api/groups/${T}/members`, { name: "ANA" })).s === 409);
ok("H2 duplicado Unicode NFC/NFD → 409", (await j("POST", `/api/groups/${T}/members`, { name: "José" })).s === 201 && (await j("POST", `/api/groups/${T}/members`, { name: "José" })).s === 409);

// ---- H3 gastos (reparto igual y personalizado)
const ex = async (body) => j("POST", `/api/groups/${T}/expenses`, body);
const e1 = await ex({ description: "Compra", amount_cents: 6000, paid_by_member_id: m.Ana, participants: [m.Ana, m.Luis, m.Marta] });
const e2 = await ex({ description: "Internet", amount_cents: 3000, paid_by_member_id: m.Luis, participants: Object.values(m) });
const e3 = await ex({ description: "Pizza", amount_cents: 1000, paid_by_member_id: m.Marta, participants: [m.Ana, m.Luis, m.Marta] });
const e4 = await ex({ description: "Taxi", amount_cents: 1200, paid_by_member_id: m.Pablo, shares: [{ member_id: m.Ana, share_cents: 600 }, { member_id: m.Pablo, share_cents: 600 }] });
ok("H3 registrar 4 gastos (3 iguales + 1 personalizado)", [e1, e2, e3, e4].every((e) => e.s === 201), JSON.stringify([e1.s, e2.s, e3.s, e4.s]));
const sh3 = e3.b.shares?.map((s) => s.share_cents).sort((a, b) => b - a).join(",");
ok("H3 10,00 entre 3 → 334/333/333 (el total cuadra)", sh3 === "334,333,333", sh3);
ok("H3 importe 0 → 422", (await ex({ description: "x", amount_cents: 0, paid_by_member_id: m.Ana, participants: [m.Ana] })).s === 422);
ok("H3 importe negativo → 422", (await ex({ description: "x", amount_cents: -5, paid_by_member_id: m.Ana, participants: [m.Ana] })).s === 422);
ok("H3 importe no numérico → 422", (await ex({ description: "x", amount_cents: "10", paid_by_member_id: m.Ana, participants: [m.Ana] })).s === 422);
ok("H3 sin participantes → 422", (await ex({ description: "x", amount_cents: 100, paid_by_member_id: m.Ana, participants: [] })).s === 422);
ok("H3 personalizado que no suma → 422 con diferencia", (await ex({ description: "x", amount_cents: 1000, paid_by_member_id: m.Ana, shares: [{ member_id: m.Ana, share_cents: 400 }] })).b.difference_cents === 600);
ok("H3 pagador fuera del grupo → 422", (await ex({ description: "x", amount_cents: 100, paid_by_member_id: 9999, participants: [m.Ana] })).s === 422);
ok("H3 descripción vacía → 422", (await ex({ description: "", amount_cents: 100, paid_by_member_id: m.Ana, participants: [m.Ana] })).s === 422);
ok("H3 participants y shares a la vez → 422", (await ex({ description: "x", amount_cents: 100, paid_by_member_id: m.Ana, participants: [m.Ana], shares: [{ member_id: m.Ana, share_cents: 100 }] })).s === 422);
ok("H3 listar gastos", (await j("GET", `/api/groups/${T}/expenses`)).b?.length === 4 || (await j("GET", `/api/groups/${T}/expenses`)).b?.expenses?.length === 4);

// ---- H4 saldos y "quién paga a quién"
const bal = async () => (await j("GET", `/api/groups/${T}/balances`)).b;
let b = await bal();
const get = (id) => b.balances.find((x) => x.member_id === id)?.balance_cents;
ok("H4 saldo Ana +23,16", get(m.Ana) === 2316, get(m.Ana));
ok("H4 saldo Luis −0,83", get(m.Luis) === -83, get(m.Luis));
ok("H4 saldo Marta −20,83", get(m.Marta) === -2083, get(m.Marta));
ok("H4 saldo Pablo −1,50", get(m.Pablo) === -150, get(m.Pablo));
ok("H4 los saldos suman cero", b.balances.reduce((a, x) => a + x.balance_cents, 0) === 0);
const apply = (bs, trs) => { const o = Object.fromEntries(bs.map((x) => [x.member_id, x.balance_cents])); for (const t of trs) { o[t.from] += t.amount_cents; o[t.to] -= t.amount_cents; } return Object.values(o); };
ok("H4 las transferencias dejan a todos a cero", apply(b.balances, b.transfers).every((v) => v === 0), JSON.stringify(b.transfers));
ok("H4 nº de transferencias ≤ miembros−1", b.transfers.length <= 3, b.transfers.length);
ok("H4 grupo sin gastos → todo a cero / settled", (await j("POST", "/api/groups", { name: "vacío" }).then((r) => j("GET", `/api/groups/${r.b.token}/balances`))).b.settled === true);

// ---- H5 editar y borrar
const put = await j("PUT", `/api/groups/${T}/expenses/${e1.b.id}`, { description: "Compra grande", amount_cents: 9000, paid_by_member_id: m.Ana, participants: [m.Ana, m.Luis, m.Marta] });
ok("H5 editar gasto (200)", put.s === 200, JSON.stringify(put));
b = await bal();
ok("H5 saldos recalculados tras editar (Ana +43,16)", get(m.Ana) === 4316, get(m.Ana));
ok("H5 borrar gasto (204/200)", [200, 204].includes((await j("DELETE", `/api/groups/${T}/expenses/${e3.b.id}`)).s));
b = await bal();
ok("H5 saldos recalculados tras borrar y siguen sumando cero", b.balances.reduce((a, x) => a + x.balance_cents, 0) === 0);
ok("H5 borrar gasto inexistente → 404", (await j("DELETE", `/api/groups/${T}/expenses/999999`)).s === 404);
ok("H5 editar gasto inexistente → 404", (await j("PUT", `/api/groups/${T}/expenses/999999`, { description: "x", amount_cents: 100, paid_by_member_id: m.Ana, participants: [m.Ana] })).s === 404);
{ const g2 = (await j("POST", "/api/groups", { name: "Regla" })).b.token; const a2 = (await j("POST", `/api/groups/${g2}/members`, { name: "Ana" })).b.id; const l2 = (await j("POST", `/api/groups/${g2}/members`, { name: "Luis" })).b.id;
  await j("POST", `/api/groups/${g2}/expenses`, { description: "Cena", amount_cents: 1000, paid_by_member_id: a2, participants: [a2, l2] });
  ok("H2 borrar pagador con gastos → 409", (await j("DELETE", `/api/groups/${g2}/members/${a2}`)).s === 409);
  ok("H2 borrar participante con gastos → 409", (await j("DELETE", `/api/groups/${g2}/members/${l2}`)).s === 409); }
const solo = await j("POST", `/api/groups/${T}/members`, { name: "Sin gastos" });
ok("H2 borrar miembro sin gastos → OK", [200, 204].includes((await j("DELETE", `/api/groups/${T}/members/${solo.b.id}`)).s));

// ---- Frontend (estáticos)
const html = await (await fetch(B + "/")).text();
ok("UI: / sirve HTML", html.includes("<html") || html.includes("<!doctype"), html.slice(0, 80));
const gp = await fetch(B + `/g/${T}`);
const gh = await gp.text();
ok("UI: /g/:token sirve la página del grupo", gp.status === 200 && gh.length > 200);
const assets = new Set([...(html + gh).matchAll(/(?:src|href)="(\/[^"#?]+\.(?:js|css))"/g)].map((x) => x[1]));
let missing = [];
for (const a of assets) { const r = await fetch(B + a); if (r.status !== 200) missing.push(a + ":" + r.status); }
ok(`UI: ${assets.size} recursos JS/CSS se sirven`, assets.size > 0 && missing.length === 0, missing.join(","));
ok("UI: sin scripts inline (CSP)", !/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html + gh));

// ---- Cabeceras y seguridad
const h = (await j("GET", `/api/groups/${T}`)).h;
ok("SEG: cabecera Content-Security-Policy", !!h.get("content-security-policy"));
ok("SEG: X-Content-Type-Options", h.get("x-content-type-options") === "nosniff");
let lim = 0; for (let i = 0; i < 80; i++) { if ((await j("GET", "/api/groups/" + Math.random().toString(36).slice(2).padEnd(22, "a").slice(0, 22))).s === 429) { lim++; break; } }
ok("SEG: rate limit frena la enumeración de tokens (429)", lim > 0);

console.log(rows.map((r) => `${r[0]} ${r[1]}${r[2] ? "  ← " + r[2] : ""}`).join("\n"));
const bad = rows.filter((r) => r[0] !== "OK ").length;
console.log(`\nRESUMEN: ${rows.length - bad}/${rows.length} comprobaciones OK, ${bad} fallan`);
