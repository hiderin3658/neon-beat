"use strict";

const CONFIG = Object.freeze({
  duration: 30,
  bpm: 120,
  countdown: 3,
  travelTime: 1.5,
  perfectWindow: 0.08,
  goodWindow: 0.16,
  rhythmPattern: Object.freeze([1, 0.5, 0.5, 1.5, 1, 1.5, 1, 1]),
  volume: Object.freeze({
    countIn: 0.08,
    beat: 0.05,
    accent: 0.075,
    hit: 0.11,
  }),
});

const elements = {
  startScreen: document.querySelector("#start-screen"),
  gameScreen: document.querySelector("#game-screen"),
  resultScreen: document.querySelector("#result-screen"),
  startButton: document.querySelector("#start-button"),
  replayButton: document.querySelector("#replay-button"),
  hitPad: document.querySelector("#hit-pad"),
  score: document.querySelector("#score"),
  combo: document.querySelector("#combo"),
  time: document.querySelector("#time"),
  progressBar: document.querySelector("#progress-bar"),
  lane: document.querySelector("#lane"),
  notesLayer: document.querySelector("#notes-layer"),
  targetLine: document.querySelector(".target-line"),
  countdown: document.querySelector("#countdown"),
  judgement: document.querySelector("#judgement"),
  finalScore: document.querySelector("#final-score"),
  perfectCount: document.querySelector("#perfect-count"),
  goodCount: document.querySelector("#good-count"),
  missCount: document.querySelector("#miss-count"),
  maxCombo: document.querySelector("#max-combo"),
};

let audioContext = null;
let animationFrame = null;
let runId = 0;
let state = createInitialState();

function createInitialState() {
  return {
    phase: "idle",
    startTime: 0,
    endTime: 0,
    notes: [],
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, good: 0, miss: 0 },
    countdownValue: null,
  };
}

function formatScore(value) {
  return String(value).padStart(5, "0");
}

function showScreen(screen) {
  [elements.startScreen, elements.gameScreen, elements.resultScreen].forEach((item) => {
    item.classList.toggle("is-hidden", item !== screen);
  });
}

async function ensureAudio() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function playTone(time, frequency, duration, volume, type = "sine") {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const startAt = Math.max(time, audioContext.currentTime);
  const endAt = startAt + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.01);
}

function scheduleAudio(startTime, notes) {
  for (let i = CONFIG.countdown; i > 0; i -= 1) {
    const countTime = startTime - i;
    playTone(countTime, i === 1 ? 880 : 600, 0.07, CONFIG.volume.countIn, "square");
  }

  notes.forEach((note) => {
    playTone(
      note.targetTime,
      note.accent ? 520 : 360,
      note.accent ? 0.07 : 0.045,
      note.accent ? CONFIG.volume.accent : CONFIG.volume.beat,
      "triangle",
    );
  });
}

function buildNotes(startTime) {
  const beatLength = 60 / CONFIG.bpm;
  const notes = [];
  let beatOffset = 0;
  let index = 0;

  while (beatOffset * beatLength < CONFIG.duration) {
    const element = document.createElement("div");
    const accent = Math.abs(beatOffset % 4) < 0.001;
    element.className = `note${accent ? " is-accent" : ""}`;
    element.style.display = "none";
    elements.notesLayer.appendChild(element);

    notes.push({
      index,
      targetTime: startTime + beatOffset * beatLength,
      accent,
      judged: false,
      element,
    });

    beatOffset += CONFIG.rhythmPattern[index % CONFIG.rhythmPattern.length];
    index += 1;
  }

  return notes;
}

async function startGame() {
  try {
    await ensureAudio();
  } catch (error) {
    console.error(error);
    elements.startButton.textContent = "AUDIO NOT SUPPORTED";
    elements.startButton.disabled = true;
    return;
  }

  runId += 1;
  const currentRun = runId;
  cancelAnimationFrame(animationFrame);
  elements.notesLayer.replaceChildren();
  state = createInitialState();
  state.phase = "countdown";
  state.startTime = audioContext.currentTime + CONFIG.countdown;
  state.endTime = state.startTime + CONFIG.duration;
  state.notes = buildNotes(state.startTime);

  updateHud();
  showScreen(elements.gameScreen);
  scheduleAudio(state.startTime, state.notes);
  animationFrame = requestAnimationFrame(() => updateGame(currentRun));
}

function updateGame(currentRun) {
  if (currentRun !== runId || state.phase === "finished") return;

  const now = audioContext.currentTime;
  const timeUntilStart = state.startTime - now;

  if (timeUntilStart > 0) {
    updateCountdown(timeUntilStart);
  } else {
    if (state.phase === "countdown") {
      state.phase = "playing";
      state.countdownValue = null;
      elements.countdown.textContent = "GO!";
      window.setTimeout(() => {
        if (state.phase === "playing") elements.countdown.textContent = "";
      }, 420);
    }

    const remaining = Math.max(0, state.endTime - now);
    elements.time.textContent = remaining.toFixed(1);
    elements.progressBar.style.width = `${Math.min(100, ((now - state.startTime) / CONFIG.duration) * 100)}%`;
    markPassedNotes(now);

    if (now >= state.endTime) {
      finishGame();
      return;
    }
  }

  renderNotes(now);
  animationFrame = requestAnimationFrame(() => updateGame(currentRun));
}

function updateCountdown(timeUntilStart) {
  const nextValue = Math.max(1, Math.ceil(timeUntilStart));
  if (nextValue !== state.countdownValue) {
    state.countdownValue = nextValue;
    elements.countdown.textContent = String(nextValue);
  }
}

function renderNotes(now) {
  const laneHeight = elements.lane.clientHeight;
  const spawnY = -24;
  const targetY = laneHeight * 0.9;

  state.notes.forEach((note) => {
    if (note.judged) return;

    const timeToTarget = note.targetTime - now;
    if (timeToTarget > CONFIG.travelTime || timeToTarget < -CONFIG.goodWindow) {
      note.element.style.display = "none";
      return;
    }

    const progress = 1 - timeToTarget / CONFIG.travelTime;
    const y = spawnY + progress * (targetY - spawnY);
    const scale = 0.55 + Math.min(1, Math.max(0, progress)) * 0.45;
    note.element.style.display = "block";
    note.element.style.transform = `translate(-50%, ${y}px) scaleX(${scale})`;
  });
}

function markPassedNotes(now) {
  state.notes.forEach((note) => {
    if (!note.judged && now - note.targetTime > CONFIG.goodWindow) {
      applyJudgement(note, "miss");
    }
  });
}

function handleHit() {
  if (state.phase !== "playing") return;

  const now = audioContext.currentTime;
  let closestNote = null;
  let closestDifference = Number.POSITIVE_INFINITY;

  state.notes.forEach((note) => {
    if (note.judged) return;
    const difference = Math.abs(now - note.targetTime);
    if (difference < closestDifference) {
      closestNote = note;
      closestDifference = difference;
    }
  });

  flashHitPad();
  if (!closestNote || closestDifference > CONFIG.goodWindow) return;

  const judgement = closestDifference <= CONFIG.perfectWindow ? "perfect" : "good";
  applyJudgement(closestNote, judgement);
  playTone(now, judgement === "perfect" ? 920 : 720, 0.09, CONFIG.volume.hit, "sine");
}

function applyJudgement(note, judgement) {
  note.judged = true;
  note.element.remove();

  if (judgement === "perfect") {
    state.score += 1000;
    state.combo += 1;
  } else if (judgement === "good") {
    state.score += 500;
    state.combo += 1;
  } else {
    state.combo = 0;
  }

  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.counts[judgement] += 1;
  updateHud();
  showJudgement(judgement);
}

function updateHud() {
  elements.score.textContent = formatScore(state.score);
  elements.combo.textContent = String(state.combo);
  if (state.phase === "countdown") {
    elements.time.textContent = CONFIG.duration.toFixed(1);
    elements.progressBar.style.width = "0%";
  }
}

function showJudgement(judgement) {
  elements.judgement.textContent = judgement.toUpperCase();
  elements.judgement.className = `judgement ${judgement}`;
  void elements.judgement.offsetWidth;
  elements.judgement.classList.add("show");

  elements.targetLine.classList.remove("is-hit");
  void elements.targetLine.offsetWidth;
  elements.targetLine.classList.add("is-hit");
}

function flashHitPad() {
  elements.hitPad.classList.add("is-pressed");
  window.setTimeout(() => elements.hitPad.classList.remove("is-pressed"), 90);
}

function finishGame() {
  state.phase = "finished";
  cancelAnimationFrame(animationFrame);

  state.notes.forEach((note) => {
    if (!note.judged) applyJudgement(note, "miss");
  });

  elements.time.textContent = "0.0";
  elements.progressBar.style.width = "100%";
  elements.finalScore.textContent = formatScore(state.score);
  elements.perfectCount.textContent = String(state.counts.perfect);
  elements.goodCount.textContent = String(state.counts.good);
  elements.missCount.textContent = String(state.counts.miss);
  elements.maxCombo.textContent = String(state.maxCombo);

  window.setTimeout(() => {
    showScreen(elements.resultScreen);
    elements.replayButton.focus({ preventScroll: true });
  }, 350);
}

elements.startButton.addEventListener("click", startGame);
elements.replayButton.addEventListener("click", startGame);
elements.hitPad.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  handleHit();
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat || state.phase !== "playing") return;
  event.preventDefault();
  handleHit();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.phase !== "idle" && state.phase !== "finished") {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => updateGame(runId));
  }
});
