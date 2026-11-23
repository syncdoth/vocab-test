import {
  QUESTION_COUNT, dateAtOffset, dateKey, formatDate, formatDuration,
  makeAttempt, makeCatalog, resolveDeadline, resultsForDate, submitAnswer,
} from "./quiz.mjs";
import { onStateChange, readState, updateState } from "./storage.mjs";

const main = document.querySelector("#main");
const nav = document.querySelector(".navigation");
const navButtons = [...nav.querySelectorAll("button")];

let catalog;
let state;
let view = "today";
let today = dateKey();
let shownResult;
let scheduleLimit = 14;
let busy = false;

function escapeHtml(value) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, character => escapes[character]);
}

function attemptLabel(number) {
  return number === 1 ? "First attempt" : `Retake ${number - 1}`;
}

function startButton(date, label, style = "primary") {
  return `<button class="button ${style}" data-start="${date}">${label}</button>`;
}

function scoreText(score) {
  return `<strong>${score}</strong><span> / ${QUESTION_COUNT}</span>`;
}

function heading(eyebrow, title, subtitle = "") {
  return `<div class="page-heading">
    ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}
    <h1 tabindex="-1">${title}</h1>
    ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
  </div>`;
}

function resultRows(results, showAttempt = false) {
  return `<ul class="record-list">${results.map(result => `
    <li class="record">
      <div class="record-date">
        <strong>${formatDate(result.testDate)}</strong>
        <span>${showAttempt ? `${attemptLabel(result.attemptNumber)} · ` : ""}${result.timedOut ? "Time expired" : formatDuration(result.finishedAt - result.startedAt)}</span>
      </div>
      <div class="record-score">${scoreText(result.score)}</div>
      <button class="button secondary small" data-result-date="${result.testDate}" data-result-number="${result.attemptNumber}"
        aria-label="View ${attemptLabel(result.attemptNumber).toLowerCase()} for ${formatDate(result.testDate)}">View</button>
    </li>`).join("")}</ul>`;
}

function todayPage() {
  const firstResults = state.results.filter(result => result.attemptNumber === 1);
  const firstToday = firstResults.find(result => result.testDate === today);
  const daysSinceStart = Math.max(0, Math.round((Date.parse(today) - Date.parse(state.startDate)) / 86400000));
  const makeupDue = daysSinceStart - firstResults.filter(result => result.testDate < today).length;
  const average = firstResults.length
    ? Math.round(firstResults.reduce((total, result) => total + result.score, 0) / (firstResults.length * QUESTION_COUNT) * 100)
    : null;
  const recent = [...firstResults].sort((a, b) => b.testDate.localeCompare(a.testDate)).slice(0, 3);

  return `${heading("", "Today’s test", formatDate(today, true))}
    <section class="featured" aria-labelledby="featured-title">
      <div class="featured-copy">
        ${firstToday ? '<p class="featured-label">First attempt complete</p>' : ""}
        <h2 id="featured-title">${firstToday ? `${firstToday.score} / 50` : "50 words"}</h2>
        <p>${firstToday ? "Your first score is saved." : "10 minutes · English meanings"}</p>
        <div class="actions">
          ${firstToday ? `<button class="button lime" data-result-date="${today}" data-result-number="1">View result</button>
              ${startButton(today, "Retake", "inverse")}`
            : startButton(today, "Start test", "lime")}
        </div>
      </div>
      <div class="card-art" aria-hidden="true"><i></i><i></i><i></i><span>Aa</span></div>
    </section>
    <section class="stats" aria-label="First-attempt statistics">
      <div class="stat"><span>Tests completed</span><strong>${firstResults.length}</strong></div>
      <div class="stat"><span>Average first score</span><strong>${average === null ? "—" : `${average}%`}</strong></div>
      <div class="stat"><span>Makeup tests due</span><strong>${makeupDue}</strong></div>
    </section>
    <section class="records" aria-labelledby="recent-title">
      <div class="section-heading"><h2 id="recent-title">Recent results</h2><button class="button text-button" data-view="history">View history</button></div>
      ${recent.length ? resultRows(recent) : '<p class="empty">Your first result will appear here after you finish a daily test.</p>'}
    </section>`;
}

function schedulePage() {
  const dates = [];
  let date = today;
  const resultIndex = new Map(state.results.filter(result => result.attemptNumber === 1)
    .map(result => [result.testDate, result]));
  while (date >= state.startDate && dates.length < scheduleLimit) {
    dates.push(date);
    date = dateAtOffset(date, -1);
  }

  return `${heading("", "Schedule", "Take today’s test or catch up on a missed date.")}
    <section class="records" aria-label="Daily tests">
      <ul class="record-list">${dates.map(testDate => {
        const result = resultIndex.get(testDate);
        const isToday = testDate === today;
        return `<li class="record schedule-record">
          <div class="record-date">
            <strong>${formatDate(testDate)}</strong>
            <span>${isToday ? "Today" : result ? "Completed" : "Makeup available"}</span>
          </div>
          <div class="record-score">${result ? scoreText(result.score) : ""}</div>
          ${result
            ? `<button class="button secondary small" data-result-date="${testDate}" data-result-number="1">View result</button>`
            : startButton(testDate, isToday ? "Start test" : "Make up test", "secondary small")}
        </li>`;
      }).join("")}</ul>
      ${date >= state.startDate ? '<div class="list-actions"><button class="button secondary" data-older>Show older dates</button></div>' : ""}
    </section>`;
}

function historyPage() {
  const latest = [...state.results].sort((a, b) => b.finishedAt - a.finishedAt);
  const first = latest.filter(result => result.attemptNumber === 1);
  const retakes = latest.filter(result => result.attemptNumber > 1);
  return `${heading("", "History", "Results are saved in this browser.")}
    <section class="records" aria-labelledby="first-title">
      <div class="section-heading"><h2 id="first-title">First attempts</h2></div>
      ${first.length ? resultRows(first) : '<p class="empty">Your first attempts appear here after you finish a test.</p>'}
    </section>
    <section class="records" aria-labelledby="retake-title">
      <div class="section-heading"><h2 id="retake-title">Retakes</h2></div>
      ${retakes.length ? resultRows(retakes, true) : '<p class="empty">You haven’t retaken a test yet.</p>'}
    </section>`;
}

function resultPage(result) {
  const missed = result.review.filter(answer => answer.wordId !== answer.selectedId);
  return `${heading(attemptLabel(result.attemptNumber), "Test result", formatDate(result.testDate))}
    <section class="featured result-featured" aria-label="Score">
      <div class="featured-copy">
        <p class="featured-label">${result.timedOut ? "Time expired" : "Test complete"}</p>
        <h2>${scoreText(result.score)}</h2>
        <p>${formatDuration(result.finishedAt - result.startedAt)} elapsed · ${missed.length} missed</p>
        <div class="actions">
          ${startButton(result.testDate, "Retake test", "lime")}
          <button class="button inverse" data-view="history">View history</button>
        </div>
      </div>
    </section>
    <section class="records" aria-labelledby="review-title">
      <div class="section-heading"><h2 id="review-title">Missed words</h2></div>
      ${missed.length ? `<ol class="record-list">${missed.map(answer => {
        const word = catalog.byId.get(answer.wordId);
        const selected = catalog.byId.get(answer.selectedId);
        return `<li class="review">
          <h3>${escapeHtml(word.word)} <span>${escapeHtml(word.pos)}</span></h3>
          <p>${escapeHtml(word.definition)}</p>
          <p class="review-choice">${selected ? `Your answer: ${escapeHtml(selected.definition)}` : "Unanswered"}</p>
        </li>`;
      }).join("")}</ol>` : '<p class="empty">You got every word right.</p>'}
    </section>`;
}

function quizPage(attempt) {
  const index = attempt.answers.length;
  const question = attempt.questions[index];
  const word = catalog.byId.get(question.wordId);
  return `<div class="quiz">
    <div class="quiz-header">
      <div>
        <p class="eyebrow">${attemptLabel(attempt.attemptNumber)} · ${formatDate(attempt.testDate)}</p>
        <p class="quiz-count">Question ${index + 1} of ${QUESTION_COUNT}</p>
      </div>
      <div class="clock" role="timer" aria-label="Time remaining">${formatDuration(attempt.deadline - Date.now())}</div>
    </div>
    <progress value="${index}" max="${QUESTION_COUNT}" aria-label="Questions answered"></progress>
    <section class="flashcard" aria-labelledby="word">
      <p>Choose the correct meaning</p>
      <h1 id="word" tabindex="-1">${escapeHtml(word.word)}</h1>
      <span class="word-pos" aria-label="Part of speech">${escapeHtml(word.pos)}</span>
    </section>
    <div class="choices" aria-label="Answer choices">${question.choiceIds.map((id, option) => `
      <button type="button" class="choice" data-choice="${escapeHtml(id)}">
        <span class="choice-letter" aria-hidden="true">${"ABCD"[option]}</span>
        <span>${escapeHtml(catalog.byId.get(id).definition)}</span>
      </button>`).join("")}
    </div>
    <p class="quiz-note">Each answer is final. <span class="key-hint">Keyboard shortcuts: 1–4.</span></p>
  </div>`;
}

function render({ focus = false } = {}) {
  const active = state.active;
  nav.hidden = Boolean(active);
  for (const button of navButtons) {
    if (button.dataset.view === view && !active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  main.setAttribute("aria-busy", "false");
  main.classList.toggle("in-quiz", Boolean(active));
  main.innerHTML = active ? quizPage(active)
    : view === "result" ? resultPage(shownResult)
    : view === "schedule" ? schedulePage()
    : view === "history" ? historyPage()
    : todayPage();
  if (focus) {
    window.scrollTo(0, 0);
    main.querySelector("h1")?.focus({ preventScroll: true });
  }
}

function showError(error, fatal = false) {
  console.error(error);
  const message = fatal
    ? "Vocab Daily couldn’t open. Check your connection and browser storage, then reload."
    : "Your last action couldn’t be saved. Check that this browser allows site storage and try again.";
  const notice = document.createElement("p");
  notice.setAttribute("role", "alert");
  notice.className = "error";
  notice.textContent = message;
  main.querySelector(".error")?.remove();
  main.setAttribute("aria-busy", "false");
  if (fatal) main.replaceChildren(notice);
  else main.prepend(notice);
}

async function changeState(change, focus = true) {
  if (busy) return;
  busy = true;
  try {
    const update = await updateState(change);
    state = update.state;
    if (update.result) {
      shownResult = update.result;
      view = "result";
    }
    render({ focus });
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
  }
}

function start(date) {
  return changeState(current => {
    const now = Date.now();
    const expired = resolveDeadline(current, now);
    if (expired) return expired;
    makeAttempt(current, catalog, date, now);
  });
}

function answer(choiceId) {
  const attempt = state.active;
  if (attempt) return changeState(current => submitAnswer(current, attempt, attempt.answers.length, choiceId));
}

document.addEventListener("click", event => {
  if (!state || busy || event.detail > 1) return;
  const button = event.target.closest("button");
  if (!button) return;

  if (state.active) {
    if (button.dataset.choice) void answer(button.dataset.choice);
    return;
  }

  const { start: testDate, view: target, resultDate, resultNumber, older } = button.dataset;
  if (testDate) {
    void start(testDate);
  } else if (target) {
    view = target;
    render({ focus: true });
  } else if (resultDate) {
    shownResult = resultsForDate(state, resultDate).find(item => item.attemptNumber === Number(resultNumber));
    if (!shownResult) return;
    view = "result";
    render({ focus: true });
  } else if (older !== undefined) {
    scheduleLimit += 14;
    render();
    main.querySelector(".record-list > :nth-child(" + (scheduleLimit - 13) + ") button")?.focus();
  }
});

window.addEventListener("keydown", event => {
  if (!state?.active || busy || event.repeat || event.metaKey || event.altKey || event.ctrlKey) return;
  if (!/^[1-4]$/.test(event.key)) return;
  const attempt = state.active;
  void answer(attempt.questions[attempt.answers.length].choiceIds[Number(event.key) - 1]);
});

function tick() {
  if (busy) return;
  if (state.active) {
    const remaining = state.active.deadline - Date.now();
    if (remaining <= 0) {
      void changeState(resolveDeadline);
    } else {
      const clock = document.querySelector(".clock");
      clock.textContent = formatDuration(remaining);
      clock.classList.toggle("urgent", remaining <= 60_000);
    }
  }
  const currentDate = dateKey();
  if (currentDate !== today) {
    today = currentDate;
    if (!state.active && view !== "result") render();
  }
}

async function initialize() {
  try {
    const response = await fetch(new URL("../data/vocabulary.json", import.meta.url));
    if (!response.ok) throw new Error(`Vocabulary download returned ${response.status}.`);
    catalog = makeCatalog(await response.json());
    const update = await updateState(resolveDeadline);
    state = update.state;
    if (update.result) {
      shownResult = update.result;
      view = "result";
    }
    render();
    onStateChange(() => {
      if (busy) return;
      try {
        const current = readState();
        if (state.active && !current.active) {
          shownResult = resultsForDate(current, state.active.testDate)
            .find(result => result.attemptNumber === state.active.attemptNumber);
          view = shownResult ? "result" : "today";
        }
        state = current;
        render();
        tick();
      } catch (error) {
        showError(error);
      }
    });
    setInterval(tick, 500);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tick();
    });
  } catch (error) {
    showError(error, true);
  }
}

void initialize();
