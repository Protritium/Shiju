const $ = (selector) => document.querySelector(selector);
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};
const GUIDE_VERSION = "v5";
let speechTimer = null;
let activeSpeechButton = null;

const state = {
  words: [], queue: [], index: 0, mode: "all", revealed: false, wordLookup: new Map(), wordIds: new Map(), dictionary: new Map(),
  format: storage.get("shiju-format", "sentence"),
  book: new URLSearchParams(location.search).get("book") || storage.get("shiju-book", "high-school"),
  mistakes: new Set(),
  historicalMistakes: new Set(),
  mistakeAnswers: new Map(),
  mistakeReviews: new Map(),
  learned: new Set(),
  user: null,
  dailyGoal: 20,
  today: { studied: 0, mistakes: 0 },
  todayReviewed: new Set(),
  todayExtraReviewUsed: false,
  history: [],
  authMode: "login",
  saving: false,
  answerHistory: [],
  correctingIds: new Set(),
  pendingMistakeId: null,
  pendingReviewIds: [],
  reviewFailures: new Map(), extraReview: false, mistakeListScrollY: 0, resumeAfterPrevious: null,
  submittedAnswer: ""
};

const books = {
  "cet6": { name: "六级 · 乱序", words: "/data/words.json", examples: "/data/examples.json", phrases: "/data/phrases.json" },
  "high-school": { name: "高中 · 乱序", words: "/data/high-school/words.json", examples: "/data/high-school/examples.json", phrases: "/data/high-school/phrases.json" },
  "postgraduate": { name: "考研 · 乱序", words: "/data/postgraduate/words.json", examples: "/data/postgraduate/examples.json", phrases: "/data/postgraduate/phrases.json" },
  "junior-high": { name: "初中 · 乱序", words: "/data/junior-high/words.json", examples: "/data/junior-high/examples.json", phrases: "/data/junior-high/phrases.json" }
};

function contextFor(item) {
  const content = state.format === "phrase" ? item.phrase?.phrase : item.example?.sentence;
  if (!content) throw new Error(`词条 ${item.word} 缺少${state.format === "phrase" ? "词组" : "例句"}`);
  const index = content.toLocaleLowerCase().indexOf(item.word.toLocaleLowerCase());
  return index < 0
    ? { before: "", target: item.word, after: "" }
    : { before: content.slice(0, index), target: content.slice(index, index + item.word.length), after: content.slice(index + item.word.length) };
}

function setSpeechState(button, message = "") {
  document.querySelectorAll(".speech-tools button").forEach(item => item.classList.toggle("active", item === button));
  activeSpeechButton = button;
  $("#speechStatus").textContent = message;
}

function stopSpeech() {
  clearTimeout(speechTimer);
  speechTimer = null;
  try { if (window.ShijuTTS?.stop) window.ShijuTTS.stop(); } catch {}
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  setSpeechState(null, "");
}

function browserSpeak(text, rate, button, retry = true) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setSpeechState(null, "当前系统未提供英语朗读功能。");
    return;
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length && retry) {
    setSpeechState(null, "正在读取系统英语语音…");
    speechTimer = setTimeout(() => browserSpeak(text, rate, button, false), 400);
    return;
  }
  const english = voices.filter(voice => voice.lang?.toLowerCase().startsWith("en"));
  const voice = english.find(item => item.localService && item.lang.toLowerCase().startsWith("en-us"))
    || english.find(item => item.localService)
    || english.find(item => item.localService !== false);
  if (!voice) {
    setSpeechState(null, "未检测到本地英语语音，请先在系统语言或语音设置中安装英语语音包。");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang || "en-US";
  utterance.rate = rate;
  utterance.pitch = 1;
  utterance.onstart = () => setSpeechState(button, `正在使用系统离线语音 · ${voice.name}`);
  utterance.onend = () => setSpeechState(null, "");
  utterance.onerror = event => {
    if (event.error !== "canceled" && event.error !== "interrupted") setSpeechState(null, "朗读失败，请检查系统英语语音设置。");
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function speakText(text, rate, button, retry = 0) {
  if (retry === 0) stopSpeech();
  if (!text) return;
  try {
    if (window.ShijuTTS?.status && window.ShijuTTS?.speak) {
      const status = window.ShijuTTS.status();
      const detail = window.ShijuTTS.detail ? window.ShijuTTS.detail() : "";
      if (status === "ready" && window.ShijuTTS.speak(text, rate)) {
        setSpeechState(button, detail || "正在使用系统离线英语语音");
        speechTimer = setTimeout(() => setSpeechState(null, ""), Math.max(1800, text.length * 105 / rate));
        return;
      }
      if (status === "ready") {
        setSpeechState(null, detail || "系统语音引擎未接受朗读请求，请检查媒体音量后重试。");
        return;
      }
      if (status === "missing") {
        setSpeechState(null, `${detail || "未安装离线英语语音"}，正在打开系统语音安装页面…`);
        if (window.ShijuTTS.installVoiceData) window.ShijuTTS.installVoiceData();
        return;
      }
      if (retry < 8) {
        setSpeechState(null, "系统英语语音正在初始化…");
        speechTimer = setTimeout(() => speakText(text, rate, button, retry + 1), 400);
        return;
      }
      setSpeechState(null, detail || "系统英语语音初始化超时，请重新打开应用后重试。");
      return;
    }
  } catch {}
  browserSpeak(text, rate, button);
}

function speakCurrentWord() {
  const item = state.queue[state.index];
  if (item) speakText(item.word, 0.6, $("#speakWordBtn"));
}

function speakCurrentContext() {
  const item = state.queue[state.index];
  if (!item) return;
  const content = state.format === "phrase" ? item.phrase?.phrase : item.example?.sentence;
  speakText(content, 0.7, $("#speakContextBtn"));
}

function appendContextText(container, text, currentWord, interactive) {
  if (!interactive) {
    container.append(document.createTextNode(text));
    return;
  }
  const pattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    container.append(document.createTextNode(text.slice(position, match.index)));
    const token = match[0];
    const found = state.wordLookup.get(token.toLocaleLowerCase());
    if (found && token.toLocaleLowerCase() !== currentWord.toLocaleLowerCase()) {
      const button = Object.assign(document.createElement("button"), { type: "button", className: "context-word-link", textContent: token, title: `查看 ${token} 的例句` });
      button.addEventListener("click", () => openWordPopup(found));
      container.append(button);
    } else if (!found) {
      const button = Object.assign(document.createElement("button"), { type: "button", className: "dictionary-word-link", textContent: token, title: `确认后查询 ${token} 的词典释义` });
      button.addEventListener("click", () => openDictionaryPopup(token));
      container.append(button);
    } else {
      container.append(document.createTextNode(token));
    }
    position = match.index + token.length;
  }
  container.append(document.createTextNode(text.slice(position)));
}

function dictionaryEntry(word) {
  return state.dictionary.get(word.toLocaleLowerCase().replaceAll("’", "'"));
}

function renderDictionaryEntry(entry, prefix) {
  $(`#${prefix}Phonetic`).textContent = entry?.phonetic ? `/${entry.phonetic}/` : "";
  $(`#${prefix}Pos`).textContent = [entry?.pos, entry?.headword ? `原形：${entry.headword}` : ""].filter(Boolean).join(" · ");
  $(`#${prefix}Translation`).textContent = entry?.translation || "内置词典暂未收录该词的中文释义。";
}

function renderContext(item, interactive = false) {
  const context = contextFor(item);
  const container = $("#contextSentence");
  container.replaceChildren();
  appendContextText(container, context.before, item.word, interactive);
  container.append(Object.assign(document.createElement("span"), { className: "target-word", textContent: context.target }));
  appendContextText(container, context.after, item.word, interactive);
}

function openWordPopup(item) {
  $("#popupModeLabel").textContent = "WORD BOOK + DICTIONARY";
  $("#popupWord").textContent = item.word;
  $("#popupMeaning").textContent = item.meaning;
  $("#popupExample").textContent = item.example?.sentence || "暂无例句";
  $("#popupTranslation").textContent = item.example?.translation || "暂无中文翻译";
  $("#popupBookSection").classList.remove("hidden");
  $("#popupBookExamples").classList.remove("hidden");
  renderDictionaryEntry(dictionaryEntry(item.word), "popupDictionary");
  $("#wordPopup").classList.remove("hidden");
  $("#closeWordPopup").focus();
}

function openDictionaryPopup(word) {
  if (!window.confirm(`“${word}”不在当前词书中，是否使用内置词典查询其含义？`)) return;
  $("#popupModeLabel").textContent = "BUILT-IN DICTIONARY";
  $("#popupWord").textContent = word;
  $("#popupBookSection").classList.add("hidden");
  $("#popupBookExamples").classList.add("hidden");
  renderDictionaryEntry(dictionaryEntry(word), "popupDictionary");
  $("#wordPopup").classList.remove("hidden");
  $("#closeWordPopup").focus();
}

function closeWordPopup() {
  $("#wordPopup").classList.add("hidden");
}

function setFormat(format) {
  state.format = format;
  storage.set("shiju-format", format);
  document.querySelectorAll(".format").forEach(button => button.classList.toggle("active", button.dataset.format === format));
  if (state.mode !== "mistakes") render();
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function wordKey(item) { return item.word.toLocaleLowerCase(); }
function idsForWord(item) { return state.wordIds.get(wordKey(item)) || [item.id]; }
function wordIsMarked(set, item) { return idsForWord(item).some(id => set.has(id)); }
function wordMarks(set, item) { return idsForWord(item).filter(id => set.has(id)); }

function mistakeAnswerFor(item) {
  for (const id of idsForWord(item)) {
    if (state.mistakeAnswers.has(id)) return state.mistakeAnswers.get(id);
  }
  return "";
}

function restoreWordMarks(set, item, markedIds) {
  for (const id of idsForWord(item)) set.delete(id);
  for (const id of markedIds) set.add(id);
}

function setWordMarked(set, item, marked) {
  const ids = idsForWord(item);
  for (const id of ids) set.delete(id);
  if (marked) set.add(ids[0] || item.id);
}

function uniqueWords(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = wordKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function markedWordCount(set) {
  if (!state.wordIds.size) return set.size;
  let count = 0;
  for (const ids of state.wordIds.values()) if (ids.some(id => set.has(id))) count += 1;
  return count;
}

function renderOverallProgress() {
  const total = state.wordIds.size || uniqueWords(state.words).length;
  const learned = Math.min(markedWordCount(state.learned), total);
  $("#progressLabel").textContent = `${learned} / ${total}`;
  $("#progressBar").style.width = total ? `${learned / total * 100}%` : "0%";
}

function updateDashboard() {
  $("#mistakeCount").textContent = markedWordCount(state.mistakes);
  $("#learnedCount").textContent = markedWordCount(state.learned);
  if (state.mode === "all" && state.wordIds.size) renderOverallProgress();
  $("#todayStudied").textContent = state.today.studied;
  $("#todayMistakes").textContent = state.today.mistakes;
  $("#goalInput").value = state.dailyGoal;
  $("#goalText").textContent = `${state.today.studied} / ${state.dailyGoal}`;
  $("#goalBar").style.width = `${Math.min(100, state.today.studied / state.dailyGoal * 100)}%`;
  $("#mobileGoalText").textContent = `${state.today.studied} / ${state.dailyGoal}`;
  $("#mobileGoalBar").style.width = `${Math.min(100, state.today.studied / state.dailyGoal * 100)}%`;
  $("#historyList").replaceChildren(...state.history.map(row => {
    const item = document.createElement("div");
    item.className = "history-row";
    item.replaceChildren(
      Object.assign(document.createElement("span"), { textContent: row.date }),
      Object.assign(document.createElement("b"), { textContent: `学习 ${row.studied}` }),
      Object.assign(document.createElement("span"), { textContent: `错题 ${row.mistakes}` })
    );
    return item;
  }));
}

function applyProgress(progress) {
  state.mistakes = new Set(progress.mistakes || []);
  state.historicalMistakes = new Set(progress.historicalMistakes || progress.mistakes || []);
  state.mistakeAnswers = new Map(Object.entries(progress.mistakeAnswers || {}));
  state.mistakeReviews = new Map(Object.entries(progress.mistakeReviews || {}));
  state.learned = new Set(progress.learned || []);
  state.dailyGoal = progress.dailyGoal || 20;
  state.today = progress.today || { studied: 0, mistakes: 0 };
  state.todayReviewed = new Set(progress.today?.reviewed || []);
  state.todayExtraReviewUsed = Boolean(progress.today?.extraReviewUsed);
  state.history = progress.history || [];
  updateDashboard();
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.user) showAuth();
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

async function saveProgress(activity = null) {
  updateDashboard();
  const progress = await api(`/api/progress?book=${encodeURIComponent(state.book)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mistakes: [...state.mistakes], learned: [...state.learned], dailyGoal: state.dailyGoal, activity })
  });
  applyProgress(progress);
}
async function markExtraReviewUsed() {
  const progress = await api(`/api/progress?book=${encodeURIComponent(state.book)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mistakes: [...state.mistakes], learned: [...state.learned], dailyGoal: state.dailyGoal, extraReviewStart: true }) });
  applyProgress(progress);
}

async function loadBook(bookId) {
  const config = books[bookId];
  if (!config) throw new Error("未知词书");
  state.book = bookId;
  storage.set("shiju-book", bookId);
  const url = new URL(location.href);
  if (bookId === "cet6") url.searchParams.delete("book");
  else url.searchParams.set("book", bookId);
  history.replaceState(null, "", url);
  $("#bookSelect").value = bookId;
  $("#footerBook").textContent = `${config.name}词书`;
  document.title = `拾句 · ${config.name.replace(" · 乱序", "")}词汇`;
  $("#loading").classList.remove("hidden");
  showOnly("#loading");
  const [wordsResponse, examplesResponse, phrasesResponse, progressResponse, dictionaryResponse] = await Promise.all([
    fetch(config.words, { cache: "no-store" }),
    fetch(config.examples, { cache: "no-store" }),
    fetch(config.phrases, { cache: "no-store" }),
    api(`/api/progress?book=${encodeURIComponent(bookId)}`, { cache: "no-store" }),
    state.dictionary.size ? Promise.resolve(null) : fetch("/data/dictionary.json", { cache: "no-store" })
  ]);
  if (!wordsResponse.ok) throw new Error(`无法读取${config.name}词书数据`);
  if (!examplesResponse.ok) throw new Error(`无法读取${config.name}例句库`);
  if (!phrasesResponse.ok) throw new Error(`无法读取${config.name}词组库`);
  if (dictionaryResponse && !dictionaryResponse.ok) throw new Error("无法读取内置词典");
  const [words, examples, phrases, dictionary] = await Promise.all([wordsResponse.json(), examplesResponse.json(), phrasesResponse.json(), dictionaryResponse ? dictionaryResponse.json() : null]);
  if (dictionary) state.dictionary = new Map(Object.entries(dictionary));
  state.words = words.map(item => ({ ...item, example: examples[item.word] || item.example, phrase: phrases[item.word] }));
  state.wordLookup = new Map();
  state.wordIds = new Map();
  for (const item of state.words) {
    const key = wordKey(item);
    if (!state.wordLookup.has(key)) state.wordLookup.set(key, item);
    if (!state.wordIds.has(key)) state.wordIds.set(key, []);
    state.wordIds.get(key).push(item.id);
  }
  applyProgress(progressResponse);
  const missing = state.words.filter(item => !item.example?.sentence || !item.phrase?.phrase);
  if (missing.length) throw new Error(`有 ${missing.length} 个词条缺少词组或例句`);
  $("#loading").classList.add("hidden");
  setMode("all");
}

function setMode(mode) {
  state.mode = mode;
  state.index = 0;
  state.answerHistory = [];
  state.correctingIds.clear();
  state.pendingMistakeId = null;
  state.pendingReviewIds = [];
  state.reviewFailures.clear(); state.extraReview = false; state.resumeAfterPrevious = null;
  $("#bookSelect").value = mode === "mistake-random" ? "mistake-review" : mode === "history-random" ? "history-review" : state.book;
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === (mode === "all" ? "all" : "mistakes")));
  if (mode === "mistakes") {
    renderMistakeList();
  } else if (mode === "mistake-random") {
    state.queue = shuffled(mistakeWords().filter(item => !idsForWord(item).some(id => state.todayReviewed.has(id))));
    render();
  } else if (mode === "history-random") {
    state.queue = shuffled(historicalMistakeWords());
    render();
  } else {
    state.queue = shuffled(uniqueWords(state.words.filter(word => !wordIsMarked(state.learned, word) || wordIsMarked(state.mistakes, word))));
    render();
  }
}

function showOnly(view) {
  ["#card", "#mistakeList", "#emptyState"].forEach(selector => $(selector).classList.add("hidden"));
  $(view).classList.remove("hidden");
}

function mistakeWords() {
  return uniqueWords(state.words.filter(word => wordIsMarked(state.mistakes, word)));
}

function mistakeReviewCountFor(item) {
  return Math.max(0, ...idsForWord(item).map(id => Number(state.mistakeReviews.get(id) || 0)));
}

function historicalMistakeWords() {
  return uniqueWords(state.words.filter(word => wordIsMarked(state.historicalMistakes, word)));
}

function isMobileStudyViewport() {
  return window.matchMedia("(max-width: 780px)").matches;
}

function leaveMobileStudyView() {
  document.body.classList.remove("mobile-study-view", "mobile-answer-view", "keyboard-open");
  try { window.ShijuUI?.hideKeyboard(); } catch {}
  if (document.activeElement === $("#answerInput")) $("#answerInput").blur();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function focusAnswerInput() {
  const input = $("#answerInput");
  if (!input || state.revealed || $("#card").classList.contains("hidden")
      || !$("#guideOverlay").classList.contains("hidden") || !$("#authOverlay").classList.contains("hidden")) return;
  if (isMobileStudyViewport()) document.body.classList.add("mobile-study-view");
  try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  if (isMobileStudyViewport()) {
    try { window.ShijuUI?.showKeyboard(); } catch {}
    $("#card").scrollIntoView({ block: "start", behavior: "auto" });
    setTimeout(keepMobileAnswerVisible, 140);
  }
}

function renderMistakeList() {
  leaveMobileStudyView();
  state.mode = "mistakes";
  state.revealed = false;
  state.pendingMistakeId = null;
  state.pendingReviewIds = [];
  const words = mistakeWords();
  $("#progressLabel").textContent = `${words.length} 个错词`;
  $("#progressBar").style.width = "0%";
  $("#listCount").textContent = `${words.length} 个词`;
  $("#mistakePreviousBtn").classList.toggle("hidden", !state.answerHistory.some(record => record.mode === "mistake-study"));
  $("#mistakeItems").replaceChildren(...words.map((item, index) => {
    const row = document.createElement("div");
    row.className = "mistake-item";
    const number = Object.assign(document.createElement("span"), { className: "number", textContent: String(index + 1).padStart(2, "0") });
    const wordButton = document.createElement("button");
    wordButton.className = "mistake-word";
    const word = Object.assign(document.createElement("b"), { textContent: item.word });
    const count = mistakeReviewCountFor(item);
    const pos = Object.assign(document.createElement("small"), { textContent: `${item.pos || "word"} · 已温习 ${count} 次` });
    wordButton.append(word, pos);
    wordButton.addEventListener("click", () => startMistakeReview(item));
    const remove = Object.assign(document.createElement("button"), { className: "remove-mistake", textContent: count > 2 ? "移除" : `再温习 ${3 - count} 次` });
    remove.disabled = count <= 2;
    remove.setAttribute("aria-label", `将 ${item.word} 移出错题本`);
    remove.addEventListener("click", () => removeMistake(item));
    row.append(number, wordButton, remove);
    return row;
  }));
  if (!words.length) {
    $("#emptyMessage").textContent = "错题本还是空的，继续保持。";
    $("#emptyPreviousBtn").classList.toggle("hidden", !state.answerHistory.length);
    showOnly("#emptyState");
  } else {
    showOnly("#mistakeList");
    requestAnimationFrame(() => window.scrollTo({ top: state.mistakeListScrollY, behavior: "auto" }));
  }
}

function startMistakeReview(item) {
  state.mistakeListScrollY = window.scrollY;
  state.mode = "mistake-study";
  state.queue = [item];
  state.index = 0;
  render();
}

async function removeMistake(item) {
  if (mistakeReviewCountFor(item) <= 2) {
    alert("这个错词需完成至少 3 次温习后才能移除。");
    return;
  }
  const previousMarks = wordMarks(state.mistakes, item);
  setWordMarked(state.mistakes, item, false);
  try {
    await saveProgress();
    renderMistakeList();
  } catch (error) {
    restoreWordMarks(state.mistakes, item, previousMarks);
    updateDashboard();
    alert(error.message);
  }
}

function render() {
  stopSpeech();
  closeWordPopup();
  document.body.classList.remove("mobile-answer-view", "keyboard-open");
  const item = state.queue[state.index];
  state.revealed = false;
  $("#reveal").classList.add("hidden");
  $("#returnToStudyBtn").classList.add("hidden");
  $("#answerForm").classList.remove("hidden");
  $("#answerInput").value = "";
  state.submittedAnswer = "";
  if (state.mode === "all") {
    renderOverallProgress();
  } else {
    $("#progressLabel").textContent = `${Math.min(state.index + 1, state.queue.length)} / ${state.queue.length}`;
    $("#progressBar").style.width = state.queue.length ? `${state.index / state.queue.length * 100}%` : "0%";
  }
  $("#previousBtn").classList.toggle("hidden", !state.answerHistory.length);
  $("#mobilePreviousBtn").classList.toggle("hidden", !state.answerHistory.length);

  if (!item) {
    leaveMobileStudyView();
    $("#emptyMessage").textContent = state.mode === "history-random"
      ? "当前词书还没有历史错题。"
      : state.mode === "mistake-random" && state.todayExtraReviewUsed ? "今日额外随机温习也已完成。"
      : state.mode === "mistake-random" ? "已完成今日错题温习。可以额外随机温习一次，但不会增加温习次数。" : "这一轮已经完成，休息一下吧。";
    $("#emptyPreviousBtn").classList.toggle("hidden", !state.answerHistory.length);
    $("#restartBtn").textContent = state.mode === "mistake-random" ? "额外随机温习" : "重新开始";
    $("#restartBtn").classList.toggle("hidden", state.mode === "mistake-random" && state.todayExtraReviewUsed);
    showOnly("#emptyState");
    return;
  }
  showOnly("#card");
  $("#restartBtn").classList.remove("hidden");
  const reviewingMistake = state.mode === "mistake-study";
  $("#backToMistakesBtn").classList.toggle("hidden", !reviewingMistake);
  $("#shuffleBtn").classList.toggle("hidden", reviewingMistake);
  updateActionLabels(item);
  $("#positionText").textContent = `WORD ${String(state.index + 1).padStart(3, "0")} · ${item.pos.toUpperCase() || "WORD"}`;
  $("#speakContextLabel").textContent = state.format === "phrase" ? "朗读词组" : "朗读例句";
  renderContext(item);
  $("#previousMistakeAnswer").classList.add("hidden");
  if (isMobileStudyViewport()) {
    if (document.body.classList.contains("mobile-study-view")) {
      setTimeout(focusAnswerInput, 80);
      setTimeout(focusAnswerInput, 280);
    }
  } else {
    setTimeout(focusAnswerInput, 80);
  }
}

function updateActionLabels(item) {
  const shortcutLocked = state.pendingMistakeId === item.id;
  const itemIsMistake = wordIsMarked(state.mistakes, item);
  const reviewCount = mistakeReviewCountFor(item);
  $("#rememberBtn").innerHTML = shortcutLocked
    ? "<span>→</span> 下一题（已加入错题本）"
    : itemIsMistake && reviewCount < 2 ? `<span>✓</span> 温习并保留（${reviewCount}/3）`
    : itemIsMistake && reviewCount === 2 ? "<span>✓</span> 完成第 3 次并移除"
    : itemIsMistake ? "<span>✓</span> 记住了并移除" : "<span>✓</span> 我记住了";
  $("#mistakeBtn").innerHTML = itemIsMistake ? "<span>×</span> 回忆失败（保留错题）" : "<span>＋</span> 加入错题本";
}

async function revealAnswer(event) {
  event.preventDefault();
  const value = $("#answerInput").value.trim();
  if (!value) return;
  const item = state.queue[state.index];
  const shortcutMistake = value === "2";
  state.submittedAnswer = value;
  if (shortcutMistake) {
    const previousMistakes = wordMarks(state.mistakes, item);
    const previousLearned = wordMarks(state.learned, item);
    setWordMarked(state.mistakes, item, true);
    setWordMarked(state.learned, item, true);
    state.pendingMistakeId = item.id;
    state.pendingReviewIds = previousMistakes;
    state.saving = true;
    $("#answerForm button[type='submit']").disabled = true;
    try {
      await saveProgress({ wordId: item.id, mistake: true, correction: false, answer: value });
    } catch (error) {
      restoreWordMarks(state.mistakes, item, previousMistakes);
      restoreWordMarks(state.learned, item, previousLearned);
      state.pendingMistakeId = null;
      state.pendingReviewIds = [];
      updateDashboard();
      alert(error.message);
      return;
    } finally {
      state.saving = false;
      $("#answerForm button[type='submit']").disabled = false;
    }
  }
  showAnswer(item, value, shortcutMistake);
  enterMobileAnswerView();
}

function showAnswer(item, value, shortcutMistake) {
  state.submittedAnswer = value;
  state.revealed = true;
  renderContext(item, true);
  $("#userAnswer").textContent = shortcutMistake ? "快捷标记：已加入错题本" : value;
  $("#correctAnswer").textContent = item.meaning;
  renderDictionaryEntry(dictionaryEntry(item.word), "targetDictionary");
  const source = item.example;
  $("#sentenceTranslation").textContent = item.example?.translation || "该词书暂未生成整句中文翻译";
  $("#exampleSource").replaceChildren();
  if (state.format === "phrase") {
    $("#contextMetaLabel").textContent = "词组说明";
    $("#exampleSource").textContent = "由项目在本地生成，搭配词优先选用简单常用词";
  } else if (source?.sourceUrl) {
    $("#contextMetaLabel").textContent = "例句来源";
    const link = Object.assign(document.createElement("a"), { href: source.sourceUrl, target: "_blank", rel: "noopener", textContent: `${source.source} · ${source.sourceId}` });
    $("#exampleSource").append(link, document.createTextNode(` · ${source.license}`));
  } else {
    $("#contextMetaLabel").textContent = "例句来源";
    $("#exampleSource").textContent = "本地人工补充例句";
  }
  $("#answerForm").classList.add("hidden");
  $("#reveal").classList.remove("hidden");
  const previousMistakeAnswer = mistakeAnswerFor(item);
  const reviewingMistakes = ["mistake-study", "mistake-random", "history-random"].includes(state.mode);
  $("#previousMistakeAnswer").classList.toggle("hidden", !reviewingMistakes || !previousMistakeAnswer);
  $("#previousMistakeAnswerText").textContent = previousMistakeAnswer === "2" ? "2（当时表示实在不记得）" : previousMistakeAnswer;
  $("#returnToStudyBtn").classList.toggle("hidden", !state.resumeAfterPrevious);
  updateActionLabels(item);
}

function alignMobileAnswerView() {
  if (!document.body.classList.contains("mobile-answer-view")) return;
  $("#card").scrollIntoView({ block: "start", behavior: "auto" });
}

function enterMobileAnswerView() {
  if (!isMobileStudyViewport()) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.body.classList.remove("keyboard-open");
  document.body.classList.add("mobile-study-view", "mobile-answer-view");
  requestAnimationFrame(alignMobileAnswerView);
  setTimeout(alignMobileAnswerView, 120);
  setTimeout(alignMobileAnswerView, 360);
}

async function next(markMistake) {
  if (state.saving) return;
  const item = state.queue[state.index];
  if (!item) return;
  const shortcutLocked = state.pendingMistakeId === item.id;
  const effectiveMistake = markMistake || shortcutLocked;
  const wasMistakeIds = wordMarks(state.mistakes, item);
  const wasLearnedIds = wordMarks(state.learned, item);
  const reviewIds = shortcutLocked ? state.pendingReviewIds : wasMistakeIds;
  const correction = state.correctingIds.has(item.id);
  const record = { item, index: state.index, mode: state.mode, wasMistakeIds, wasLearnedIds, shortcutLocked, reviewIds, answer: state.submittedAnswer };
  setWordMarked(state.mistakes, item, effectiveMistake);
  setWordMarked(state.learned, item, true);
  record.afterMistakeIds = wordMarks(state.mistakes, item);
  record.afterLearnedIds = wordMarks(state.learned, item);
  state.saving = true;
  $("#rememberBtn").disabled = true;
  $("#mistakeBtn").disabled = true;
  try {
    await saveProgress({ wordId: item.id, mistake: effectiveMistake, correction, reviewSuccess: reviewIds.length > 0 && !effectiveMistake, reviewIds, answer: effectiveMistake ? state.submittedAnswer : undefined });
    record.afterMistakeIds = wordMarks(state.mistakes, item);
    record.afterLearnedIds = wordMarks(state.learned, item);
  } catch (error) {
    restoreWordMarks(state.mistakes, item, wasMistakeIds);
    restoreWordMarks(state.learned, item, wasLearnedIds);
    updateDashboard();
    alert(error.message);
    return;
  } finally {
    state.saving = false;
    $("#rememberBtn").disabled = false;
    $("#mistakeBtn").disabled = false;
  }
  state.correctingIds.delete(item.id);
  state.resumeAfterPrevious = null;
  state.pendingMistakeId = null;
  state.pendingReviewIds = [];
  record.requeued = false;
  const remainsMistake = wordIsMarked(state.mistakes, item);
  const failureKey = wordKey(item); const failureCount = state.reviewFailures.get(failureKey) || 0;
  const mayRepeat = state.mode !== "mistake-random" || failureCount < 1;
  if (state.mode !== "mistake-study" && remainsMistake && mayRepeat) {
    const alreadyAhead = state.queue.slice(state.index + 1).some(queued => wordKey(queued) === wordKey(item));
    if (!alreadyAhead) {
      state.queue.push(item);
      record.requeued = true;
      if (state.mode === "mistake-random") state.reviewFailures.set(failureKey, failureCount + 1);
    }
  }
  state.answerHistory.push(record);
  if (state.mode === "mistake-study") {
    renderMistakeList();
    return;
  }
  state.index += 1;
  render();
}

async function goPrevious() {
  if (state.saving || !state.answerHistory.length) return;
  const record = state.answerHistory[state.answerHistory.length - 1];
  const resume = { mode: state.mode, index: state.index, record };
  restoreWordMarks(state.mistakes, record.item, record.wasMistakeIds);
  restoreWordMarks(state.learned, record.item, record.wasLearnedIds);
  state.saving = true;
  try {
    await saveProgress();
  } catch (error) {
    restoreWordMarks(state.mistakes, record.item, record.afterMistakeIds);
    restoreWordMarks(state.learned, record.item, record.afterLearnedIds);
    updateDashboard();
    alert(error.message);
    return;
  } finally {
    state.saving = false;
  }
  state.answerHistory.pop();
  state.resumeAfterPrevious = resume;
  if (record.requeued) {
    const repeatedIndex = state.queue.findIndex((item, index) => index > record.index && wordKey(item) === wordKey(record.item));
    if (repeatedIndex >= 0) state.queue.splice(repeatedIndex, 1);
  }
  state.correctingIds.add(record.item.id);
  state.pendingMistakeId = record.shortcutLocked ? record.item.id : null;
  state.pendingReviewIds = record.shortcutLocked ? record.reviewIds : [];
  state.mode = record.mode;
  state.index = record.index;
  if (!state.queue.some(item => item.id === record.item.id)) state.queue = [record.item];
  render();
  showAnswer(record.item, record.answer || "", record.answer === "2");
  enterMobileAnswerView();
}

async function returnToStudy() {
  const resume = state.resumeAfterPrevious; if (!resume || state.saving) return;
  const { record } = resume; restoreWordMarks(state.mistakes, record.item, record.afterMistakeIds); restoreWordMarks(state.learned, record.item, record.afterLearnedIds);
  if (record.requeued && !state.queue.slice(record.index + 1).some(item => wordKey(item) === wordKey(record.item))) state.queue.push(record.item);
  state.saving = true; try { await saveProgress(); } catch (error) { alert(error.message); return; } finally { state.saving = false; }
  state.answerHistory.push(record); state.resumeAfterPrevious = null; state.mode = resume.mode; state.index = resume.index; if (resume.mode === "mistakes") renderMistakeList(); else render();
}

function guideStorageKey(username) {
  return `shiju-guide-${GUIDE_VERSION}:${username.toLocaleLowerCase()}`;
}

function showGuide(force = false) {
  if (!state.user) return;
  if (!force && storage.get(guideStorageKey(state.user), false)) return;
  $("#guideOverlay").classList.remove("hidden");
  $("#startLearningBtn").focus();
}

function closeGuide() {
  if (state.user) storage.set(guideStorageKey(state.user), true);
  $("#guideOverlay").classList.add("hidden");
  if (!state.revealed && (!isMobileStudyViewport() || document.body.classList.contains("mobile-study-view"))) {
    setTimeout(focusAnswerInput, 30);
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  $("#loginModeBtn").classList.toggle("active", mode === "login");
  $("#registerModeBtn").classList.toggle("active", mode === "register");
  $("#authSubmit").textContent = mode === "login" ? "登录" : "创建账户";
  $("#authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#authError").textContent = "";
}

function showAuth() {
  leaveMobileStudyView();
  state.user = null;
  state.mistakes.clear();
  state.historicalMistakes.clear();
  state.learned.clear();
  $("#guideOverlay").classList.add("hidden");
  $("#authOverlay").classList.remove("hidden");
  $("#usernameLabel").textContent = "";
  setTimeout(() => $("#authUsername").focus(), 50);
}

async function enterApp(username) {
  state.user = username;
  $("#usernameLabel").textContent = username;
  $("#loading").textContent = "正在翻开词书…";
  await loadBook(state.book);
  $("#authOverlay").classList.add("hidden");
  showGuide();
  if (!isMobileStudyViewport() && $("#guideOverlay").classList.contains("hidden")) setTimeout(focusAnswerInput, 80);
}

function openDataSync() {
  leaveMobileStudyView();
  $("#dataSyncStatus").textContent = "";
  $("#dataSyncOverlay").classList.remove("hidden");
  $("#exportBackupBtn").focus();
}
function closeDataSync() { $("#dataSyncOverlay").classList.add("hidden"); $("#backupFileInput").value = ""; }
async function exportLearningData() {
  const button = $("#exportBackupBtn"); button.disabled = true; $("#dataSyncStatus").textContent = "正在整理学习数据…";
  try {
    const backup = await api("/api/backup", { cache: "no-store" });
    const json = JSON.stringify(backup, null, 2); const filename = `shiju-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (window.ShijuUI?.exportBackup) window.ShijuUI.exportBackup(json, filename);
    else { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([json], { type: "application/json" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
    $("#dataSyncStatus").textContent = "备份已生成，请在系统窗口中选择保存位置。";
  } catch (error) { $("#dataSyncStatus").textContent = error.message; } finally { button.disabled = false; }
}
async function importLearningData(file) {
  if (!file) return;
  if (file.size > 5_000_000) { $("#dataSyncStatus").textContent = "备份文件不能超过 5 MB。"; return; }
  $("#dataSyncStatus").textContent = "正在安全合并学习数据…";
  try {
    const backup = JSON.parse(await file.text());
    const result = await api("/api/backup/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backup }) });
    await loadBook(state.book); $("#dataSyncStatus").textContent = result.message || "学习数据已安全合并。";
  } catch (error) { $("#dataSyncStatus").textContent = error instanceof SyntaxError ? "无法读取该文件：JSON 格式无效。" : error.message; } finally { $("#backupFileInput").value = ""; }
}

async function init() {
  setFormat(state.format);
  try {
    const session = await api("/api/session", { cache: "no-store" });
    if (session.authenticated) await enterApp(session.username);
    else showAuth();
  } catch (error) {
    $("#loading").textContent = `${error.message}，请用 python3 server.py 启动应用。`;
  }
}

$("#answerForm").addEventListener("submit", revealAnswer);
$("#speakWordBtn").addEventListener("click", speakCurrentWord);
$("#speakContextBtn").addEventListener("click", speakCurrentContext);
$("#stopSpeechBtn").addEventListener("click", stopSpeech);
$("#rememberBtn").addEventListener("click", () => next(false));
$("#mistakeBtn").addEventListener("click", () => next(true));
$("#mobileExitStudyBtn").addEventListener("click", leaveMobileStudyView);
$("#shuffleBtn").addEventListener("click", () => {
  state.queue = shuffled(state.queue.slice(state.index));
  state.index = 0;
  state.answerHistory = [];
  state.correctingIds.clear();
  render();
});
$("#restartBtn").addEventListener("click", async () => {
  if (state.mode === "mistake-random") { try { await markExtraReviewUsed(); } catch (error) { alert(error.message); return; } state.extraReview = true; state.reviewFailures.clear(); state.queue = shuffled(mistakeWords()); state.index = 0; state.answerHistory = []; render(); return; }
  if (state.mode === "all") {
    state.learned.clear();
    try { await saveProgress(); setMode("all"); } catch (error) { alert(error.message); }
  } else {
    setMode(state.mode === "mistake-study" ? "mistakes" : state.mode);
  }
});
$("#goalForm").addEventListener("submit", async event => {
  event.preventDefault();
  const goal = Number($("#goalInput").value);
  if (!Number.isInteger(goal) || goal < 1 || goal > 1000) return;
  state.dailyGoal = goal;
  try { await saveProgress(); } catch (error) { alert(error.message); }
});
$("#historyBtn").addEventListener("click", () => {
  $("#historyList").classList.toggle("hidden");
  $("#historyBtn").textContent = $("#historyList").classList.contains("hidden") ? "查看学习记录" : "收起学习记录";
});
$("#mobileToolsToggle").addEventListener("click", () => {
  const open = $(".rail").classList.toggle("mobile-tools-open");
  $("#mobileToolsToggle").setAttribute("aria-expanded", String(open));
  $("#mobileToolsToggle span").textContent = open ? "⌃" : "⌄";
});
$("#loginModeBtn").addEventListener("click", () => setAuthMode("login"));
$("#registerModeBtn").addEventListener("click", () => setAuthMode("register"));
$("#authForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#authError").textContent = "";
  $("#authSubmit").disabled = true;
  try {
    const endpoint = state.authMode === "login" ? "/api/login" : "/api/register";
    const result = await api(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("#authUsername").value, password: $("#authPassword").value })
    });
    $("#authPassword").value = "";
    await enterApp(result.username);
  } catch (error) {
    $("#authError").textContent = error.message;
  } finally {
    $("#authSubmit").disabled = false;
  }
});
$("#guideBtn").addEventListener("click", () => showGuide(true));
$("#dataSyncBtn").addEventListener("click", openDataSync);
$("#closeDataSyncBtn").addEventListener("click", closeDataSync);
$("#exportBackupBtn").addEventListener("click", exportLearningData);
$("#backupFileInput").addEventListener("change", event => importLearningData(event.target.files?.[0]));
$("#dataSyncOverlay").addEventListener("click", event => { if (event.target === $("#dataSyncOverlay")) closeDataSync(); });
$("#closeGuideBtn").addEventListener("click", closeGuide);
$("#startLearningBtn").addEventListener("click", closeGuide);
$("#logoutBtn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {}
  showAuth();
});
$("#backToMistakesBtn").addEventListener("click", renderMistakeList);
$("#closeWordPopup").addEventListener("click", closeWordPopup);
$("#wordPopup").addEventListener("click", event => { if (event.target === $("#wordPopup")) closeWordPopup(); });
$("#previousBtn").addEventListener("click", goPrevious);
$("#mobilePreviousBtn").addEventListener("click", goPrevious);
$("#emptyPreviousBtn").addEventListener("click", goPrevious);
$("#mistakePreviousBtn").addEventListener("click", goPrevious);
$("#returnToStudyBtn").addEventListener("click", returnToStudy);
document.querySelector(".brand").addEventListener("click", event => { event.preventDefault(); setMode("all"); });
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
document.querySelectorAll(".format").forEach(button => button.addEventListener("click", () => setFormat(button.dataset.format)));
$("#bookSelect").addEventListener("change", async event => {
  if (event.target.value === "mistake-review") {
    setMode("mistake-random");
    return;
  }
  if (event.target.value === "history-review") {
    setMode("history-random");
    return;
  }
  try {
    await loadBook(event.target.value);
  } catch (error) {
    $("#loading").textContent = error.message;
  }
});
function keepMobileAnswerVisible() {
  if (!window.matchMedia("(max-width: 780px)").matches || document.activeElement !== $("#answerInput")) return;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const inputRect = $("#answerInput").getBoundingClientRect();
  if (inputRect.bottom > viewportHeight - 12) {
    window.scrollBy({ top: inputRect.bottom - viewportHeight + 12, behavior: "smooth" });
  }
}

$("#answerInput").addEventListener("focus", () => {
  if (!isMobileStudyViewport()) return;
  document.body.classList.add("mobile-study-view", "keyboard-open");
  $("#card").scrollIntoView({ block: "start" });
  setTimeout(keepMobileAnswerVisible, 120);
  setTimeout(keepMobileAnswerVisible, 360);
});
$("#answerInput").addEventListener("blur", () => {
  setTimeout(() => document.body.classList.remove("keyboard-open"), 120);
});
window.visualViewport?.addEventListener("resize", () => {
  keepMobileAnswerVisible();
  if (document.body.classList.contains("mobile-answer-view")) setTimeout(alignMobileAnswerView, 50);
});
window.ShijuHandleBack = () => {
  if (!$("#wordPopup").classList.contains("hidden")) { closeWordPopup(); return true; }
  if (!$("#dictionarySearchOverlay").classList.contains("hidden")) { closeDictionarySearch(); return true; }
  if (!$("#dataSyncOverlay").classList.contains("hidden")) { closeDataSync(); return true; }
  if (!$("#guideOverlay").classList.contains("hidden")) { closeGuide(); return true; }
  if (state.mode === "mistake-study") { renderMistakeList(); return true; }
  if (document.body.classList.contains("mobile-study-view") || document.body.classList.contains("mobile-answer-view")) {
    leaveMobileStudyView();
    return true;
  }
  return false;
};
document.addEventListener("keydown", event => {
  if (!$("#dataSyncOverlay").classList.contains("hidden")) { if (event.key === "Escape") closeDataSync(); return; }
  if (!$("#dictionarySearchOverlay").classList.contains("hidden")) {
    if (event.key === "Escape") closeDictionarySearch();
    return;
  }
  if (!$("#guideOverlay").classList.contains("hidden")) {
    if (event.key === "Escape") closeGuide();
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && !$("#wordPopup").classList.contains("hidden")) {
    closeWordPopup();
    return;
  }
  if (!state.revealed) return;
  if (event.key === "1") next(false);
  if (event.key === "2") next(true);
});
init();
