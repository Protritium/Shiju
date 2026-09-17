const DICTIONARY_SEARCH_DEFAULT_HINT = "支持英文查释义和中文反查英文；查询不会加入错题本。";
let dictionarySearchTrigger = null;
const CONFUSABLE_NOTES = {
  steel: "易混淆：steel /stiːl/ 是“钢铁”；steal /stiːl/ 是“偷”（动词）；thief /θiːf/ 才是“小偷”（名词）。",
  steal: "易混淆：steal /stiːl/ 是“偷”（动词）；steel /stiːl/ 是“钢铁”；thief /θiːf/ 是“小偷”（名词）。",
  thief: "易混淆：thief /θiːf/ 是“小偷”（名词）；steal /stiːl/ 是“偷”（动词）；steel /stiːl/ 是“钢铁”。",
  quiet: "易混淆：quiet 表示“安静的”，quite 表示“相当、很”。",
  quite: "易混淆：quite 表示“相当、很”，quiet 表示“安静的”。",
  accept: "易混淆：accept 表示“接受”，except 表示“除……之外”。",
  except: "易混淆：except 表示“除……之外”，accept 表示“接受”。",
  affect: "易混淆：affect 通常是动词“影响”，effect 通常是名词“效果、影响”。",
  effect: "易混淆：effect 通常是名词“效果、影响”，affect 通常是动词“影响”。",
  principal: "易混淆：principal 可表示“校长、主要的”，principle 表示“原则”。",
  principle: "易混淆：principle 表示“原则”，principal 可表示“校长、主要的”。"
};

function dictionarySearchMatches(query) {
  const normalized = query.trim().toLocaleLowerCase().replaceAll("’", "'");
  if (!normalized) return [];
  const englishQuery = /^[a-z][a-z' -]*$/i.test(normalized);
  const matches = [];
  for (const [word, entry] of state.dictionary.entries()) {
    const normalizedWord = word.toLocaleLowerCase();
    const bookItem = state.wordLookup.get(normalizedWord);
    const bookMeaning = bookItem?.meaning || "";
    const translation = entry?.translation || "";
    let score = Number.POSITIVE_INFINITY;
    if (englishQuery) {
      if (normalizedWord === normalized) score = 0;
      else if ((entry?.headword || "").toLocaleLowerCase() === normalized) score = 2;
      else if (normalizedWord.startsWith(normalized)) score = 10 + normalizedWord.length / 100;
      else if (normalizedWord.includes(normalized)) score = 20 + normalizedWord.indexOf(normalized) + normalizedWord.length / 100;
    } else {
      const bookIndex = bookMeaning.indexOf(query);
      const dictionaryIndex = translation.indexOf(query);
      if (bookIndex >= 0) score = Math.min(score, 10 + bookIndex / 100 + normalizedWord.length / 1000);
      if (dictionaryIndex >= 0) score = Math.min(score, 20 + dictionaryIndex / 100 + normalizedWord.length / 1000);
    }
    if (Number.isFinite(score)) matches.push({ word, entry, bookItem, score });
  }
  return matches.sort((left, right) => left.score - right.score || left.word.length - right.word.length || left.word.localeCompare(right.word)).slice(0, 30);
}

function showSearchedDictionaryWord(word) {
  const item = state.wordLookup.get(word.toLocaleLowerCase());
  closeDictionarySearch();
  if (item) {
    openWordPopup(item);
    return;
  }
  $("#popupModeLabel").textContent = "BUILT-IN DICTIONARY";
  $("#popupWord").textContent = word;
  $("#popupBookSection").classList.add("hidden");
  $("#popupBookExamples").classList.add("hidden");
  renderDictionaryEntry(dictionaryEntry(word), "popupDictionary");
  $("#wordPopup").classList.remove("hidden");
  $("#closeWordPopup").focus();
}

function renderDictionarySearch(query) {
  const results = $("#dictionarySearchResults");
  results.replaceChildren();
  const normalized = query.trim().toLocaleLowerCase();
  const note = CONFUSABLE_NOTES[normalized];
  $("#dictionarySearchHint").textContent = note || DICTIONARY_SEARCH_DEFAULT_HINT;
  $("#dictionarySearchHint").classList.toggle("confusable", Boolean(note));
  if (!query.trim()) return;
  const matches = dictionarySearchMatches(query);
  if (!matches.length) {
    results.append(Object.assign(document.createElement("p"), { className: "dictionary-search-empty", textContent: "内置词典暂未找到相关结果。" }));
    return;
  }
  for (const match of matches) {
    const phonetic = match.entry?.phonetic ? `/${match.entry.phonetic}/` : "";
    const meaning = match.bookItem?.meaning || match.entry?.translation || "暂无释义";
    const button = Object.assign(document.createElement("button"), { type: "button", className: "dictionary-search-result" });
    const heading = document.createElement("strong");
    heading.append(document.createTextNode(match.word), Object.assign(document.createElement("small"), { textContent: [phonetic, match.bookItem ? "当前词书" : "内置词典"].filter(Boolean).join(" · ") }));
    button.append(heading, Object.assign(document.createElement("p"), { textContent: meaning.split("\n").slice(0, 3).join("\n") }));
    button.addEventListener("click", () => showSearchedDictionaryWord(match.word));
    results.append(button);
  }
}

function openDictionarySearch(trigger = $("#dictionarySearchBtn")) {
  dictionarySearchTrigger = trigger;
  $("#dictionarySearchOverlay").classList.remove("hidden");
  $("#dictionarySearchInput").value = "";
  renderDictionarySearch("");
  setTimeout(() => $("#dictionarySearchInput").focus(), 30);
}

function closeDictionarySearch() {
  $("#dictionarySearchOverlay").classList.add("hidden");
  (dictionarySearchTrigger || $("#dictionarySearchBtn")).focus();
  dictionarySearchTrigger = null;
}

$("#dictionarySearchBtn").addEventListener("click", event => openDictionarySearch(event.currentTarget));
$("#answerDictionarySearchBtn").addEventListener("click", event => openDictionarySearch(event.currentTarget));
$("#closeDictionarySearch").addEventListener("click", closeDictionarySearch);
$("#dictionarySearchOverlay").addEventListener("click", event => {
  if (event.target === $("#dictionarySearchOverlay")) closeDictionarySearch();
});
$("#dictionarySearchForm").addEventListener("submit", event => {
  event.preventDefault();
  renderDictionarySearch($("#dictionarySearchInput").value);
});
$("#dictionarySearchInput").addEventListener("input", event => renderDictionarySearch(event.target.value));
