import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dateKey, makeAttempt, makeCatalog } from "../site/js/quiz.mjs";

const vocabulary = JSON.parse(readFileSync(new URL("../site/data/vocabulary.json", import.meta.url), "utf8"));
const catalog = makeCatalog(vocabulary);
const cookieName = "vocab_class_session";
const sessionSeconds = 7 * 24 * 60 * 60;
const loginPattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const summaryColumns = "id,student_id,test_date,attempt_number,started_at,finished_at,deadline,score,timed_out";

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function required(value, message) {
  if (!value) throw new RequestError(400, message);
}

function readLogin(value) {
  const login = typeof value === "string" ? value.trim().toLowerCase() : "";
  required(loginPattern.test(login), "Enter a valid login ID (3–32 letters, numbers, dots, dashes or underscores).");
  return login;
}

function readDate(value) {
  const parsed = Date.parse(value);
  required(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value, "Enter a valid test date.");
  return value;
}

function readId(value) {
  required(typeof value === "string" && uuidPattern.test(value), "Invalid record ID.");
  return value;
}

function offset(value) {
  required(Number.isInteger(value) && value >= 0 && value <= 1_000_000, "Invalid history page.");
  return value;
}

function serviceConfig() {
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: publishable } = process.env;
  if (!url || !secret || !publishable) throw new RequestError(503, "The classroom database is not configured.");
  return { url, secret, publishable };
}

async function upstream(path, { method = "GET", query, body, asPublic = false, representation = false } = {}) {
  const { url, secret, publishable } = serviceConfig();
  const destination = new URL(path, url);
  if (query) destination.search = new URLSearchParams(query);
  const key = asPublic ? publishable : secret;
  const headers = { apikey: key };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (representation) headers.prefer = "return=representation";

  const response = await fetch(destination, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await response.text();
  let payload = null;
  if (content) {
    try { payload = JSON.parse(content); } catch {
      console.error("Supabase returned a non-JSON response", path, response.status);
      throw new RequestError(502, "The classroom service could not complete that request. Try again.");
    }
  }
  if (!response.ok) {
    if (asPublic && [400, 401, 403].includes(response.status)) {
      throw new RequestError(401, "That login ID and password do not match.");
    }
    if (asPublic && response.status === 429) {
      throw new RequestError(429, "Too many sign-in attempts. Wait a minute and try again.");
    }
    if (payload?.code === "P0001") throw new RequestError(409, payload.message);
    if (payload?.code === "23505") throw new RequestError(409, "This student ID is already in use.");
    console.error("Supabase request failed", path, response.status, payload?.code ?? payload?.error_code);
    throw new RequestError(502, "The classroom service could not complete that request. Try again.");
  }
  return payload;
}

function table(name, query, options) {
  return upstream(`/rest/v1/class_${name}`, { query, ...options });
}

function rpc(name, body) {
  return upstream(`/rest/v1/rpc/class_${name}`, { method: "POST", body });
}

function first(rows) {
  return Array.isArray(rows) ? rows[0] : rows;
}

function fingerprint(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionToken(request) {
  return request.headers.get("cookie")?.split(/;\s*/).find(cookie => cookie.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

function sessionCookie(request, token, maxAge = sessionSeconds) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${token}; Path=/api/class; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function loginInfo(profile) {
  const { id, login, name, role, must_change_password } = profile;
  return { id, login, name, role, mustChange: must_change_password };
}

async function profileFor(request) {
  const token = sessionToken(request);
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const session = first(await table("sessions", {
    fingerprint: `eq.${fingerprint(token)}`, expires_at: `gt.${new Date().toISOString()}`,
    select: "version,profile:class_profiles(*)",
  }));
  const profile = session?.profile;
  if (!profile?.active || profile.session_version !== session.version) return null;
  return profile;
}

async function createSession(profile) {
  const token = randomBytes(32).toString("base64url");
  await table("sessions", { user_id: `eq.${profile.id}`, expires_at: `lte.${new Date().toISOString()}` }, { method: "DELETE" });
  await table("sessions", null, {
    method: "POST", body: {
      fingerprint: fingerprint(token), user_id: profile.id, version: profile.session_version,
      expires_at: new Date(Date.now() + sessionSeconds * 1000).toISOString(),
    },
  });
  return token;
}

async function signIn(input) {
  const login = readLogin(input.login);
  required(typeof input.password === "string" && input.password.length <= 128 && input.password.length > 0, "Enter your password.");
  const profile = first(await table("profiles", { login: `eq.${login}`, active: "eq.true", limit: 1 }));
  if (!profile) throw new RequestError(401, "That login ID and password do not match.");
  if (Date.parse(profile.password_lock_until) > Date.now()) {
    throw new RequestError(409, "A password change is in progress. Try again shortly.");
  }
  const auth = await upstream("/auth/v1/token", {
    method: "POST", query: { grant_type: "password" }, asPublic: true,
    body: { email: profile.auth_email, password: input.password },
  });
  if (auth.user?.id !== profile.id) throw new RequestError(401, "That login ID and password do not match.");
  // Neither Supabase Auth tokens nor the service key are shared with the browser.
  return { profile, token: await createSession(profile) };
}

async function changePassword(profile, password, mustChange) {
  const version = profile.session_version + 1;
  const lock = new Date(Date.now() + 45_000).toISOString();
  const next = first(await table("profiles", {
    id: `eq.${profile.id}`, session_version: `eq.${profile.session_version}`,
    or: `(password_lock_until.is.null,password_lock_until.lt.${new Date().toISOString()})`,
  }, {
    method: "PATCH", representation: true,
    body: { session_version: version, password_lock_until: lock, must_change_password: true },
  }));
  if (!next) throw new RequestError(409, "A password change is already in progress. Try again shortly.");
  let changed = false;
  try {
    await upstream(`/auth/v1/admin/users/${profile.id}`, { method: "PUT", body: { password } });
    changed = true;
  } finally {
    await table("profiles", { id: `eq.${profile.id}`, session_version: `eq.${version}` }, {
      method: "PATCH", body: { password_lock_until: null, must_change_password: changed ? mustChange : profile.must_change_password },
    });
  }
  return { ...next, must_change_password: mustChange };
}

function summary(attempt) {
  return {
    id: attempt.id, studentId: attempt.student_id, date: attempt.test_date.slice(0, 10), number: attempt.attempt_number,
    startedAt: Date.parse(attempt.started_at), deadline: Date.parse(attempt.deadline),
    finishedAt: attempt.finished_at ? Date.parse(attempt.finished_at) : null,
    score: attempt.score, timedOut: attempt.timed_out,
  };
}

function activeQuestion(attempt) {
  const index = attempt.answers.length;
  const question = attempt.questions[index];
  const prompt = catalog.byId.get(question.wordId);
  return {
    ...summary(attempt), index, word: prompt.word, pos: prompt.pos,
    choices: question.choiceIds.map(id => catalog.byId.get(id).definition),
  };
}

function review(attempt) {
  return {
    ...summary(attempt),
    answers: attempt.questions.map(({ wordId }, index) => {
      const target = catalog.byId.get(wordId);
      const selected = catalog.byId.get(attempt.answers[index]);
      return {
        word: target.word, pos: target.pos, meaning: target.definition,
        selected: selected?.definition ?? null, correct: selected?.id === wordId,
      };
    }),
  };
}

async function settings({ includeKey = false } = {}) {
  const config = first(await table("settings", { select: includeKey ? "start_date,schedule_key" : "start_date", limit: 1 }));
  if (!config) throw new RequestError(503, "The class schedule is not configured.");
  const now = Date.now();
  return { today: dateKey(now), startDate: config.start_date.slice(0, 10), now, ...(includeKey && { scheduleKey: config.schedule_key }) };
}

async function studentHome(profile) {
  const expired = first(await rpc("expire", { p_student: profile.id }));
  const [calendar, running, official] = await Promise.all([
    settings(),
    table("attempts", { student_id: `eq.${profile.id}`, finished_at: "is.null", limit: 1 }),
    table("attempts", {
      select: summaryColumns, student_id: `eq.${profile.id}`, finished_at: "not.is.null",
      attempt_number: "eq.1", order: "test_date.desc", limit: 8,
    }),
  ]);
  const active = first(running);
  return {
    ...calendar, active: active ? activeQuestion(active) : null, official: official.map(summary),
    expired: expired ? review(expired) : null,
  };
}

async function startAttempt(profile, input) {
  const date = readDate(input.date);
  const { today, startDate, scheduleKey, now } = await settings({ includeKey: true });
  if (date < startDate || date > today) throw new RequestError(409, "That test date is unavailable.");
  const seed = randomBytes(4).readUInt32BE();
  const draft = { startDate, active: null, results: [] };
  makeAttempt(draft, catalog, date, now, { variation: seed, scheduleKey });
  const attempt = first(await rpc("start", {
    p_student: profile.id, p_date: date, p_questions: draft.active.questions, p_retake: input.retake === true,
  }));
  return { active: activeQuestion(attempt), now: Date.now() };
}

async function answer(profile, input) {
  required(Number.isInteger(input.index) && input.index >= 0 && input.index < 50
    && Number.isInteger(input.choice) && input.choice >= 0 && input.choice < 4, "Select an answer before submitting.");
  const attempt = first(await rpc("answer", {
    p_student: profile.id, p_attempt: readId(input.id), p_index: input.index, p_choice: input.choice,
  }));
  return attempt.finished_at ? { result: review(attempt), now: Date.now() } : { active: activeQuestion(attempt), now: Date.now() };
}

async function history(studentId, input) {
  const start = offset(input.offset ?? 0);
  const rows = await table("attempts", {
    select: summaryColumns, student_id: `eq.${studentId}`, finished_at: "not.is.null",
    attempt_number: input.retakes === true ? "gt.1" : "eq.1",
    order: "finished_at.desc,id.desc", limit: 31, offset: start,
  });
  return { results: rows.slice(0, 30).map(summary), hasMore: rows.length > 30 };
}

async function resultFor(actor, input) {
  const query = { id: `eq.${readId(input.id)}`, finished_at: "not.is.null", limit: 1 };
  if (actor.role === "student") query.student_id = `eq.${actor.id}`;
  const attempt = first(await table("attempts", query));
  if (!attempt) throw new RequestError(404, "That result could not be found.");
  return review(attempt);
}

async function roster(input) {
  const calendar = await settings();
  const date = input.date ? readDate(input.date) : calendar.today;
  await rpc("expire", {});
  const [profiles, attempts] = await Promise.all([
    table("profiles", { select: "id,login,name,active", role: "eq.student", order: "name.asc,login.asc" }),
    table("attempts", { select: summaryColumns, test_date: `eq.${date}`, attempt_number: "eq.1" }),
  ]);
  const byStudent = new Map(attempts.map(attempt => [attempt.student_id, summary(attempt)]));
  return { ...calendar, date, students: profiles.map(profile => ({ ...profile, attempt: byStudent.get(profile.id) ?? null })) };
}

async function studentProfile(id) {
  const profile = first(await table("profiles", { id: `eq.${readId(id)}`, role: "eq.student", limit: 1 }));
  if (!profile) throw new RequestError(404, "That student could not be found.");
  return profile;
}

async function addStudent(input) {
  const login = readLogin(input.login);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  required(name && name.length <= 80, "Enter a display name of up to 80 characters.");
  if (first(await table("profiles", { login: `eq.${login}`, select: "id", limit: 1 }))) {
    throw new RequestError(409, "This student ID is already in use.");
  }
  const password = randomBytes(12).toString("base64url");
  const email = `class.${login}@students.example.com`;
  const created = await upstream("/auth/v1/admin/users", {
    method: "POST", body: { email, password, email_confirm: true },
  });
  const id = created.id ?? created.user?.id;
  try {
    await table("profiles", null, {
      method: "POST", body: { id, login, name, auth_email: email, role: "student", must_change_password: true },
    });
  } catch (error) {
    await upstream(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
    throw error;
  }
  return { login, password };
}

async function updateStudent(input) {
  const student = await studentProfile(input.id);
  if (input.reset === true) {
    const password = randomBytes(12).toString("base64url");
    await changePassword(student, password, true);
    return { login: student.login, password };
  }
  required(typeof input.active === "boolean", "Choose whether the student should have access.");
  const updated = first(await table("profiles", {
    id: `eq.${student.id}`, session_version: `eq.${student.session_version}`,
    or: `(password_lock_until.is.null,password_lock_until.lt.${new Date().toISOString()})`,
  }, {
    method: "PATCH", representation: true, body: { active: input.active, session_version: student.session_version + 1 },
  }));
  if (!updated) throw new RequestError(409, "This student account changed. Refresh and try again.");
  return { ok: true };
}

async function missedWords(studentId) {
  const list = await rpc("missed_words", { p_student: studentId });
  return list.slice(0, 30).map(row => ({
    word: catalog.byId.get(row.word_id).word, count: row.missed, unanswered: row.unanswered,
  }));
}

async function handleAction(request, input) {
  if (input.action === "login") {
    const { profile, token } = await signIn(input);
    return { value: loginInfo(profile), cookie: sessionCookie(request, token) };
  }

  const profile = await profileFor(request);
  if (input.action === "session") return { value: profile ? loginInfo(profile) : null };
  if (input.action === "logout") {
    const token = sessionToken(request);
    if (profile && token) await table("sessions", { fingerprint: `eq.${fingerprint(token)}` }, { method: "DELETE" });
    return { value: null, cookie: sessionCookie(request, "", 0) };
  }
  if (!profile) throw new RequestError(401, "Sign in to continue.");
  if (input.action === "set-password") {
    required(profile.must_change_password, "A temporary password is required for this action.");
    required(typeof input.password === "string" && input.password.length >= 12 && Buffer.byteLength(input.password) <= 72,
      "Choose a password of at least 12 characters and up to 72 bytes.");
    const updated = await changePassword(profile, input.password, false);
    const token = await createSession(updated);
    return { value: loginInfo(updated), cookie: sessionCookie(request, token) };
  }
  if (profile.must_change_password) throw new RequestError(403, "Replace your temporary password to continue.");

  if (input.action === "result") return { value: await resultFor(profile, input) };
  if (profile.role === "student") {
    switch (input.action) {
      case "student-home": return { value: await studentHome(profile) };
      case "start": return { value: await startAttempt(profile, input) };
      case "answer": return { value: await answer(profile, input) };
      case "history":
        await rpc("expire", { p_student: profile.id });
        return { value: await history(profile.id, input) };
    }
  } else {
    switch (input.action) {
      case "roster": return { value: await roster(input) };
      case "add-student": return { value: await addStudent(input) };
      case "update-student": return { value: await updateStudent(input) };
      case "student-report": {
        const student = await studentProfile(input.id);
        await rpc("expire", { p_student: student.id });
        const [records, words] = await Promise.all([history(student.id, input), input.offset ? null : missedWords(student.id)]);
        return { value: { student: loginInfo(student), ...records, words } };
      }
    }
  }
  throw new RequestError(403, "This action is not available for your account.");
}

export default {
  async fetch(request) {
    const headers = { "cache-control": "no-store" };
    try {
      if (request.method !== "POST") throw new RequestError(405, "Use POST for classroom requests.");
      if (request.headers.get("origin") !== new URL(request.url).origin) throw new RequestError(403, "Invalid request origin.");
      const body = await request.text();
      if (body.length > 8192) throw new RequestError(413, "Request is too large.");
      let input;
      try { input = JSON.parse(body); } catch { throw new RequestError(400, "Invalid request."); }
      if (!input || typeof input.action !== "string") throw new RequestError(400, "Select an action.");
      const { value, cookie } = await handleAction(request, input);
      if (cookie) headers["set-cookie"] = cookie;
      return Response.json(value, { headers });
    } catch (error) {
      if (!(error instanceof RequestError)) console.error(error);
      return Response.json({ error: error instanceof RequestError ? error.message : "Something went wrong. Try again." }, {
        status: error.status ?? 500, headers,
      });
    }
  },
};
