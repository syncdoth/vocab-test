import { dateAtOffset, dateKey, formatDate, formatDuration, QUESTION_COUNT } from "./quiz.mjs";

const main = document.querySelector("#main");
const navigation = document.querySelector(".navigation");
const signOut = document.querySelector("[data-command=logout]");
const makeupDays = 7;
const draftKey = "vocab-classroom-choice";

let actor;
let home;
let active;
let roster;
let report;
let history;
let result;
let credentials;
let view = "login";
let resultBack = "history";
let retakes = false;
let showMissed = false;
let serverOffset = 0;
let retryAt = 0;
let busy = false;
let copyStatusTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const command = (action, label, style = "secondary", attrs = "") =>
  `<button type="button" class="button ${style}" data-command="${action}" ${attrs}>${label}</button>`;

const heading = (title, subtitle = "", eyebrow = "") => `<div class="page-heading">
  ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}
  <h1 tabindex="-1">${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
</div>`;

function startButton(date, label, retake = false, style = "primary") {
  return command("start", label, style, `data-date="${date}" data-retake="${retake}"`);
}

function detailButton(id, label = "View result") {
  return command("result", label, "secondary small", `data-id="${id}"`);
}

function attemptLabel(number) {
  return number === 1 ? "First attempt" : `Retake ${number - 1}`;
}

function score(mark) {
  return `<strong>${mark}</strong><span> / ${QUESTION_COUNT}</span>`;
}

function rows(records) {
  if (!records.length) return '<p class="empty">No results yet.</p>';
  return `<ul class="record-list">${records.map(record => `
    <li class="record">
      <div class="record-date">
        <strong>${formatDate(record.date)}</strong>
        <span>${attemptLabel(record.number)} · ${record.timedOut ? "Time expired" : formatDuration(record.finishedAt - record.startedAt)}</span>
      </div>
      <div class="record-score">${score(record.score)}</div>
      ${detailButton(record.id, "View")}
    </li>`).join("")}</ul>`;
}

function authPage() {
  if (actor?.mustChange) {
    return `${heading("Choose a password", "Replace your temporary password before entering the classroom.")}
      <form class="class-panel class-form auth-panel" data-form="set-password">
        <label class="class-field">New password
          <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required>
        </label>
        <label class="class-field">Confirm password
          <input name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="72" required>
        </label>
        <p class="class-note">Use at least 12 characters.</p>
        <button class="button primary" type="submit">Save password</button>
      </form>`;
  }
  return `${heading("Sign in", "Use the login ID and password provided by your teacher.")}
    <form class="class-panel class-form auth-panel" data-form="login">
      <label class="class-field">Login ID
        <input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" required>
      </label>
      <label class="class-field">Password
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button class="button primary" type="submit">Sign in</button>
    </form>`;
}

function recentDates() {
  return Array.from({ length: makeupDays + 1 }, (_, index) => dateAtOffset(home.today, -index))
    .filter(date => date >= home.startDate);
}

function todayPage() {
  const completed = home.official.find(record => record.date === home.today);
  const makeupCount = recentDates().slice(1).filter(date => !home.official.some(record => record.date === date)).length;
  return `${heading("Today’s test", formatDate(home.today, true))}
    <section class="featured">
      <div class="featured-copy">
        ${completed ? '<p class="featured-label">First attempt complete</p>' : ""}
        <h2>${completed ? score(completed.score) : "50 words"}</h2>
        <p>${completed ? "Your first score is saved." : "10 minutes · English meanings"}</p>
        <div class="actions">${completed
          ? command("result", "View result", "lime", `data-id="${completed.id}"`) + startButton(home.today, "Retake", true, "inverse")
          : startButton(home.today, "Start test", false, "lime")}</div>
      </div>
      <div class="card-art" aria-hidden="true"><i></i><i></i><i></i><span>Aa</span></div>
    </section>
    <section class="records">
      <div class="section-heading"><h2>Makeup tests</h2>${command("schedule", "View schedule", "text-button")}</div>
      <p class="empty">${makeupCount ? `${makeupCount} missed ${makeupCount === 1 ? "test is" : "tests are"} open for makeup.`
        : "You have no open makeup tests."}</p>
    </section>`;
}

function schedulePage() {
  return `${heading("Schedule", "Makeup tests are open for seven days after the original test date.")}
    <ul class="record-list">${recentDates().map(date => {
      const record = home.official.find(entry => entry.date === date);
      const today = date === home.today;
      return `<li class="record schedule-record">
        <div class="record-date"><strong>${formatDate(date)}</strong>
          <span>${today ? "Today" : record ? "Completed" : "Makeup available"}</span>
        </div>
        <div class="record-score">${record ? score(record.score) : ""}</div>
        ${record ? detailButton(record.id) : startButton(date, today ? "Start test" : "Make up test", false, "secondary small")}
      </li>`;
    }).join("")}</ul>`;
}

function attemptsToggle() {
  return `<div class="class-actions class-view" aria-label="Attempt type">
    ${command("first-attempts", "First attempts", "secondary", `aria-pressed="${!retakes}"`)}
    ${command("retakes", "Retakes", "secondary", `aria-pressed="${retakes}"`)}
  </div>`;
}

function moreButton(hasMore) {
  return hasMore ? `<div class="list-actions">${command("more-history", "Show older attempts")}</div>` : "";
}

function historyPage() {
  return `${heading("History", "Your results are saved to your account.")}${attemptsToggle()}
    ${rows(history.results)}${moreButton(history.hasMore)}`;
}

function resultPage() {
  const missed = result.answers.filter(answer => !answer.correct);
  const selected = showMissed ? missed : result.answers;
  return `${heading("Test result", formatDate(result.date), attemptLabel(result.number))}
    <section class="featured result-featured" aria-label="Score">
      <div class="featured-copy">
        <p class="featured-label">${result.timedOut ? "Time expired" : "Test complete"}</p>
        <h2>${score(result.score)}</h2>
        <p>${formatDuration(result.finishedAt - result.startedAt)} elapsed · ${missed.length} missed</p>
        <div class="actions">${actor.role === "student" ? startButton(result.date, "Retake test", true, "lime") : ""}
          ${command("back-result", "Back", "inverse")}</div>
      </div>
    </section>
    <section class="records" aria-label="Answer review">
      <div class="section-heading"><h2>Answer review</h2></div>
      <div class="class-actions class-view">
        ${command("all-answers", "All answers", "secondary", `aria-pressed="${!showMissed}"`)}
        ${command("missed-answers", "Missed only", "secondary", `aria-pressed="${showMissed}"`)}
      </div>
      ${selected.length ? `<ol class="record-list">${selected.map(answer => `
        <li class="review">
          <h3>${escapeHtml(answer.word)} <span>${escapeHtml(answer.pos)}</span></h3>
          <p>${escapeHtml(answer.meaning)}</p>
          <p class="review-choice ${answer.correct ? "review-correct" : "review-wrong"}">${answer.correct ? "Correct" : answer.selected
            ? `You chose “${escapeHtml(answer.selected)}”` : "Unanswered"}</p>
        </li>`).join("")}</ol>` : '<p class="empty">No missed words.</p>'}
    </section>`;
}

function quizPage() {
  let selected = null;
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey));
    if (draft?.id === active.id && draft.index === active.index && active.choices[draft.choice]) {
      selected = draft.choice;
    }
  } catch {
    // The selected option can still be submitted with browser storage disabled.
  }
  return `<div class="quiz">
    <div class="quiz-header"><div>
      <p class="eyebrow">${attemptLabel(active.number)} · ${formatDate(active.date)}</p>
      <p class="quiz-count">Question ${active.index + 1} of ${QUESTION_COUNT}</p></div>
      <div class="clock" role="timer" aria-label="Time remaining"></div>
    </div>
    <progress value="${active.index}" max="${QUESTION_COUNT}" aria-label="Questions answered"></progress>
    <section class="flashcard" aria-labelledby="word">
      <p>Choose the correct meaning</p>
      <h1 id="word" tabindex="-1">${escapeHtml(active.word)}</h1>
      <span class="word-pos" aria-label="Part of speech">${escapeHtml(active.pos)}</span>
    </section>
    <form class="answer-form" data-form="answer">
      <div class="choices" role="radiogroup" aria-label="Answer choices">${active.choices.map((choice, index) => `
        <label class="choice-option">
          <input type="radio" name="choice" value="${index}" ${selected === index ? "checked" : ""}>
          <span class="choice"><span class="choice-letter" aria-hidden="true">${"ABCD"[index]}</span>
            <span>${escapeHtml(choice)}</span></span>
        </label>`).join("")}</div>
      <div class="quiz-actions"><p class="quiz-note">Each submitted answer is final. <span class="key-hint">Use 1–4 to choose.</span></p>
        <button class="button primary" type="submit" ${selected === null ? "disabled" : ""}>Submit answer</button>
      </div>
    </form>
  </div>`;
}

function passwordSlip() {
  if (!credentials) return "";
  return `<section class="class-panel password-slip roster-panel" aria-label="Student login details">
    <h2>Student login details</h2>
    <p>Share these with the student. They’ll choose a new password after signing in.</p>
    <div class="account-details"><strong>Login ID</strong> <code>${escapeHtml(credentials.login)}</code></div>
    <div class="account-details"><strong>Temporary password</strong> <code>${escapeHtml(credentials.password)}</code></div>
    <div class="class-actions">
      ${command("copy-login", "Copy login details")}${command("dismiss-login", "Dismiss", "text-button")}
      <span class="class-note" role="status"></span>
    </div>
  </section>`;
}

async function copyLoginDetails(button) {
  const status = button.parentElement.querySelector("[role=status]");
  status.textContent = "";
  let message = "Copied";
  try {
    await navigator.clipboard.writeText(`Login ID: ${credentials.login}\nTemporary password: ${credentials.password}`);
  } catch {
    message = "Couldn’t copy. You can select and copy the login details.";
  }
  if (!status.isConnected) return;
  clearTimeout(copyStatusTimer);
  status.textContent = message;
  if (message === "Copied") copyStatusTimer = setTimeout(() => { status.textContent = ""; }, 2500);
}

function rosterPage() {
  return `${heading("Classroom", "Manage students and check daily first attempts.")}
    <section class="class-panel" aria-labelledby="add-title">
      <h2 id="add-title">Add student</h2>
      <form class="class-button-row" data-form="add-student">
        <label class="class-field">Display name <input name="name" maxlength="80" required></label>
        <label class="class-field">Login ID <input name="login" placeholder="e.g. minji" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="3" maxlength="32" required></label>
        <button class="button primary" type="submit">Create student</button>
      </form>
    </section>
    ${passwordSlip()}
    <section class="records">
      <div class="section-heading roster-heading"><h2>Student roster</h2>
        <label class="class-field">Test date <input type="date" id="roster-date" min="${roster.startDate}" max="${roster.today}" value="${roster.date}"></label>
      </div>
      ${roster.students.length ? `<ul class="record-list">${roster.students.map(student => {
        const completed = student.attempt?.finishedAt;
        const status = !student.attempt ? "No attempt" : completed ? (student.attempt.timedOut ? "Time expired" : "Completed") : "In progress";
        return `<li class="teacher-record">
          <div class="record roster-record">
            <div class="record-date"><strong>${escapeHtml(student.name)}</strong>
              <span>${escapeHtml(student.login)}${student.active ? "" : " · Archived"}</span>
            </div>
            <div class="record-date"><span>${status}</span>${completed ? `<div class="record-score">${score(student.attempt.score)}</div>` : ""}</div>
            ${completed ? detailButton(student.attempt.id, "Result") : "<span></span>"}
          </div>
          <div class="class-actions">
            ${command("student-report", "History", "secondary small", `data-id="${student.id}"`)}
            ${command("reset-password", "Reset password", "secondary small", `data-id="${student.id}"`)}
            ${command("student-active", student.active ? "Archive" : "Restore", "secondary small",
              `data-id="${student.id}" data-active="${!student.active}"`)}
          </div>
        </li>`;
      }).join("")}</ul>` : '<p class="empty">Add a student to start tracking test results.</p>'}
    </section>`;
}

function reportPage() {
  return `${heading(escapeHtml(report.student.name), escapeHtml(report.student.login), "Student history")}
    ${attemptsToggle()}${rows(report.results)}${moreButton(report.hasMore)}
    <section class="records">
      <div class="section-heading"><h2>Most missed words</h2></div>
      <p class="subtitle">Based on first attempts. Unanswered items count as misses.</p>
      ${report.words.length ? `<ol class="record-list roster-panel">${report.words.map(word => `
        <li class="review">
          <h3>${escapeHtml(word.word)}</h3>
          <p>${word.count} missed · ${word.unanswered} unanswered</p>
        </li>`).join("")}</ol>` : '<p class="empty roster-panel">No missed words recorded.</p>'}
    </section>`;
}

function setClock(now) {
  if (Number.isFinite(now)) serverOffset = now - Date.now();
}

function updateClock() {
  const remaining = active.deadline - Date.now() - serverOffset;
  const clock = main.querySelector(".clock");
  clock.textContent = formatDuration(remaining);
  clock.classList.toggle("urgent", remaining <= 60_000);
  return remaining;
}

function render({ focus = true } = {}) {
  signOut.hidden = !actor;
  navigation.hidden = !actor || actor.mustChange || Boolean(active);
  navigation.innerHTML = actor?.role === "teacher"
    ? '<button type="button" data-command="roster" aria-current="page"><span class="nav-icon nav-schedule" aria-hidden="true"></span>Classroom</button>'
    : [["today", "Today"], ["schedule", "Schedule"], ["history", "History"]].map(([key,label]) => `
      <button type="button" data-command="${key}" ${view === key ? 'aria-current="page"' : ""}>
        <span class="nav-icon nav-${key}" aria-hidden="true"></span>${label}
      </button>`).join("");
  main.classList.toggle("in-quiz", Boolean(active));
  main.setAttribute("aria-busy", "false");
  main.innerHTML = active ? quizPage()
    : view === "today" ? todayPage()
    : view === "schedule" ? schedulePage()
    : view === "history" ? historyPage()
    : view === "result" ? resultPage()
    : view === "roster" ? rosterPage()
    : view === "report" ? reportPage()
    : authPage();
  if (active) updateClock();
  if (focus) {
    window.scrollTo(0, 0);
    main.querySelector("h1").focus({ preventScroll: true });
  }
}

function notice(message) {
  main.querySelector(".error")?.remove();
  const messageBox = document.createElement("p");
  messageBox.className = "error";
  messageBox.setAttribute("role", "alert");
  messageBox.textContent = message;
  main.setAttribute("aria-busy", "false");
  main.prepend(messageBox);
}

async function api(action, payload = {}) {
  const response = await fetch("/api/class", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
  return data;
}

function showResult(value, back = "history") {
  active = null;
  showMissed = false;
  result = value;
  resultBack = back;
  view = "result";
}

async function showHome(desired = "today") {
  const previous = active;
  home = await api("student-home");
  setClock(home.now);
  active = home.active;
  view = desired;
  if (home.expired) showResult(home.expired);
  else if (previous && !active) showResult(await api("result", { id: previous.id }));
}

async function showRoster(date) {
  roster = await api("roster", { date });
  view = "roster";
}

async function showHistory({ more = false } = {}) {
  const isReport = view === "report";
  const previous = isReport ? report : history;
  const next = await api(isReport ? "student-report" : "history", {
    id: isReport ? previous.student.id : undefined,
    retakes,
    offset: more ? previous.results.length : 0,
  });
  const updated = more
    ? { ...next, results: [...previous.results, ...next.results], words: previous.words }
    : next;
  if (isReport) report = updated;
  else {
    history = updated;
    view = "history";
  }
}

async function openSession(profile) {
  actor = profile;
  active = null;
  credentials = null;
  view = "login";
  if (!actor || actor.mustChange) return;
  if (actor.role === "teacher") await showRoster();
  else await showHome();
}

async function run(action, { focus = true } = {}) {
  if (busy) return;
  busy = true;
  try {
    await action();
    render({ focus });
  } catch (error) {
    if (error.status === 401 && actor) {
      await openSession(null);
      render();
    }
    notice(error.message || "The classroom could not be reached. Try again.");
    return false;
  } finally {
    busy = false;
  }
  return true;
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-command]");
  if (!button || busy) return;
  const { command: action, id, date, active: nextActive, retake } = button.dataset;
  if (action === "copy-login") {
    void copyLoginDetails(button);
    return;
  }
  void run(async () => {
    switch (action) {
      case "logout": await api("logout"); await openSession(null); break;
      case "today": case "schedule": await showHome(action); break;
      case "history": retakes = false; view = "history"; await showHistory(); break;
      case "roster": credentials = null; await showRoster(); break;
      case "start": {
        const started = await api("start", { date, retake: retake === "true" });
        active = started.active;
        setClock(started.now);
        break;
      }
      case "result": showResult(await api("result", { id }), view); break;
      case "all-answers": showMissed = false; break;
      case "missed-answers": showMissed = true; break;
      case "back-result":
        if (resultBack === "history") { view = "history"; retakes = false; await showHistory(); }
        else if (resultBack === "today" || resultBack === "schedule") await showHome(resultBack);
        else if (resultBack === "roster") await showRoster(roster.date);
        else view = resultBack;
        break;
      case "first-attempts": case "retakes": retakes = action === "retakes"; await showHistory(); break;
      case "more-history": await showHistory({ more: true }); break;
      case "student-report":
        report = await api("student-report", { id });
        credentials = null;
        retakes = false;
        view = "report";
        break;
      case "reset-password":
        if (window.confirm("Reset this student’s password and sign them out?")) {
          credentials = await api("update-student", { id, reset: true });
        }
        break;
      case "student-active":
        await api("update-student", { id, active: nextActive === "true" });
        credentials = null;
        await showRoster(roster.date);
        break;
      case "dismiss-login": credentials = null; break;
    }
  }, { focus: !["all-answers", "missed-answers", "more-history"].includes(action) });
});

main.addEventListener("submit", event => {
  event.preventDefault();
  if (busy) return;
  const values = Object.fromEntries(new FormData(event.target));
  const action = event.target.dataset.form;
  void run(async () => {
    switch (action) {
      case "login": await openSession(await api("login", values)); break;
      case "set-password":
        if (values.password !== values.confirm) throw new Error("The passwords do not match.");
        await openSession(await api("set-password", { password: values.password }));
        break;
      case "add-student":
        credentials = await api("add-student", values);
        await showRoster(roster.date);
        break;
      case "answer": {
        if (!active || values.choice === undefined) return;
        const response = await api("answer", { id: active.id, index: active.index, choice: Number(values.choice) });
        setClock(response.now);
        if (response.result) showResult(response.result);
        else active = response.active;
        break;
      }
    }
  });
});

main.addEventListener("change", event => {
  const target = event.target;
  if (target.name === "choice" && active) {
    target.form.querySelector("button[type=submit]").disabled = false;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ id: active.id, index: active.index, choice: Number(target.value) }));
    } catch {
      // The form already has the selection.
    }
  }
  if (target.id === "roster-date" && target.value) {
    void run(() => showRoster(target.value), { focus: false });
  }
});

window.addEventListener("keydown", event => {
  if (!active || busy || event.repeat || event.metaKey || event.altKey || event.ctrlKey || !/^[1-4]$/.test(event.key)) return;
  const option = main.querySelectorAll("input[name=choice]")[Number(event.key) - 1];
  option.focus({ preventScroll: true });
  option.click();
});

void run(async () => openSession(await api("session")), { focus: false });
setInterval(() => {
  if (busy || Date.now() < retryAt) return;
  if (active && updateClock() <= 0) {
    retryAt = Date.now() + 3000;
    void run(() => showHome());
  } else if (!active && home && ["today", "schedule"].includes(view) && dateKey(Date.now() + serverOffset) !== home.today) {
    retryAt = Date.now() + 3000;
    void run(() => showHome(view), { focus: false });
  }
}, 500);
