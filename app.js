import { storyActs } from "./story-data.js";
import { renderMicrophoneDiagnostics } from "./mic-diagnostics.js";
import { createStoryPreloader } from "./story-preloader.js";

const primaryViews = ["create", "home", "chapters", "journey", "charge"];

const mediaPages = {
  create: { src: "photo/01-login.webp", type: "image", alt: "幻乐之旅登录页面", next: "home", label: "继续旅程" },
  home: { src: "photo/02-map.webp", type: "image", alt: "幻乐世界地图", next: "chapters", prev: "create", label: "进入章节目录" },
  map: { src: "photo/02-map.webp", type: "image", alt: "幻乐世界地图", next: "chapters", prev: "create", label: "进入章节目录" },
  chapters: { src: "photo/03-chapters.webp", type: "image", alt: "萱草花章节目录", prev: "home", label: "选择练习章节" },
  journey: { src: "photo/04-journey.webp", type: "image", alt: "幻乐之旅开启页面", prev: "chapters", label: "开始今日冒险" },
  task: { src: "photo/journey-task.webp", type: "image", alt: "本阶段任务" },
  charge: { src: "photo/05-charge.webp", type: "image", alt: "魔法充电" },
  charged: { src: "photo/journey-charged.webp", type: "image", alt: "充电完成" }
};
const parentReportAssets = [
  "photo/parent-report-1.jpg",
  "photo/parent-report-2.jpg",
  "photo/parent-report-3.jpg",
  "photo/parent-report-4.jpg",
  "photo/parent-report-5.jpg",
  "photo/parent-report-6.jpg"
];
const isActOnePreview = new URLSearchParams(window.location.search).get("preview") === "act1";
const isMicrophoneDiagnostics = new URLSearchParams(window.location.search).get("diagnostics") === "mic";

const state = {
  view: isActOnePreview ? "story" : "create",
  actIndex: 0,
  phase: isActOnePreview ? "story" : "media",
  listeningReady: false,
  microphoneFallback: false,
  performanceCompleted: false,
  pendingStoryIndex: 0,
  stageReturnView: "journey",
  completedDay: 0,
  reportChapter: 1,
  replayChapter: null
};
const app = document.querySelector("#app");
let storyTimer = null;
const storyProgressKey = "fantasy-music-story-progress-v2";
const completedChaptersKey = "fantasy-music-completed-chapters-v1";
const chapterSize = 10;
const chapterCount = Math.ceil(storyActs.length / chapterSize);
const minimumListeningDuration = 30000;
const silenceDuration = 5000;
const silenceStartThreshold = 0.006;
const silenceContinueThreshold = 0.004;
const trainingSilenceDuration = 4000;
const trainingNoSoundTimeout = 30000;
const trainingSoundThreshold = 0.012;
let microphoneStream = null;
let microphoneContext = null;
let microphoneFrame = null;
let microphoneSession = 0;
const flowImagePreloads = new Map();
let trainingVideoPreload = null;
const storyPreloader = createStoryPreloader(storyActs);
const storyOverlayImagePaths = [
  "photo/act1-start-frame.png",
  "photo/act1-complete-layout-v5.webp",
  "photo/listening-frame-60-transparent-v2.png",
  "photo/subtitle-frame-blue-transparent-act1-v2.png"
];
const storyOverlayImagePreloads = new Map();

function preloadStoryOverlayImages() {
  storyOverlayImagePaths.forEach((path) => {
    if (storyOverlayImagePreloads.has(path)) return;
    const image = new Image();
    image.decoding = "async";
    image.src = `./${path}`;
    storyOverlayImagePreloads.set(path, image);
  });
}

const openingBgmViews = new Set(primaryViews);
const openingBgmPlaylist = [
  "./audio/1Where_the_Foxe.mp3",
  "./audio/2Through_The_Glassy_Pond.mp3",
  "./audio/2Through_The_Glassy_Pond.mp3"
];
const openingBgm = new Audio();
openingBgm.preload = "auto";
openingBgm.volume = 0.35;
let openingBgmIndex = 0;

function playOpeningBgm() {
  if (isMicrophoneDiagnostics) return;
  if (!openingBgmViews.has(state.view)) return;
  if (!openingBgm.src) openingBgm.src = openingBgmPlaylist[openingBgmIndex];
  openingBgm.play().catch(() => {});
}

function syncOpeningBgm() {
  if (openingBgmViews.has(state.view)) playOpeningBgm();
  else openingBgm.pause();
}

openingBgm.addEventListener("ended", () => {
  openingBgmIndex = (openingBgmIndex + 1) % openingBgmPlaylist.length;
  openingBgm.src = openingBgmPlaylist[openingBgmIndex];
  openingBgm.currentTime = 0;
  if (openingBgmViews.has(state.view)) playOpeningBgm();
});

window.addEventListener("pointerdown", playOpeningBgm, { once: true });
window.addEventListener("keydown", playOpeningBgm, { once: true });

function clearStoryTimer() {
  if (storyTimer !== null) {
    window.clearTimeout(storyTimer);
    storyTimer = null;
  }
}

function stopMicrophoneListening() {
  microphoneSession += 1;
  if (microphoneFrame !== null) {
    window.cancelAnimationFrame(microphoneFrame);
    microphoneFrame = null;
  }
  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
  }
  if (microphoneContext) {
    microphoneContext.close().catch(() => {});
    microphoneContext = null;
  }
}

function stopActiveStoryVideo() {
  const video = document.querySelector("video.story-media");
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
  storyPreloader.release(state.actIndex);
}

function showManualCompletion(session) {
  if (session !== microphoneSession || state.view !== "story" || state.phase !== "listening") return;
  clearStoryTimer();
  state.microphoneFallback = true;
  state.listeningReady = true;
  stopMicrophoneListening();
  updateStoryOverlay();
}

function makePerformanceCompletable(session) {
  if (session !== microphoneSession || state.view !== "story" || state.phase !== "listening") return;
  clearStoryTimer();
  state.listeningReady = true;
  state.microphoneFallback = false;
  stopMicrophoneListening();
  updateStoryOverlay();
}

async function beginMicrophoneListening() {
  stopMicrophoneListening();
  const session = microphoneSession;
  const startedAt = performance.now();
  let silenceStartedAt = null;
  let quietSamples = 0;

  const armManualFallback = () => {
    const fallbackSession = microphoneSession;
    const remaining = Math.max(0, minimumListeningDuration - (performance.now() - startedAt));
    storyTimer = window.setTimeout(() => showManualCompletion(fallbackSession), remaining);
  };

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    if (session !== microphoneSession || state.phase !== "listening") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    microphoneStream = stream;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio API is unavailable");
    microphoneContext = new AudioContextClass();
    await microphoneContext.resume();
    const source = microphoneContext.createMediaStreamSource(stream);
    const analyser = microphoneContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const monitor = (now) => {
      if (session !== microphoneSession || state.phase !== "listening") return;

      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const volume = Math.sqrt(energy / samples.length);

      if (now - startedAt >= minimumListeningDuration) {
        const threshold = silenceStartedAt === null ? silenceStartThreshold : silenceContinueThreshold;
        if (volume < threshold) {
          quietSamples += 1;
          if (silenceStartedAt === null && quietSamples >= 4) silenceStartedAt = now;
          if (silenceStartedAt !== null && now - silenceStartedAt >= silenceDuration) {
            makePerformanceCompletable(session);
            return;
          }
        } else {
          silenceStartedAt = null;
          quietSamples = 0;
        }
      } else {
        silenceStartedAt = null;
        quietSamples = 0;
      }

      microphoneFrame = window.requestAnimationFrame(monitor);
    };

    microphoneFrame = window.requestAnimationFrame(monitor);
  } catch {
    if (session !== microphoneSession || state.view !== "story" || state.phase !== "listening") return;
    stopMicrophoneListening();
    armManualFallback();
  }
}

function getCompletedChapters() {
  try {
    const saved = JSON.parse(localStorage.getItem(completedChaptersKey) || "[]");
    if (!Array.isArray(saved)) return [];
    const completed = new Set(saved.filter((item) => Number.isInteger(item) && item >= 0 && item < chapterCount));
    const contiguous = [];
    for (let chapter = 0; chapter < chapterCount && completed.has(chapter); chapter += 1) contiguous.push(chapter);
    return contiguous;
  } catch {
    return [];
  }
}

function getUnlockedChapterIndex() {
  return Math.min(getCompletedChapters().length, chapterCount - 1);
}

function isChapterPlayable(chapterIndex) {
  return chapterIndex >= 0 && chapterIndex < chapterCount &&
    (chapterIndex <= getUnlockedChapterIndex());
}

function recordChapterCompletion(chapterIndex) {
  try {
    const completed = new Set(getCompletedChapters());
    if (chapterIndex === completed.size) completed.add(chapterIndex);
    localStorage.setItem(completedChaptersKey, JSON.stringify([...completed].sort((a, b) => a - b)));
  } catch {
    // Keep the current session playable if browser storage is unavailable.
  }
}

function getSavedStoryProgress() {
  try {
    const saved = Number.parseInt(localStorage.getItem(storyProgressKey) || "0", 10);
    if (!Number.isInteger(saved)) return 0;
    const furthest = Math.min(Math.max(saved, 0), storyActs.length);
    const unlockedChapter = getUnlockedChapterIndex();
    const chapterStart = unlockedChapter * chapterSize;
    const chapterEnd = Math.min(chapterStart + chapterSize, storyActs.length);
    if (furthest < chapterStart) return chapterStart;
    if (furthest > chapterEnd) return chapterStart;
    if (furthest === chapterEnd && !getCompletedChapters().includes(unlockedChapter)) return chapterStart;
    return furthest;
  } catch {
    return 0;
  }
}

function saveStoryProgress(index) {
  try {
    const current = Number.parseInt(localStorage.getItem(storyProgressKey) || "0", 10);
    const safeCurrent = Number.isInteger(current) ? current : 0;
    const next = Math.min(Math.max(index, 0), storyActs.length);
    localStorage.setItem(storyProgressKey, String(Math.max(safeCurrent, next)));
  } catch {
    // The story still works when browser storage is unavailable.
  }
}

function go(view) {
  clearStoryTimer();
  stopMicrophoneListening();
  stopActiveStoryVideo();
  storyPreloader.stop();
  state.view = view;
  if (view === "story") {
    state.actIndex = 0;
    state.phase = "media";
    state.listeningReady = false;
    state.microphoneFallback = false;
    state.performanceCompleted = false;
  }
  render();
}

function startStory(index = 0) {
  const target = Math.min(Math.max(index, 0), storyActs.length - 1);
  const chapterIndex = Math.floor(target / chapterSize);
  if (!isChapterPlayable(chapterIndex)) return;
  if (chapterIndex < getUnlockedChapterIndex() && state.replayChapter !== chapterIndex) return;
  if (state.replayChapter !== null && chapterIndex !== state.replayChapter) return;
  if (state.replayChapter === null && chapterIndex === getUnlockedChapterIndex() && target > getSavedStoryProgress()) return;
  clearStoryTimer();
  stopMicrophoneListening();
  state.view = "story";
  state.actIndex = target;
  if (state.replayChapter === null) saveStoryProgress(state.actIndex);
  state.phase = "media";
  state.listeningReady = false;
  state.microphoneFallback = false;
  state.performanceCompleted = false;
  render();
}

function continueStory() {
  beginStoryAt(getSavedStoryProgress(), "journey");
}

const stageStartIndexes = new Set([0, 10, 20, 30, 40, 50]);

function showCompletedJourney() {
  state.view = "story";
  state.actIndex = storyActs.length - 1;
  state.phase = "complete";
  state.listeningReady = false;
  state.microphoneFallback = false;
  state.performanceCompleted = true;
  render();
}

function beginStoryAt(index, returnView = "journey") {
  if (!Number.isInteger(index) || index < 0) return;
  if (index >= storyActs.length) {
    if (index === storyActs.length && getCompletedChapters().length === chapterCount) showCompletedJourney();
    return;
  }
  const target = index;
  const chapterIndex = Math.floor(target / chapterSize);
  if (!isChapterPlayable(chapterIndex)) return;
  if (state.replayChapter !== null && chapterIndex !== state.replayChapter) return;
  if (state.replayChapter === null && chapterIndex !== getUnlockedChapterIndex()) return;
  if (state.replayChapter === null && target > getSavedStoryProgress()) return;
  if (!stageStartIndexes.has(target)) {
    startStory(target);
    return;
  }
  state.pendingStoryIndex = target;
  state.stageReturnView = returnView;
  go("charge");
}

function startStageFromProgress() {
  const progress = state.replayChapter === null ? getSavedStoryProgress() : state.pendingStoryIndex;
  beginStoryAt(progress, "journey");
}

function openChapters() {
  go("chapters");
}

function finishTraining() {
  if (state.view !== "training") return;
  beginTrainingMicrophoneListening();
}

function showChargedAfterTraining() {
  if (!["training", "charge"].includes(state.view)) return;
  clearStoryTimer();
  stopMicrophoneListening();
  state.view = "charged";
  render();
}

async function beginTrainingMicrophoneListening() {
  stopMicrophoneListening();
  const session = microphoneSession;
  const listeningView = state.view;
  let silenceStartedAt = null;
  let soundDetected = false;

  const fallback = () => {
    if (session !== microphoneSession || state.view !== listeningView) return;
    storyTimer = window.setTimeout(() => showChargedAfterTraining(), trainingNoSoundTimeout);
  };

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    if (session !== microphoneSession || state.view !== listeningView) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    microphoneStream = stream;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio API is unavailable");
    microphoneContext = new AudioContextClass();
    await microphoneContext.resume();
    const source = microphoneContext.createMediaStreamSource(stream);
    const analyser = microphoneContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const monitor = (now) => {
      if (session !== microphoneSession || state.view !== listeningView) return;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const volume = Math.sqrt(energy / samples.length);

      if (volume >= trainingSoundThreshold) {
        soundDetected = true;
        silenceStartedAt = null;
      } else {
        if (silenceStartedAt === null) silenceStartedAt = now;
        const quietDuration = now - silenceStartedAt;
        if (soundDetected && quietDuration >= trainingSilenceDuration) {
          showChargedAfterTraining();
          return;
        }
        if (!soundDetected && now - listeningStartedAt >= trainingNoSoundTimeout) {
          showChargedAfterTraining();
          return;
        }
      }
      microphoneFrame = window.requestAnimationFrame(monitor);
    };
    const listeningStartedAt = performance.now();
    silenceStartedAt = listeningStartedAt;
    microphoneFrame = window.requestAnimationFrame(monitor);
  } catch {
    stopMicrophoneListening();
    fallback();
  }
}

async function beginGrantedChargeMicrophoneListening() {
  if (state.view !== "charge" || !navigator.permissions?.query) return;
  try {
    const permission = await navigator.permissions.query({ name: "microphone" });
    if (permission.state === "granted" && state.view === "charge") {
      beginTrainingMicrophoneListening();
    }
  } catch {
    // Do not trigger a new permission prompt from the charge page.
  }
}

function enterPendingStory() {
  startStory(state.pendingStoryIndex);
}

function firstPageScreen(view, hotspots = "") {
  const page = mediaPages[view];
  const current = primaryViews.indexOf(view) + 1;
  const media = page.type === "video"
    ? `<video src="./${page.src}" aria-label="${page.alt}" autoplay loop playsinline preload="metadata"></video>`
    : `<img src="./${page.src}" alt="${page.alt}" />`;
  const nextAction = view === "journey" ? "startStageFromProgress()" : view === "chapters" ? "go('journey')" : `go('${page.next}')`;

  return `
    <section class="art-screen media-screen intro-screen ${view}-screen">
      ${media}
      <div class="media-count">${current}/${primaryViews.length + storyActs.length}</div>
      ${page.prev ? `<button class="media-nav media-prev" onclick="go('${page.prev}')" aria-label="上一页">‹</button>` : ""}
      <button class="media-cta" onclick="${nextAction}" aria-label="${page.label}">${page.label}</button>
      ${hotspots}
    </section>
  `;
}

function createView() {
  return firstPageScreen("create", `<button class="hotspot home-continue" onclick="go('home')" aria-label="进入幻乐世界"></button>`);
}

function homeView() {
  return firstPageScreen("home", `
    <button class="hotspot map-note-cloud" onclick="go('chapters')" aria-label="音符云海"></button>
    <button class="hotspot map-rhythm" onclick="go('chapters')" aria-label="节奏峡谷"></button>
    <button class="hotspot map-harmony" onclick="go('chapters')" aria-label="和声湖畔"></button>
  `);
}
function mapView() {
  return firstPageScreen("map", `
    <button class="hotspot songs-hc-card" onclick="go('journey')" aria-label="萱草花"></button>
    <button class="hotspot songs-start" onclick="go('journey')" aria-label="开始练习"></button>
    <button class="hotspot songs-progress" onclick="go('journey')" aria-label="当前进度"></button>
  `);
}

function selectChapter(index) {
  const target = Math.min(Math.max(index, 0), storyActs.length - 1);
  const chapterIndex = Math.floor(target / chapterSize);
  if (target % chapterSize !== 0 || !isChapterPlayable(chapterIndex)) return;
  state.replayChapter = getCompletedChapters().includes(chapterIndex) ? chapterIndex : null;
  const progress = getSavedStoryProgress();
  state.pendingStoryIndex = state.replayChapter === null && chapterIndex === getUnlockedChapterIndex() &&
    progress >= target && progress < Math.min(target + chapterSize, storyActs.length) ? progress : target;
  state.stageReturnView = "journey";
  go("journey");
}

function journeyView() {
  const preloadIndex = Number.isInteger(state.pendingStoryIndex)
    ? state.pendingStoryIndex
    : getSavedStoryProgress();
  storyPreloader.start(Math.min(Math.max(preloadIndex, 0), storyActs.length - 1));
  return firstPageScreen("journey", `
    <button class="hotspot journey-back" onclick="go('chapters')" aria-label="返回章节目录"></button>
    <button class="hotspot journey-chapters" onclick="startStageFromProgress()" aria-label="冒险启程"></button>
    <button class="hotspot journey-start" onclick="startStageFromProgress()" aria-label="开始今日冒险"></button>
  `);
}

function chaptersView() {
  const completed = new Set(getCompletedChapters());
  const unlocked = getUnlockedChapterIndex();
  const statuses = Array.from({ length: chapterCount }, (_, index) => {
    if (completed.has(index)) return "已完成";
    return index === unlocked ? "进行中" : "未解锁";
  });
  const labels = statuses.map((status, index) => `<span class="chapter-status chapter-status-${index + 1} ${status === "已完成" ? "is-complete" : status === "进行中" ? "is-current" : "is-locked"}" aria-hidden="true">${status}</span>`).join("");
  const chapterButtons = Array.from({ length: chapterCount }, (_, index) => {
    const start = index * chapterSize;
    const available = isChapterPlayable(index);
    const status = statuses[index];
    return `<button class="hotspot chapter-${["one", "two", "three", "four", "five", "six"][index]} ${available ? "is-available" : "is-locked"}" onclick="selectChapter(${start})" aria-label="${available ? (completed.has(index) ? "复习" : "进入") : "未解锁"}第${index + 1}章，第${start + 1}至${Math.min(start + chapterSize, storyActs.length)}幕" ${available ? "" : "disabled"}></button>`;
  }).join("");
  return firstPageScreen("chapters", `
    <button class="hotspot chapter-back" onclick="go('home')" aria-label="返回幻乐地图"></button>
    ${chapterButtons}
    ${labels}
    <button class="hotspot chapter-journey" onclick="openJourneyFromChapters()" aria-label="开启旅程"></button>
  `);
}

function openJourneyFromChapters() {
  state.replayChapter = null;
  state.pendingStoryIndex = getSavedStoryProgress();
  state.stageReturnView = "journey";
  go("journey");
}
function flowImageView(view, hotspots) {
  const page = mediaPages[view];
  return `
    <section class="art-screen media-screen journey-flow-screen ${view}-screen">
      <img src="./${page.src}" alt="${page.alt}" />
      ${hotspots}
    </section>
  `;
}

function preloadFlowImage(view) {
  const page = mediaPages[view];
  if (!page || page.type !== "image" || flowImagePreloads.has(view)) return;
  const image = new Image();
  image.decoding = "async";
  image.src = `./${page.src}`;
  flowImagePreloads.set(view, image);
}

function preloadTrainingVideo() {
  if (trainingVideoPreload) return;
  trainingVideoPreload = document.createElement("video");
  trainingVideoPreload.preload = "auto";
  trainingVideoPreload.muted = true;
  trainingVideoPreload.playsInline = true;
  trainingVideoPreload.src = "./photo/journey-training.mp4?v=20261017b";
  trainingVideoPreload.load();
}

function taskView() {
  preloadFlowImage("charge");
  preloadFlowImage("charged");
  preloadTrainingVideo();
  return flowImageView("task", `
    <button class="hotspot flow-back" onclick="go('${state.stageReturnView}')" aria-label="返回上一页"></button>
    <button class="hotspot task-start" onclick="go('charge')" aria-label="开启幻乐之旅"></button>
  `);
}

function chargeView() {
  preloadTrainingVideo();
  beginGrantedChargeMicrophoneListening();
  return flowImageView("charge", `
    <button class="hotspot flow-back" onclick="go('${state.stageReturnView}')" aria-label="返回上一页"></button>
    <button class="hotspot charge-start" onclick="go('training')" aria-label="开始充电"></button>
  `);
}

function trainingView() {
  return `
    <section class="art-screen media-screen journey-flow-screen training-screen">
      <video src="./photo/journey-training.mp4?v=20261017b" aria-label="魔法充电修炼" autoplay playsinline preload="auto" onended="finishTraining()"></video>
      <button class="training-back" onclick="go('charge')" aria-label="返回充电页">‹</button>
    </section>
  `;
}

function chargedView() {
  return flowImageView("charged", `
    <button class="hotspot flow-back" onclick="go('charge')" aria-label="返回充电页"></button>
    <button class="hotspot charged-start" onclick="enterPendingStory()" aria-label="开启秘境探索"></button>
  `);
}

function dayCompleteView() {
  const day = Math.min(Math.max(state.completedDay, 1), 5);
  return `
    <section class="art-screen media-screen journey-flow-screen day-complete-screen">
      <img src="./photo/day-complete-${day}.jpg" alt="第 ${day} 日冒险完成" />
      <button class="hotspot flow-back" onclick="go('journey')" aria-label="返回幻乐之旅"></button>
      <button class="hotspot day-complete-report" onclick="openParentReport(${day})" aria-label="查看第${day}章家长报告"></button>
      <button class="hotspot day-complete-next" onclick="beginNextDay()" aria-label="前往下一日冒险"></button>
    </section>
  `;
}

function parentReportView() {
  const chapter = Math.min(Math.max(state.reportChapter || 1, 1), parentReportAssets.length);
  return `
    <section class="art-screen media-screen journey-flow-screen parent-report-screen">
      <img src="./${parentReportAssets[chapter - 1]}" alt="第 ${chapter} 章家长报告" />
      <button class="hotspot parent-report-back" onclick="go('chapters')" aria-label="返回章节页面"></button>
    </section>
  `;
}

function openParentReport(chapter) {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > parentReportAssets.length) return;
  state.reportChapter = chapter;
  go("parentReport");
}

function beginNextDay() {
  beginStoryAt(state.pendingStoryIndex, "journey");
}

function storyOverlay() {
  const act = storyActs[state.actIndex];
  const densityClass = act.story.length > 105 || act.hint.length > 70
    ? "is-copy-very-dense"
    : act.story.length > 42 || act.hint.length > 42
      ? "is-copy-dense"
      : "";

  if (state.phase === "story") {
    return `
      <article class="asset-storybar act1-storybar act1-start-state ${densityClass}" aria-live="polite">
        <img class="asset-storybar-art" src="./photo/act1-start-frame.png" alt="" />
        <section class="act1-story-copy">
          <strong>${act.title}</strong>
          <span>${act.story}</span>
        </section>
        <section class="act1-hint-copy">
          <strong>演奏提示</strong>
          <span>${act.hint}</span>
        </section>
        <button class="act1-frame-action is-image-label" onclick="startListening()" aria-label="开始演奏"></button>
      </article>
    `;
  }

  if (state.phase === "listening") {
    const frame = state.listeningReady
      ? "photo/act1-complete-layout-v5.webp"
      : "photo/listening-frame-60-transparent-v2.png";
    return `
      <article class="asset-storybar act1-storybar is-listening ${state.listeningReady ? "is-ready act1-ready-state" : "act1-live-state"} ${densityClass}" aria-live="polite">
        <img class="asset-storybar-art" src="./${frame}" alt="" />
        <section class="act1-story-copy">
          <strong>${act.title}</strong>
          <span>${act.story}</span>
        </section>
        <section class="act1-hint-copy">
          <strong>演奏提示</strong>
          <span>${act.hint}</span>
        </section>
        ${state.microphoneFallback ? `<div class="performance-manual-help" role="status">无法检测麦克风，请确认练习已结束。</div>` : ""}
        ${state.listeningReady ? `<button class="act1-frame-action is-image-label" onclick="finishPerformance()" aria-label="${state.microphoneFallback ? "手动确认完成演奏" : "完成演奏"}"></button>` : ""}
      </article>
    `;
  }

  if (state.phase === "complete") {
    return `
      <article class="asset-storybar asset-complete" aria-live="polite">
        <img class="asset-storybar-art" src="./photo/subtitle-frame-blue-transparent-act1-v2.png" alt="" />
        <section class="asset-story-copy">
          <strong>六十幕音乐旅程完成</strong>
          <span>你和小狐狸成功跨越深谷，完成了六十幕《萱草花》音乐冒险。</span>
        </section>
        <section class="asset-hint-copy">
          <strong>获得完整冒险记忆</strong>
          <span>音乐桃子、小狐狸与穷奇的旅程已收入成长档案。</span>
        </section>
        <button class="asset-story-action" onclick="openParentReport(6)" aria-label="查看第六章家长报告">查看第六章家长报告</button>
      </article>
    `;
  }

  return `<p class="media-playing">故事正在展开…</p>`;
}

function storyView() {
  const act = storyActs[state.actIndex];

  return `
    <section class="story-screen">
      <div class="story-media-slot" aria-label="${act.title}"></div>
      <button class="story-exit" onclick="go('journey')" aria-label="退出故事">‹ <span>退出故事</span></button>
      <div class="story-progress">第 ${act.index} 幕 / ${storyActs.length}</div>
      <div class="story-layer">${storyOverlay()}</div>
    </section>
  `;
}

function mountStoryMedia() {
  if (state.view !== "story" || state.phase !== "media") return;
  const act = storyActs[state.actIndex];
  const slot = document.querySelector(".story-media-slot");
  if (!slot) return;
  let media = storyPreloader.acquire(state.actIndex);

  if (act.mediaType === "video") {
    if (!(media instanceof HTMLVideoElement)) media = document.createElement("video");
    media.className = "story-media";
    media.setAttribute("aria-label", act.title);
    media.playsInline = true;
    media.setAttribute("playsinline", "");
    media.preload = "auto";
    media.autoplay = true;
    media.muted = false;
    if (!media.getAttribute("src")) media.src = `./${act.mediaSrc}`;
    media.addEventListener("ended", showStory, { once: true });
    slot.replaceWith(media);
    storyPreloader.resume(state.actIndex);
    media.play().catch(() => {
      const retry = () => media.play().catch(() => {});
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    });
  } else {
    if (!(media instanceof HTMLImageElement)) media = new Image();
    media.className = "story-media";
    media.alt = act.title;
    if (!media.getAttribute("src")) media.src = `./${act.mediaSrc}`;
    slot.replaceWith(media);
    storyPreloader.resume(state.actIndex);
  }
}

function updateStoryOverlay() {
  const layer = document.querySelector(".story-layer");
  if (layer) layer.innerHTML = storyOverlay();
}

function showStory() {
  if (state.view !== "story" || state.phase !== "media") return;
  clearStoryTimer();
  state.phase = "story";
  updateStoryOverlay();
  storyPreloader.resume(state.actIndex);
}

function startListening() {
  if (state.view !== "story" || state.phase !== "story") return;
  clearStoryTimer();
  state.phase = "listening";
  state.listeningReady = false;
  state.microphoneFallback = false;
  state.performanceCompleted = false;
  updateStoryOverlay();
  storyPreloader.schedule(state.actIndex);
  beginMicrophoneListening();
}

function finishPerformance() {
  if (state.view !== "story" || state.phase !== "listening" || !state.listeningReady || state.performanceCompleted) return;
  state.performanceCompleted = true;
  stopMicrophoneListening();
  clearStoryTimer();
  stopActiveStoryVideo();
  const completedAct = state.actIndex + 1;
  const chapterIndex = Math.floor(state.actIndex / chapterSize);
  const chapterEndAct = Math.min((chapterIndex + 1) * chapterSize, storyActs.length);

  if (state.replayChapter === chapterIndex && completedAct === chapterEndAct) {
    state.view = "chapters";
    state.phase = "media";
    state.listeningReady = false;
    state.microphoneFallback = false;
    state.performanceCompleted = false;
    state.replayChapter = null;
    render();
    return;
  }

  if (state.actIndex === storyActs.length - 1) {
    recordChapterCompletion(chapterIndex);
    saveStoryProgress(storyActs.length);
    state.phase = "complete";
    updateStoryOverlay();
    return;
  }

  const nextIndex = state.actIndex + 1;
  saveStoryProgress(nextIndex);
  if (completedAct % 10 === 0) {
    recordChapterCompletion(chapterIndex);
    state.completedDay = completedAct / 10;
    state.pendingStoryIndex = nextIndex;
    state.stageReturnView = "journey";
    state.view = "dayComplete";
    state.phase = "media";
    state.listeningReady = false;
    state.microphoneFallback = false;
    state.performanceCompleted = false;
    render();
    return;
  }

  state.actIndex = nextIndex;
  state.phase = "media";
  state.listeningReady = false;
  state.microphoneFallback = false;
  state.performanceCompleted = false;
  render();
}

function prepareStoryAct() {
  if (state.view !== "story" || state.phase !== "media") return;
  const act = storyActs[state.actIndex];
  mountStoryMedia();
  if (act.mediaType === "image") {
    const expectedAct = state.actIndex;
    storyTimer = window.setTimeout(() => {
      if (state.view === "story" && state.actIndex === expectedAct && state.phase === "media") showStory();
    }, 3000);
  }
}

function render() {
  if (isMicrophoneDiagnostics) {
    renderMicrophoneDiagnostics(app);
    return;
  }
  const viewMap = {
    create: createView,
    home: homeView,
    map: mapView,
    journey: journeyView,
    chapters: chaptersView,
    task: taskView,
    charge: chargeView,
    training: trainingView,
    charged: chargedView,
    dayComplete: dayCompleteView,
    parentReport: parentReportView,
    story: storyView
  };
  app.innerHTML = viewMap[state.view]();
  prepareStoryAct();
  syncOpeningBgm();
}

window.go = go;
window.startStory = startStory;
window.continueStory = continueStory;
window.beginStoryAt = beginStoryAt;
window.startStageFromProgress = startStageFromProgress;
window.openChapters = openChapters;
window.selectChapter = selectChapter;
window.getOpeningBgmStatus = () => ({ paused: openingBgm.paused, index: openingBgmIndex, src: openingBgm.currentSrc });
window.finishTraining = finishTraining;
window.enterPendingStory = enterPendingStory;
window.beginNextDay = beginNextDay;
window.openParentReport = openParentReport;
window.showStory = showStory;
window.getStoryPreloadStatus = () => storyPreloader.snapshot();
window.getStoryPreloadDebug = () => storyPreloader.debug();
window.startListening = startListening;
window.finishPerformance = finishPerformance;
preloadStoryOverlayImages();
render();
