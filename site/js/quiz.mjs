export const QUESTION_COUNT = 50;
export const TEST_DURATION = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const seoulDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const displayDate = new Intl.DateTimeFormat("en", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const displayLongDate = new Intl.DateTimeFormat("en", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function dateKey(now = Date.now()) {
  return seoulDate.format(now);
}

export function formatDate(date, long = false) {
  return (long ? displayLongDate : displayDate).format(Date.parse(date));
}

function daysBetween(start, end) {
  return (Date.parse(end) - Date.parse(start)) / DAY;
}

export function dateAtOffset(date, days) {
  return new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
}

function seededRandom(seed) {
  let state = 2166136261;
  for (const character of seed) {
    state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let bits = Math.imul(state ^ (state >>> 15), state | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function wordsForDate(entries, startDate, testDate) {
  const offset = daysBetween(startDate, testDate);
  const cycleLength = entries.length / QUESTION_COUNT;
  const cycle = Math.floor(offset / cycleLength);
  const first = (offset % cycleLength) * QUESTION_COUNT;
  return shuffled(entries, seededRandom(`vzip-1/${startDate}/${cycle}`))
    .slice(first, first + QUESTION_COUNT);
}

const commonWords = new Set(
  "a an and as at be by for from in is it of on or so that the their them they this to used with someone something especially often usually also".split(" "),
);

function definitionTokens(definition) {
  return new Set(
    (definition.toLowerCase().match(/[a-z]+/g) ?? []).filter(word => !commonWords.has(word)),
  );
}

function similarDefinition(left, right) {
  const shared = [...left].filter(word => right.has(word)).length;
  return shared > 0 && shared >= Math.min(left.size, right.size) * 0.5;
}

export function makeCatalog(entries) {
  if (entries.length !== 2400 || new Set(entries.map(entry => entry.id)).size !== entries.length) {
    throw new Error("The vocabulary file is incomplete.");
  }
  return {
    entries,
    byId: new Map(entries.map(entry => [entry.id, entry])),
    definitions: new Map(entries.map(entry => [entry.id, definitionTokens(entry.definition)])),
    parts: new Map(entries.map(entry => [entry.id, entry.pos.split(", ")])),
  };
}

function makeQuestion(target, catalog, random) {
  const correctTokens = catalog.definitions.get(target.id);
  const targetParts = catalog.parts.get(target.id);
  const distractors = [];
  const candidates = shuffled(catalog.entries, random)
    .filter(entry => entry.id !== target.id && !similarDefinition(correctTokens, catalog.definitions.get(entry.id)));
  const matchingParts = entry => catalog.parts.get(entry.id).some(part => targetParts.includes(part));
  const preferred = candidates.filter(matchingParts);
  const pool = preferred.length >= 3 ? preferred : [...preferred, ...candidates.filter(entry => !matchingParts(entry))];
  for (const candidate of pool) {
    const tokens = catalog.definitions.get(candidate.id);
    if (distractors.every(entry => !similarDefinition(tokens, catalog.definitions.get(entry.id)))) {
      distractors.push(candidate);
    }
    if (distractors.length === 3) break;
  }
  if (distractors.length !== 3) throw new Error(`Couldn't make four choices for ${target.word}.`);
  return { wordId: target.id, choiceIds: shuffled([target.id, ...distractors.map(entry => entry.id)], random) };
}

export function resultsForDate(state, testDate) {
  return state.results.filter(result => result.testDate === testDate);
}

export function makeAttempt(state, catalog, testDate, now = Date.now()) {
  if (state.active || testDate < state.startDate || testDate > dateKey(now)) return;
  const attemptNumber = resultsForDate(state, testDate).length + 1;
  const random = seededRandom(`vzip-attempt-1/${state.startDate}/${testDate}/${attemptNumber}`);
  const words = wordsForDate(catalog.entries, state.startDate, testDate);
  const questions = shuffled(words, random).map(word => makeQuestion(word, catalog, random));
  state.active = {
    testDate,
    attemptNumber,
    startedAt: now,
    deadline: now + TEST_DURATION,
    questions,
    answers: [],
  };
}

function finishAttempt(state, finishedAt, timedOut) {
  const { questions, answers, ...attempt } = state.active;
  const review = questions.map(({ wordId }, index) => ({
    wordId,
    selectedId: answers[index] ?? null,
  }));
  const result = {
    ...attempt,
    finishedAt,
    timedOut,
    score: review.filter(({ wordId, selectedId }) => wordId === selectedId).length,
    review,
  };
  state.results.push(result);
  state.active = null;
  return result;
}

export function resolveDeadline(state, now = Date.now()) {
  if (state.active && now >= state.active.deadline) {
    return finishAttempt(state, state.active.deadline, true);
  }
}

export function submitAnswer(state, attempt, index, choiceId, now = Date.now()) {
  const expired = resolveDeadline(state, now);
  if (expired) return expired;
  const current = state.active;
  if (
    !current || current.testDate !== attempt.testDate || current.attemptNumber !== attempt.attemptNumber
    || current.answers.length !== index || !current.questions[index]?.choiceIds.includes(choiceId)
  ) return;
  current.answers.push(choiceId);
  if (current.answers.length === QUESTION_COUNT) return finishAttempt(state, now, false);
}

export function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
