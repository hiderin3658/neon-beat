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

const ECHO_CONFIG = Object.freeze({
  rounds: 4,
  lengths: Object.freeze([4, 6, 8, 10]),
  bpms: Object.freeze([86, 96, 106, 116]),
  rhythmPattern: Object.freeze([1, 0.5, 1.5, 1, 0.5, 0.5]),
  perfectWindow: 0.1,
  goodWindow: 0.22,
  playbackLead: 0.8,
  frequencies: Object.freeze({ cyan: 440, pink: 660 }),
});

const elements = {
  startScreen: document.querySelector("#start-screen"),
  gameScreen: document.querySelector("#game-screen"),
  echoScreen: document.querySelector("#echo-screen"),
  resultScreen: document.querySelector("#result-screen"),
  startButton: document.querySelector("#start-button"),
  echoStartButton: document.querySelector("#echo-start-button"),
  replayButton: document.querySelector("#replay-button"),
  menuButton: document.querySelector("#menu-button"),
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
  echoScore: document.querySelector("#echo-score"),
  echoRound: document.querySelector("#echo-round"),
  echoPhase: document.querySelector("#echo-phase"),
  echoInstruction: document.querySelector("#echo-instruction"),
  echoSteps: document.querySelector("#echo-steps"),
  echoJudgement: document.querySelector("#echo-judgement"),
  echoCombo: document.querySelector("#echo-combo"),
  echoCyanPad: document.querySelector("#echo-cyan-pad"),
  echoPinkPad: document.querySelector("#echo-pink-pad"),
  resultEyebrow: document.querySelector("#result-eyebrow"),
  resultTitle: document.querySelector("#result-title"),
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
let echoState = createInitialEchoState();
let currentMode = "beat";
let echoTimers = [];
let echoResponseTimer = null;

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

function createInitialEchoState() {
  return {
    phase: "idle",
    round: 1,
    sequence: [],
    inputIndex: 0,
    inputAnchor: null,
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, good: 0, miss: 0 },
  };
}

function formatScore(value) {
  return String(value).padStart(5, "0");
}

function showScreen(screen) {
  [elements.startScreen, elements.gameScreen, elements.echoScreen, elements.resultScreen].forEach((item) => {
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

  currentMode = "beat";
  clearEchoTimers();
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

  window.setTimeout(() => {
    presentResults("beat", state.score, state.counts, state.maxCombo);
  }, 350);
}

function presentResults(mode, score, counts, maxCombo) {
  currentMode = mode;
  elements.resultEyebrow.textContent = mode === "echo" ? "LEVEL 02 COMPLETE" : "LEVEL 01 COMPLETE";
  elements.resultTitle.textContent = mode === "echo" ? "ECHO CLEAR!" : "FINISH!";
  elements.finalScore.textContent = formatScore(score);
  elements.perfectCount.textContent = String(counts.perfect);
  elements.goodCount.textContent = String(counts.good);
  elements.missCount.textContent = String(counts.miss);
  elements.maxCombo.textContent = String(maxCombo);
  showScreen(elements.resultScreen);
  elements.replayButton.focus({ preventScroll: true });
}

function clearEchoTimers() {
  echoTimers.forEach((timer) => window.clearTimeout(timer));
  echoTimers = [];
  if (echoResponseTimer !== null) {
    window.clearTimeout(echoResponseTimer);
    echoResponseTimer = null;
  }
}

function scheduleEchoTimer(callback, delay) {
  const timer = window.setTimeout(callback, Math.max(0, delay));
  echoTimers.push(timer);
  return timer;
}

async function startEchoGame() {
  try {
    await ensureAudio();
  } catch (error) {
    console.error(error);
    elements.echoStartButton.textContent = "AUDIO NOT SUPPORTED";
    elements.echoStartButton.disabled = true;
    return;
  }

  currentMode = "echo";
  runId += 1;
  cancelAnimationFrame(animationFrame);
  clearEchoTimers();
  state = createInitialState();
  echoState = createInitialEchoState();
  elements.echoPhase.classList.remove("is-repeat");
  elements.echoPhase.textContent = "GET READY";
  elements.echoInstruction.textContent = "光と音の順番を覚えろ";
  elements.echoJudgement.textContent = "";
  elements.echoSteps.replaceChildren();
  updateEchoHud();
  showScreen(elements.echoScreen);
  scheduleEchoTimer(startEchoRound, 600);
}

function buildEchoSequence(round) {
  const length = ECHO_CONFIG.lengths[round - 1];
  const beatLength = 60 / ECHO_CONFIG.bpms[round - 1];
  const sequence = [];
  let offset = 0;

  for (let index = 0; index < length; index += 1) {
    let pad = Math.random() < 0.5 ? "cyan" : "pink";
    if (index >= 2 && sequence[index - 1].pad === pad && sequence[index - 2].pad === pad) {
      pad = pad === "cyan" ? "pink" : "cyan";
    }

    sequence.push({ pad, offset });
    offset += ECHO_CONFIG.rhythmPattern[index % ECHO_CONFIG.rhythmPattern.length] * beatLength;
  }

  return sequence;
}

function renderEchoSteps() {
  elements.echoSteps.replaceChildren();
  echoState.sequence.forEach(() => {
    const step = document.createElement("span");
    step.className = "echo-step";
    elements.echoSteps.appendChild(step);
  });
}

function startEchoRound() {
  clearEchoTimers();
  echoState.phase = "listen";
  echoState.sequence = buildEchoSequence(echoState.round);
  echoState.inputIndex = 0;
  echoState.inputAnchor = null;
  renderEchoSteps();
  updateEchoHud();

  elements.echoPhase.classList.remove("is-repeat");
  elements.echoPhase.textContent = "LISTEN";
  elements.echoInstruction.textContent = "まだ触らず、リズムを記憶";

  const playbackStart = audioContext.currentTime + ECHO_CONFIG.playbackLead;
  const stepElements = Array.from(elements.echoSteps.children);

  echoState.sequence.forEach((event, index) => {
    const eventTime = playbackStart + event.offset;
    const frequency = ECHO_CONFIG.frequencies[event.pad];
    playTone(eventTime, frequency, 0.14, 0.12, event.pad === "cyan" ? "sine" : "triangle");

    scheduleEchoTimer(() => {
      flashEchoPad(event.pad);
      stepElements[index].classList.add("is-active");
      scheduleEchoTimer(() => {
        stepElements[index].classList.remove("is-active");
        stepElements[index].classList.add("is-heard");
      }, 190);
    }, (eventTime - audioContext.currentTime) * 1000);
  });

  const finalEvent = echoState.sequence[echoState.sequence.length - 1];
  const playbackDuration = (playbackStart - audioContext.currentTime + finalEvent.offset) * 1000;
  scheduleEchoTimer(beginEchoRepeat, playbackDuration + 750);
}

function beginEchoRepeat() {
  echoState.phase = "repeat";
  echoState.inputIndex = 0;
  echoState.inputAnchor = null;
  elements.echoPhase.classList.add("is-repeat");
  elements.echoPhase.textContent = "REPEAT";
  elements.echoInstruction.textContent = "同じ色・同じ間隔で返せ — F / J またはタップ";
  Array.from(elements.echoSteps.children).forEach((step) => {
    step.className = "echo-step";
  });

  const finalOffset = echoState.sequence[echoState.sequence.length - 1].offset;
  echoResponseTimer = scheduleEchoTimer(timeoutEchoRound, (finalOffset + 4) * 1000);
}

function handleEchoHit(pad) {
  if (echoState.phase !== "repeat") return;

  const now = audioContext.currentTime;
  const expected = echoState.sequence[echoState.inputIndex];
  flashEchoPad(pad);
  playTone(now, ECHO_CONFIG.frequencies[pad], 0.12, CONFIG.volume.hit, pad === "cyan" ? "sine" : "triangle");

  if (echoState.inputAnchor === null) {
    echoState.inputAnchor = now;
  }

  const expectedElapsed = expected.offset - echoState.sequence[0].offset;
  const actualElapsed = now - echoState.inputAnchor;
  const timingDifference = Math.abs(actualElapsed - expectedElapsed);
  let judgement = "miss";

  if (pad === expected.pad && timingDifference <= ECHO_CONFIG.perfectWindow) {
    judgement = "perfect";
  } else if (pad === expected.pad && timingDifference <= ECHO_CONFIG.goodWindow) {
    judgement = "good";
  }

  applyEchoJudgement(judgement, echoState.inputIndex);
  echoState.inputIndex += 1;

  if (echoState.inputIndex >= echoState.sequence.length) {
    completeEchoRound();
  }
}

function applyEchoJudgement(judgement, stepIndex) {
  if (judgement === "perfect") {
    echoState.score += 1000;
    echoState.combo += 1;
  } else if (judgement === "good") {
    echoState.score += 500;
    echoState.combo += 1;
  } else {
    echoState.combo = 0;
  }

  echoState.maxCombo = Math.max(echoState.maxCombo, echoState.combo);
  echoState.counts[judgement] += 1;
  const step = elements.echoSteps.children[stepIndex];
  if (step) step.className = `echo-step is-${judgement}`;
  updateEchoHud();
  showEchoJudgement(judgement);
}

function updateEchoHud() {
  elements.echoScore.textContent = formatScore(echoState.score);
  elements.echoRound.textContent = String(echoState.round);
  elements.echoCombo.textContent = String(echoState.combo);
}

function showEchoJudgement(judgement, label = judgement.toUpperCase()) {
  elements.echoJudgement.textContent = label;
  elements.echoJudgement.className = `judgement echo-judgement ${judgement}`;
  void elements.echoJudgement.offsetWidth;
  elements.echoJudgement.classList.add("show");
}

function flashEchoPad(pad) {
  const element = pad === "cyan" ? elements.echoCyanPad : elements.echoPinkPad;
  element.classList.add("is-active");
  window.setTimeout(() => element.classList.remove("is-active"), 170);
}

function completeEchoRound() {
  if (echoState.phase !== "repeat") return;
  echoState.phase = "transition";
  if (echoResponseTimer !== null) {
    window.clearTimeout(echoResponseTimer);
    echoResponseTimer = null;
  }
  elements.echoPhase.classList.remove("is-repeat");
  elements.echoPhase.textContent = "SYNCED";
  elements.echoInstruction.textContent = "次のシーケンスを準備中";

  if (echoState.round >= ECHO_CONFIG.rounds) {
    scheduleEchoTimer(finishEchoGame, 950);
    return;
  }

  echoState.round += 1;
  scheduleEchoTimer(startEchoRound, 1100);
}

function timeoutEchoRound() {
  if (echoState.phase !== "repeat") return;

  while (echoState.inputIndex < echoState.sequence.length) {
    applyEchoJudgement("miss", echoState.inputIndex);
    echoState.inputIndex += 1;
  }
  showEchoJudgement("miss", "TIME OUT");
  completeEchoRound();
}

function finishEchoGame() {
  clearEchoTimers();
  echoState.phase = "finished";
  presentResults("echo", echoState.score, echoState.counts, echoState.maxCombo);
}

function returnToMenu() {
  runId += 1;
  cancelAnimationFrame(animationFrame);
  clearEchoTimers();
  state = createInitialState();
  echoState = createInitialEchoState();
  showScreen(elements.startScreen);
  elements.startButton.focus({ preventScroll: true });
}

elements.startButton.addEventListener("click", startGame);
elements.echoStartButton.addEventListener("click", startEchoGame);
elements.replayButton.addEventListener("click", () => {
  if (currentMode === "echo") {
    startEchoGame();
  } else {
    startGame();
  }
});
elements.menuButton.addEventListener("click", returnToMenu);
elements.hitPad.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  handleHit();
});
elements.echoCyanPad.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  handleEchoHit("cyan");
});
elements.echoPinkPad.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  handleEchoHit("pink");
});

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;

  if (event.code === "Space" && currentMode === "beat" && state.phase === "playing") {
    event.preventDefault();
    handleHit();
    return;
  }

  if (currentMode === "echo" && echoState.phase === "repeat" && ["KeyF", "KeyJ"].includes(event.code)) {
    event.preventDefault();
    handleEchoHit(event.code === "KeyF" ? "cyan" : "pink");
  }
});

document.addEventListener("visibilitychange", () => {
  if (
    currentMode === "beat" &&
    document.visibilityState === "visible" &&
    state.phase !== "idle" &&
    state.phase !== "finished"
  ) {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => updateGame(runId));
  }
});
