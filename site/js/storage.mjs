import { dateKey } from "./quiz.mjs";

const KEY = "vzip-vocab-test";
const VERSION = 1;

export function readState() {
  const saved = localStorage.getItem(KEY);
  if (!saved) return { version: VERSION, startDate: dateKey(), active: null, results: [] };
  const state = JSON.parse(saved);
  if (state.version !== VERSION || !state.startDate || !Array.isArray(state.results)) {
    throw new Error("The saved history could not be read.");
  }
  return state;
}

export function updateState(change) {
  const apply = () => {
    const state = readState();
    const result = change(state);
    localStorage.setItem(KEY, JSON.stringify(state));
    return { state, result };
  };
  // Re-read under the lock so two tabs cannot both submit the same question.
  return navigator.locks
    ? navigator.locks.request(KEY, apply)
    : Promise.resolve().then(apply);
}

export function onStateChange(callback) {
  window.addEventListener("storage", event => {
    if (event.key === KEY) callback();
  });
}
