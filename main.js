/* ===================== V O C A B   T R A I N E R ===================== */
/* Data keys (extend existing KEY) */
KEY.VOCAB_SETTINGS = "ph_vocab_settings";
KEY.VOCAB_DECKS = "ph_vocab_decks";
KEY.VOCAB_CARDS = "ph_vocab_cards";

/* Ensure defaults on load */
(function ensureVocabDefaults() {
    const s = store.get(KEY.VOCAB_SETTINGS);
    if (!s) {
        store.set(KEY.VOCAB_SETTINGS, {
            dailyTarget: 20,
            planTotal: 200,
            planDays: 10,
            start: todayStr(),
            end: addDaysStr(10),
            activeDeckId: ""
        });
    }
    if (!store.get(KEY.VOCAB_DECKS)) store.set(KEY.VOCAB_DECKS, []);
    if (!store.get(KEY.VOCAB_CARDS)) store.set(KEY.VOCAB_CARDS, []);
})();

/* Utility */
function parseBulkLines(text) {
    return (text || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(line => {
        const [w, meaning] = line.split("|");
        return { word: (w || "").trim().toLowerCase(), meaning: (meaning || "").trim() };
    });
}
function randPick(arr, n = 1) { const a = [...arr]; const out = []; while (a.length && out.length < n) { out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); } return out; }
function todayISO() { return todayStr(); }
function compareISO(a, b) { return a === b ? 0 : (a < b ? -1 : 1); }
function nextDateISO(days) { return addDaysStr(days); }

/* SM-2 scheduler */
function sm2Schedule(card, quality) {
    // quality: 0–5
    const q = Math.max(0, Math.min(5, Number(quality) || 0));
    let { ef = 2.5, rep = 0, interval = 0 } = card;
    if (q < 3) {
        rep = 0;
        interval = 1;
    } else {
        if (rep === 0) { interval = 1; rep = 1; }
        else if (rep === 1) { interval = 6; rep = 2; }
        else { interval = Math.round(interval * ef); rep += 1; }
        ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
        if (ef < 1.3) ef = 1.3;
    }
    card.ef = ef; card.rep = rep; card.interval = interval;
    card.due = nextDateISO(interval);
    card.last = Date.now();
    return card;
}

/* Forms & Derivations (simple heuristics for forms) */
function deriveForms(word, posList) {
    const w = word || "";
    const forms = {};
    if (posList.includes("verb")) {
        forms.verb = {
            s: w.endsWith("s") ? w : (w + "s"),
            ed: w.endsWith("e") ? (w + "d") : (w + "ed"),
            ing: w.endsWith("e") ? (w.slice(0, -1) + "ing") : (w + "ing")
        };
    }
    if (posList.includes("noun")) {
        forms.noun = { plural: (w.endsWith("s") ? w : w + "s") };
    }
    if (posList.includes("adjective")) {
        forms.adj = { adv: (w + "ly") };
    }
    return forms;
}

/* Dictionary API enrichment (graceful fallback) */
async function enrichWord(word) {
    const base = { word, synonyms: [], antonyms: [], pos: [], example: "" };
    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        if (!res.ok) return base;
        const json = await res.json();
        const first = Array.isArray(json) ? json[0] : null;
        if (!first || !Array.isArray(first.meanings)) return base;
        const pos = new Set();
        const syn = new Set();
        const ant = new Set();
        let example = "";
        first.meanings.forEach(m => {
            if (m.partOfSpeech) pos.add(m.partOfSpeech);
            if (Array.isArray(m.synonyms)) m.synonyms.forEach(x => syn.add(x));
            if (Array.isArray(m.antonyms)) m.antonyms.forEach(x => ant.add(x));
            if (!example && Array.isArray(m.definitions)) {
                const def = m.definitions.find(d => d.example);
                if (def && def.example) example = def.example;
            }
        });
        const out = {
            word,
            synonyms: Array.from(syn).slice(0, 10),
            antonyms: Array.from(ant).slice(0, 10),
            pos: Array.from(pos),
            example
        };
        out.forms = deriveForms(word, out.pos);
        return out;
    } catch (_e) { return base; }
}

/* Render helpers */
function renderDeckList() {
    const decks = store.get(KEY.VOCAB_DECKS, []);
    const settings = store.get(KEY.VOCAB_SETTINGS, {});
    const ul = $("#vDeckList"); ul.innerHTML = "";
    if (!decks.length) { ul.innerHTML = `<div class="empty">Chưa có deck.</div>`; }
    decks.forEach(d => {
        const div = document.createElement("div"); div.className = "item";
        div.innerHTML = `
      <div>
        <div><b>${escapeHtml(d.name)}</b></div>
        <div class="small-muted">ID: ${d.id}</div>
      </div>
      <div class="row">
        <button class="btn ghost" data-vset-active="${d.id}">${settings.activeDeckId === d.id ? '✅ Active' : 'Set active'}</button>
        <button class="btn danger" data-vdelete-deck="${d.id}">🗑️</button>
      </div>`;
        ul.appendChild(div);
    });

    // selectors
    const sel = $("#vDeckSelect"); sel.innerHTML = "";
    decks.forEach(d => {
        const opt = document.createElement("option"); opt.value = d.id; opt.textContent = d.name;
        if (d.id === settings.activeDeckId) opt.selected = true;
        sel.appendChild(opt);
    });

    // bind
    $$('[data-vset-active]').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-vset-active');
            const s = store.get(KEY.VOCAB_SETTINGS, {});
            s.activeDeckId = id; store.set(KEY.VOCAB_SETTINGS, s);
            $("#vActiveDeckName").textContent = (store.get(KEY.VOCAB_DECKS, []).find(x => x.id === id)?.name) || "—";
            renderDeckList();
        }
    });
    $$('[data-vdelete-deck]').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-vdelete-deck');
            if (!confirm("Xoá deck này? Tất cả cards thuộc deck cũng bị xoá.")) return;
            const decks = store.get(KEY.VOCAB_DECKS, []).filter(d => d.id !== id);
            const cards = store.get(KEY.VOCAB_CARDS, []).filter(c => c.deckId !== id);
            const s = store.get(KEY.VOCAB_SETTINGS, {});
            if (s.activeDeckId === id) s.activeDeckId = "";
            store.set(KEY.VOCAB_DECKS, decks); store.set(KEY.VOCAB_CARDS, cards); store.set(KEY.VOCAB_SETTINGS, s);
            renderDeckList(); renderVocabKPIs();
        }
    });
}

function getDueCardsForToday() {
    const today = todayISO();
    const cards = store.get(KEY.VOCAB_CARDS, []);
    const due = cards.filter(c => !c.due || compareISO(c.due, today) <= 0);
    return due;
}
function renderVocabKPIs() {
    const due = getDueCardsForToday().length;
    $("#vocabDueToday").textContent = due;
    // KPI pill in header (create once)
    let pill = document.getElementById("kpi-vocab");
    if (!pill) {
        const wrap = document.querySelector(".kpi");
        if (wrap) {
            pill = document.createElement("span");
            pill.className = "pill"; pill.id = "kpi-vocab";
            pill.innerHTML = `📘 Từ cần ôn: <b>${due}</b>`;
            wrap.appendChild(pill);
        }
    } else {
        pill.innerHTML = `📘 Từ cần ôn: <b>${due}</b>`;
    }
    // stats
    $("#vStatTotal") && ($("#vStatTotal").textContent = store.get(KEY.VOCAB_CARDS, []).length);
    $("#vStatDue") && ($("#vStatDue").textContent = due);
    const efAvg = (() => { const arr = store.get(KEY.VOCAB_CARDS, []); if (!arr.length) return "—"; const s = arr.reduce((a, b) => a + (b.ef || 2.5), 0); return (s / arr.length).toFixed(2); })();
    $("#vStatEF") && ($("#vStatEF").textContent = efAvg);
}

/* Planner */
function initPlanner() {
    const s = store.get(KEY.VOCAB_SETTINGS, {});
    const f = $("#vPlanForm");
    f.start.value = s.start || todayISO();
    f.total.value = s.planTotal || 200;
    f.days.value = s.planDays || 10;
    f.end.value = s.end || addDaysStr(s.planDays || 10);
    const quota = Math.ceil((s.planTotal || 200) / Math.max(1, (s.planDays || 10)));
    $("#vDailyQuota").textContent = quota;
    const decks = store.get(KEY.VOCAB_DECKS, []);
    $("#vActiveDeckName").textContent = decks.find(x => x.id === s.activeDeckId)?.name || "—";
    $("#vPlanSummary").textContent = `Plan ${s.planTotal} từ trong ${s.planDays} ngày • Quota/ngày ≈ ${quota}.`;

    f.oninput = () => {
        const start = f.start.value || todayISO();
        const days = Math.max(1, Number(f.days.value || 10));
        f.end.value = addDaysStr(days, new Date(start));
    };
    f.onsubmit = (e) => {
        e.preventDefault();
        const start = f.start.value || todayISO();
        const days = Math.max(1, Number(f.days.value || 10));
        const total = Math.max(1, Number(f.total.value || 200));
        const end = addDaysStr(days, new Date(start));
        const next = { ...s, start, planDays: days, planTotal: total, end, dailyTarget: Math.ceil(total / days) };
        store.set(KEY.VOCAB_SETTINGS, next);
        $("#vDailyQuota").textContent = next.dailyTarget;
        $("#vPlanSummary").textContent = `Plan ${total} từ trong ${days} ngày • Quota/ngày ≈ ${next.dailyTarget}.`;
        alert("Đã lưu Planner.");
    };

    // reset schedule (keep cards)
    $("#vResetSM2").onclick = () => {
        if (!confirm("Reset toàn bộ lịch ôn (due=Hôm nay, rep=0, interval=0, EF=2.5)?")) return;
        const arr = store.get(KEY.VOCAB_CARDS, []).map(c => ({ ...c, ef: 2.5, rep: 0, interval: 0, due: todayISO() }));
        store.set(KEY.VOCAB_CARDS, arr); renderVocabKPIs(); alert("Đã reset lịch ôn.");
    }
}

/* Deck + Import */
function initDeck() {
    renderDeckList();
    $("#vDeckForm").onsubmit = (e) => {
        e.preventDefault();
        const name = e.target.name.value.trim(); if (!name) return;
        const decks = store.get(KEY.VOCAB_DECKS, []);
        const id = uid();
        decks.push({ id, name, created_at: Date.now() }); store.set(KEY.VOCAB_DECKS, decks);
        const s = store.get(KEY.VOCAB_SETTINGS, {}); if (!s.activeDeckId) { s.activeDeckId = id; store.set(KEY.VOCAB_SETTINGS, s); }
        renderDeckList(); initPlanner(); e.target.reset();
    };

    $("#vImportForm").onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const entries = parseBulkLines(f.bulk.value);
        if (!entries.length) { alert("Không có dữ liệu."); return; }
        const deckId = f.deck.value || store.get(KEY.VOCAB_SETTINGS, {}).activeDeckId;
        if (!deckId) { alert("Chọn/tạo deck trước."); return; }
        const doEnrich = f.enrich.value === "yes";
        const cards = store.get(KEY.VOCAB_CARDS, []);
        for (const it of entries) {
            let payload = { word: it.word, meaning: it.meaning || "", synonyms: [], antonyms: [], pos: [], example: "", forms: {} };
            if (doEnrich) { const e = await enrichWord(it.word); payload = { ...payload, ...e }; if (!payload.meaning) payload.meaning = it.meaning || ""; }
            if (!payload.forms) payload.forms = deriveForms(payload.word, payload.pos || []);
            cards.push({
                id: uid(), deckId, ...payload,
                ef: 2.5, rep: 0, interval: 0, due: todayISO(), last: 0
            });
        }
        store.set(KEY.VOCAB_CARDS, cards);
        renderVocabKPIs();
        alert(`Đã import ${entries.length} từ vào deck.`);
        f.reset(); renderDeckList();
    };
}

/* TRAIN SESSION */
let vSession = { queue: [], idx: 0, mode: "auto" };

function pickModeFor(card) {
    const modes = ["flash", "quiz", "cloze", "sentence"];
    if ((card.synonyms || []).length < 1 && (card.antonyms || []).length < 1) {
        return Math.random() < 0.5 ? "flash" : "sentence";
    }
    return modes[Math.floor(Math.random() * modes.length)];
}

function renderFlash(card) {
    const el = document.createElement("div");
    el.innerHTML = `
    <div class="flash-front" id="vfFront"><b>${escapeHtml(card.word)}</b><div class="small-muted">${(card.pos || []).join(", ") || ""}</div></div>
    <div class="flash-back" id="vfBack" style="display:none">
      <div><b>Nghĩa:</b> ${escapeHtml(card.meaning || "(chưa có)")}</div>
      <div><b>Synonyms:</b> ${escapeHtml((card.synonyms || []).slice(0, 5).join(", ") || "—")}</div>
      <div><b>Antonyms:</b> ${escapeHtml((card.antonyms || []).slice(0, 5).join(", ") || "—")}</div>
      <div><b>Ví dụ:</b> ${escapeHtml(card.example || "—")}</div>
      <div><b>Forms:</b> <code>${escapeHtml(JSON.stringify(card.forms || {}, null, 0))}</code></div>
    </div>
    <div class="flash-actions" style="margin-top:8px">
      <button class="btn" id="vShow">👁️ Show</button>
    </div>`;
    el.querySelector("#vShow").onclick = () => {
        $("#vfFront", el).style.display = "none";
        $("#vfBack", el).style.display = "block";
    };
    return el;
}
function renderQuiz(card) {
    // Build a synonym quiz if possible; else antonym; else fallback to definition T/F
    const container = document.createElement("div");
    container.className = "quiz-card";
    let question = "", answer = "", choices = [];
    if ((card.synonyms || []).length >= 1) {
        question = `Chọn từ đồng nghĩa với “${card.word}”`;
        answer = randPick(card.synonyms, 1)[0];
        const pool = store.get(KEY.VOCAB_CARDS, []).flatMap(c => c.synonyms || []).filter(x => x && x !== answer);
        const distractors = randPick(pool, 3);
        choices = randPick([answer, ...distractors], 4);
    } else if ((card.antonyms || []).length >= 1) {
        question = `Chọn từ trái nghĩa với “${card.word}”`;
        answer = randPick(card.antonyms, 1)[0];
        const pool = store.get(KEY.VOCAB_CARDS, []).flatMap(c => c.antonyms || []).filter(x => x && x !== answer);
        const distractors = randPick(pool, 3);
        choices = randPick([answer, ...distractors], 4);
    } else {
        question = `“${card.word}” có nghĩa gần với:`;
        answer = (card.meaning || "").split(/[;,]/)[0] || "(chưa có)";
        const pool = store.get(KEY.VOCAB_CARDS, []).map(c => (c.meaning || "").split(/[;,]/)[0]).filter(x => x && x !== answer);
        const distractors = randPick(pool, 3);
        choices = randPick([answer, ...distractors], 4);
    }
    container.innerHTML = `<div><b>${escapeHtml(question)}</b></div>`;
    const wrap = document.createElement("div"); wrap.className = "row"; wrap.style.marginTop = "6px";
    choices.forEach(c => {
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "choice"; btn.textContent = c;
        btn.onclick = () => {
            if (c === answer) { btn.classList.add("correct"); }
            else { btn.classList.add("wrong"); }
        };
        wrap.appendChild(btn);
    });
    container.appendChild(wrap);
    container.appendChild(Object.assign(document.createElement("div"), { className: "small-muted", innerHTML: `Đáp án: <b>${escapeHtml(answer)}</b>` }));
    return container;
}
function renderCloze(card) {
    const ex = card.example || `I will use the word "${card.word}" in a sentence.`;
    // hide the target word
    const regex = new RegExp(`\\b${card.word}\\b`, "gi");
    const cloze = ex.replace(regex, "_____");
    const el = document.createElement("div"); el.className = "cloze-card";
    el.innerHTML = `
    <div><b>Điền khuyết</b></div>
    <div style="margin-top:6px">${escapeHtml(cloze)}</div>
    <div class="row" style="margin-top:8px">
      <input id="vClozeAns" placeholder="Từ còn thiếu là gì?">
      <button class="btn" id="vCheckCloze">Kiểm tra</button>
    </div>
    <div class="small-muted">Gốc: ${escapeHtml(ex)}</div>
  `;
    el.querySelector("#vCheckCloze").onclick = () => {
        const a = el.querySelector("#vClozeAns").value.trim().toLowerCase();
        alert(a === card.word.toLowerCase() ? "✅ Chính xác." : `❌ Chưa đúng. Đáp án: ${card.word}`);
    };
    return el;
}
function renderSentence(card) {
    const el = document.createElement("div"); el.className = "sentence-card";
    el.innerHTML = `
    <div><b>Tự đặt câu với “${escapeHtml(card.word)}”</b></div>
    <textarea id="vSentence" rows="3" placeholder="Viết câu của bạn..."></textarea>
    <div class="row" style="margin-top:8px">
      <span class="small-muted">Gợi ý: ${escapeHtml(card.meaning || "—")} | Syn: ${(card.synonyms || []).slice(0, 3).join(", ") || "—"}</span>
    </div>
  `;
    return el;
}

function renderCardUI(card, mode) {
    const area = $("#vCardArea"); area.innerHTML = "";
    let m = mode === "auto" ? pickModeFor(card) : mode;
    let view;
    if (m === "flash") view = renderFlash(card);
    else if (m === "quiz") view = renderQuiz(card);
    else if (m === "cloze") view = renderCloze(card);
    else view = renderSentence(card);
    area.appendChild(view);
}

/* Session lifecycle */
function startSession() {
    const settings = store.get(KEY.VOCAB_SETTINGS, {});
    const quota = Number($("#vBatch").value || settings.dailyTarget || 20);
    const allDue = getDueCardsForToday();
    // Bring new words first up to daily target; shuffle
    const queue = randPick(allDue, Math.min(quota, allDue.length));
    vSession.queue = queue; vSession.idx = 0; vSession.mode = $("#vMode").value || "auto";
    if (!queue.length) { alert("Không có thẻ đến hạn."); $("#vSession").style.display = "none"; return; }
    $("#vSession").style.display = "block";
    renderCardUI(queue[0], vSession.mode);
}

function submitGrade(skip = false) {
    if (!vSession.queue.length) return;
    const card = vSession.queue[vSession.idx];
    if (!skip) {
        const val = Number((document.querySelector('input[name="vGrade"]:checked') || {}).value || 3);
        sm2Schedule(card, val);
        // persist
        const arr = store.get(KEY.VOCAB_CARDS, []);
        const i = arr.findIndex(x => x.id === card.id);
        if (i > -1) arr[i] = card;
        store.set(KEY.VOCAB_CARDS, arr);
    }
    vSession.idx++;
    if (vSession.idx >= vSession.queue.length) {
        alert("Hoàn tất session 🎉"); $("#vSession").style.display = "none"; renderVocabKPIs(); return;
    }
    renderCardUI(vSession.queue[vSession.idx], vSession.mode);
}

/* Tabs */
function bindVocabTabs() {
    const tabs = $$(".tab[data-vtab]");
    const panes = $$("[data-vpane]");
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => x.classList.remove("active"));
            t.classList.add("active");
            const id = t.getAttribute("data-vtab");
            panes.forEach(p => { p.style.display = (p.getAttribute("data-vpane") === id) ? "block" : "none"; });
        }
    });
}

/* Export/Import (Vocab-aware) — overrides global buttons to include vocab */
function exportAllPlus() {
    const payload = {
        product: "MinhNgh Hub",
        version: 2,
        exported_at: new Date().toISOString(),
        data: {
            PROFILE: store.get(KEY.PROFILE, CONFIG.profile),
            CLASSES: store.get(KEY.CLASSES, []),
            LIFE: store.get(KEY.LIFE, []),
            TODOS: store.get(KEY.TODOS, []),
            VOCAB_SETTINGS: store.get(KEY.VOCAB_SETTINGS, {}),
            VOCAB_DECKS: store.get(KEY.VOCAB_DECKS, []),
            VOCAB_CARDS: store.get(KEY.VOCAB_CARDS, []),
        }
    };
    download(`minhngh_hub_export_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
}
function importAllPlusText(text, { mode = "replace" } = {}) {
    const payload = safeParseJSON(text);
    if (!payload || !payload.data) { alert("File import không hợp lệ."); return; }
    // Auto-backup
    try { exportAllPlus(); } catch (_e) { }
    const d = payload.data;
    if (mode === "replace") {
        if (d.PROFILE) store.set(KEY.PROFILE, d.PROFILE);
        if (d.CLASSES) store.set(KEY.CLASSES, d.CLASSES);
        if (d.LIFE) store.set(KEY.LIFE, d.LIFE);
        if (d.TODOS) store.set(KEY.TODOS, d.TODOS);
        if (d.VOCAB_SETTINGS) store.set(KEY.VOCAB_SETTINGS, d.VOCAB_SETTINGS);
        if (d.VOCAB_DECKS) store.set(KEY.VOCAB_DECKS, d.VOCAB_DECKS);
        if (d.VOCAB_CARDS) store.set(KEY.VOCAB_CARDS, d.VOCAB_CARDS);
    } else {
        // merge smart for TODOS/CLASSES, append for LIFE, replace PROFILE/SETTINGS
        if (d.PROFILE) store.set(KEY.PROFILE, d.PROFILE);
        if (d.VOCAB_SETTINGS) store.set(KEY.VOCAB_SETTINGS, d.VOCAB_SETTINGS);
        // merge by id helper
        const mergeById = (oldArr, newArr) => mergeArraysById(oldArr || [], newArr || [], "id");
        if (d.CLASSES) store.set(KEY.CLASSES, mergeById(store.get(KEY.CLASSES, []), d.CLASSES));
        if (d.TODOS) store.set(KEY.TODOS, mergeById(store.get(KEY.TODOS, []), d.TODOS));
        if (d.LIFE) {
            const oldLife = store.get(KEY.LIFE, []);
            const keyLife = it => `${it.day}|${it.block}|${(it.title || "").trim().toLowerCase()}`;
            const seen = new Set(oldLife.map(keyLife));
            const appended = [...oldLife];
            (d.LIFE || []).forEach(it => { const k = keyLife(it); if (!seen.has(k)) { appended.push(it); seen.add(k); } });
            store.set(KEY.LIFE, appended);
        }
        if (d.VOCAB_DECKS) store.set(KEY.VOCAB_DECKS, mergeById(store.get(KEY.VOCAB_DECKS, []), d.VOCAB_DECKS));
        if (d.VOCAB_CARDS) store.set(KEY.VOCAB_CARDS, mergeById(store.get(KEY.VOCAB_CARDS, []), d.VOCAB_CARDS));
    }
    // Ensure IDs for imported records
    ensureIdsAfterImport();
    renderAll();
    renderDeckList();
    renderVocabKPIs();
    alert("Import thành công (bao gồm Vocab).");
}

/* Lightweight vocab-only export/import from Stats tab */
function exportVocabOnly() {
    const payload = {
        product: "MinhNgh Hub Vocab",
        version: 1,
        exported_at: new Date().toISOString(),
        data: {
            VOCAB_SETTINGS: store.get(KEY.VOCAB_SETTINGS, {}),
            VOCAB_DECKS: store.get(KEY.VOCAB_DECKS, []),
            VOCAB_CARDS: store.get(KEY.VOCAB_CARDS, []),
        }
    };
    download(`minhngh_vocab_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
}
function importVocabOnlyText(text) {
    const p = safeParseJSON(text);
    if (!p || !p.data) { alert("File không hợp lệ."); return; }
    const d = p.data;
    if (d.VOCAB_SETTINGS) store.set(KEY.VOCAB_SETTINGS, d.VOCAB_SETTINGS);
    if (d.VOCAB_DECKS) store.set(KEY.VOCAB_DECKS, d.VOCAB_DECKS);
    if (d.VOCAB_CARDS) store.set(KEY.VOCAB_CARDS, d.VOCAB_CARDS);
    renderDeckList(); renderVocabKPIs(); alert("Đã import Vocab.");
}

/* Wiring */
document.addEventListener("DOMContentLoaded", () => {
    // Tabs
    bindVocabTabs();
    // Planner/Deck
    initPlanner();
    initDeck();
    renderVocabKPIs();

    // Train buttons
    $("#vStartSession").onclick = startSession;
    $("#vocabStartBtn").onclick = () => {
        // quick launch into Train tab
        document.querySelector('.tab[data-vtab="train"]').click();
        startSession();
    };
    $("#vSubmitGrade").onclick = () => submitGrade(false);
    $("#vSkip").onclick = () => submitGrade(true);

    // Stats export/import (vocab only)
    $("#vExportVocab").onclick = exportVocabOnly;
    $("#vImportVocabFile").onchange = (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const reader = new FileReader(); reader.onload = () => importVocabOnlyText(String(reader.result || ""));
        reader.readAsText(file, "utf-8");
    };

    // Upgrade global Export/Import to include Vocab (override handlers)
    const exportBtn = document.getElementById("exportBtn");
    if (exportBtn) exportBtn.onclick = exportAllPlus;

    const importBtn = document.getElementById("importBtn");
    if (importBtn) importBtn.onclick = () => {
        const mode = confirm("OK = REPLACE (ghi đè), Cancel = MERGE (gộp thông minh).") ? "replace" : "merge";
        const fi = document.getElementById("importFile");
        fi.value = "";
        fi.onchange = (e) => {
            const file = e.target.files?.[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = () => importAllPlusText(String(reader.result || ""), { mode });
            reader.readAsText(file, "utf-8");
        };
        fi.click();
    };
    /* ======= VOCAB STORAGE ======= */
    KEY.VOCAB = "ph_vocab"; // { decks: {id:{id,name,words:[{id,term,meaning,pos,notes}] }}, activeDeckId:null }

    function ensureVocab() {
        let v = store.get(KEY.VOCAB, null);
        if (!v) {
            v = { decks: {}, activeDeckId: null };
            store.set(KEY.VOCAB, v);
        }
        // bảo toàn cấu trúc
        if (!v.decks) v.decks = {};
        if (!('activeDeckId' in v)) v.activeDeckId = null;
        store.set(KEY.VOCAB, v);
        return v;
    }
    function saveVocab(v) { store.set(KEY.VOCAB, v); }
    function newId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
    /* ======= VOCAB RENDER ======= */
    let selectedWordIds = new Set();

    function renderVocabDeckList() {
        const v = ensureVocab();

        // Render dropdown chọn deck ở form import
        const sel = $("#vDeckSelect");
        sel.innerHTML = "";
        Object.values(v.decks).forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.id; opt.textContent = d.name;
            sel.appendChild(opt);
        });
        // sync active deck
        if (v.activeDeckId && v.decks[v.activeDeckId]) {
            sel.value = v.activeDeckId;
        } else if (sel.options.length > 0) {
            v.activeDeckId = sel.value = sel.options[0].value;
            saveVocab(v);
        } else {
            sel.innerHTML = `<option value="">(Chưa có deck)</option>`;
            v.activeDeckId = null; saveVocab(v);
        }

        // Render list deck (bảng bên trái)
        const list = $("#vDeckList");
        list.innerHTML = "";
        if (Object.keys(v.decks).length === 0) {
            list.innerHTML = `<div class="empty">Chưa có deck nào.</div>`;
        } else {
            Object.values(v.decks).forEach(d => {
                const div = document.createElement("div");
                div.className = "item";
                const active = d.id === v.activeDeckId ? '<span class="badge ok">Active</span>' : '';
                div.innerHTML = `
        <div>
          <div class="row small">
            <b>${d.name}</b> ${active}
            <span class="badge">#${(d.words || []).length} từ</span>
          </div>
        </div>
        <div class="row">
          <button class="btn ghost" data-vdeck-activate="${d.id}">✔️ Dùng</button>
          <button class="btn danger" data-vdeck-del="${d.id}">🗑️</button>
        </div>`;
                list.appendChild(div);
            });

            // Activate deck
            $$('#vDeckList [data-vdeck-activate]').forEach(btn => {
                btn.onclick = () => {
                    const id = btn.getAttribute('data-vdeck-activate');
                    const vv = ensureVocab();
                    if (vv.decks[id]) { vv.activeDeckId = id; saveVocab(vv); }
                    $("#vActiveDeckName").textContent = vv.decks[id]?.name || "—";
                    selectedWordIds.clear(); $("#vSelWordsCount").textContent = 0;
                    renderVocabDeckList(); renderVocabWords();
                };
            });

            // Delete deck (giữ nút stats “Xoá deck đang chọn” như cũ)
            $$('#vDeckList [data-vdeck-del]').forEach(btn => {
                btn.onclick = () => {
                    const id = btn.getAttribute('data-vdeck-del');
                    const vv = ensureVocab();
                    if (!vv.decks[id]) return;
                    if (!confirm(`Xoá deck "${vv.decks[id].name}"?`)) return;
                    delete vv.decks[id];
                    if (vv.activeDeckId === id) vv.activeDeckId = Object.keys(vv.decks)[0] || null;
                    saveVocab(vv);
                    selectedWordIds.clear(); $("#vSelWordsCount").textContent = 0;
                    renderVocabDeckList(); renderVocabWords();
                };
            });
        }

        // Label active name
        const activeName = v.activeDeckId ? (v.decks[v.activeDeckId]?.name || "—") : "—";
        $("#vActiveDeckName").textContent = activeName;
    }

    function renderVocabWords() {
        const v = ensureVocab();
        const root = $("#vWordList");
        root.innerHTML = "";
        const deck = v.activeDeckId ? v.decks[v.activeDeckId] : null;
        if (!deck) { root.innerHTML = `<div class="empty">Chưa chọn deck.</div>`; return; }

        const words = deck.words || [];
        if (!words.length) { root.innerHTML = `<div class="empty">Deck trống.</div>`; return; }

        words.forEach(w => {
            const div = document.createElement("div");
            div.className = "item";
            const checked = selectedWordIds.has(String(w.id)) ? "checked" : "";
            div.innerHTML = `
      <div>
        <div class="row small">
          <label class="pill small">
            <input type="checkbox" data-vword-sel="${w.id}" ${checked} style="margin-right:6px">
            <b>${w.term}</b>
          </label>
          ${w.meaning ? `<span class="badge">${w.meaning}</span>` : ''}
          ${w.pos ? `<span class="badge">${w.pos}</span>` : ''}
        </div>
        ${w.notes ? `<div class="muted small" style="margin-top:6px">${w.notes}</div>` : ''}
      </div>
      <div class="row">
        <button class="btn ghost" data-vword-del="${w.id}">🗑️</button>
      </div>`;
            root.appendChild(div);
        });

        // single delete
        $$('#vWordList [data-vword-del]').forEach(btn => {
            btn.onclick = () => {
                const id = String(btn.getAttribute('data-vword-del'));
                const vv = ensureVocab();
                const d = vv.decks[vv.activeDeckId];
                d.words = (d.words || []).filter(x => String(x.id) !== id);
                saveVocab(vv);
                selectedWordIds.delete(id);
                $("#vSelWordsCount").textContent = selectedWordIds.size;
                renderVocabWords();
            };
        });

        // select
        $$('#vWordList [data-vword-sel]').forEach(cb => {
            cb.onchange = () => {
                const id = String(cb.getAttribute('data-vword-sel'));
                if (cb.checked) selectedWordIds.add(id); else selectedWordIds.delete(id);
                $("#vSelWordsCount").textContent = selectedWordIds.size;
            };
        });
    }
    $("#vDeleteSelectedWords").onclick = () => {
        const v = ensureVocab();
        const did = v.activeDeckId;
        if (!did || !v.decks[did]) { alert("Hãy chọn deck trước."); return; }
        if (selectedWordIds.size === 0) { alert("Chưa chọn từ nào."); return; }
        if (!confirm(`Xoá ${selectedWordIds.size} từ đã chọn?`)) return;
        const deck = v.decks[did];
        deck.words = (deck.words || []).filter(w => !selectedWordIds.has(String(w.id)));
        saveVocab(v);
        selectedWordIds.clear();
        $("#vSelWordsCount").textContent = 0;
        $("#vSelectAllWords").checked = false;
        populateDeckSelects();
        renderVocabDeckList();
        renderVocabWords();
    };

});
/* =================== END VOCAB TRAINER =================== */
