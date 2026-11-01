const MAX_EAGER_VIDEO_BYTES = 20 * 1024 * 1024;

function getConnectionProfile() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    saveData: Boolean(connection?.saveData),
    effectiveType: connection?.effectiveType || "unknown",
    deviceMemory: Number(navigator.deviceMemory || 0)
  };
}

function canEagerlyLoad(sizeBytes) {
  const profile = getConnectionProfile();
  if (document.hidden || profile.saveData) return false;
  if (["slow-2g", "2g"].includes(profile.effectiveType)) return false;
  if (profile.deviceMemory > 0 && profile.deviceMemory <= 2) return false;
  return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_EAGER_VIDEO_BYTES;
}

function idle(callback, timeout = 1200) {
  return window.setTimeout(callback, Math.min(timeout, 500));
}

function cancelIdle(handle) {
  if (handle === null) return;
  window.clearTimeout(handle);
}

export function createStoryPreloader(acts) {
  const resources = acts.map((act, index) => ({
    index,
    act: act.index,
    url: `./${act.mediaSrc}`,
    type: act.mediaType,
    status: "idle",
    sizeBytes: null,
    mode: "none",
    element: null,
    error: null,
    retryCount: 0
  }));
  let scheduled = null;
  let generation = 0;
  let paused = false;
  let activeIndex = -1;
  let queueIndex = -1;
  let queueActive = false;

  function advanceQueue(resource, expectedGeneration) {
    if (queueIndex !== resource.index || paused || document.hidden) return;
    queueIndex += 1;
    scheduleQueueStep(expectedGeneration);
  }

  function resetElement(resource) {
    if (!resource?.element) return;
    const element = resource.element;
    element.pause?.();
    element.removeAttribute?.("src");
    element.load?.();
    resource.element = null;
    if (resource.status !== "in-use" && resource.status !== "ready") resource.status = "idle";
  }

  function disposeExcept(keepIndexes = []) {
    const keep = new Set(keepIndexes);
    resources.forEach((resource) => {
      if (!keep.has(resource.index) && resource.status !== "in-use") {
        resetElement(resource);
        resource.status = "idle";
        resource.mode = "none";
      }
    });
  }

  async function probeSize(resource, expectedGeneration) {
    if (resource.sizeBytes !== null) return resource.sizeBytes;
    try {
      const response = await fetch(resource.url, { method: "HEAD", cache: "force-cache" });
      if (expectedGeneration !== generation || !response.ok) return null;
      const size = Number(response.headers.get("content-length"));
      resource.sizeBytes = Number.isFinite(size) && size > 0 ? size : null;
    } catch {
      resource.sizeBytes = null;
    }
    return resource.sizeBytes;
  }

  function preloadImage(resource, expectedGeneration) {
    if (resource.status === "loading" || resource.status === "ready" || resource.status === "in-use") return;
    resource.status = "loading";
    resource.mode = "full";
    const image = new Image();
    resource.element = image;
    image.decoding = "async";
    image.onload = () => {
      if (expectedGeneration !== generation) return;
      resource.status = "ready";
      advanceQueue(resource, expectedGeneration);
    };
    image.onerror = () => {
      if (expectedGeneration !== generation) return;
      resource.status = "error";
      resource.error = "image-load-failed";
      resource.retryCount += 1;
      resource.element = null;
    };
    image.src = resource.url;
  }

  async function preloadVideo(resource, expectedGeneration) {
    if (resource.status === "probing" || resource.status === "loading" || resource.status === "ready" || resource.status === "in-use") return;
    resource.status = "probing";
    const sizeBytes = await probeSize(resource, expectedGeneration);
    if (expectedGeneration !== generation || paused || document.hidden) {
      resource.status = "idle";
      return;
    }

    const eager = queueActive ? canEagerlyLoad(sizeBytes) || sizeBytes > 0 : canEagerlyLoad(sizeBytes);
    const video = document.createElement("video");
    resource.element = video;
    resource.status = "loading";
    resource.mode = eager ? "next-scene" : "metadata";
    video.preload = eager ? "auto" : "metadata";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.addEventListener(eager ? "loadeddata" : "loadedmetadata", () => {
      if (expectedGeneration !== generation || resource.element !== video) return;
      resource.status = "ready";
      advanceQueue(resource, expectedGeneration);
    }, { once: true });
    video.addEventListener("error", () => {
      if (expectedGeneration !== generation || resource.element !== video) return;
      resource.error = "video-preload-failed";
      resource.retryCount += 1;
      resetElement(resource);
      resource.status = "error";
      advanceQueue(resource, expectedGeneration);
    }, { once: true });
    video.src = resource.url;
    video.load();
  }

  function preload(index, expectedGeneration) {
    const resource = resources[index];
    if (!resource || paused || document.hidden) return;
    if (resource.type === "image") preloadImage(resource, expectedGeneration);
    else preloadVideo(resource, expectedGeneration);
  }

  function scheduleQueueStep(expectedGeneration) {
    cancelIdle(scheduled);
    scheduled = null;
    if (queueIndex < 0 || queueIndex >= resources.length || paused || document.hidden) return;
    const resource = resources[queueIndex];
    if (["loading", "probing", "ready", "in-use"].includes(resource.status)) {
      if (resource.status === "ready" || resource.status === "in-use") {
        queueIndex += 1;
        scheduleQueueStep(expectedGeneration);
      }
      return;
    }
    scheduled = idle(() => {
      scheduled = null;
      preload(queueIndex, expectedGeneration);
    }, 0);
  }

  function schedule(currentIndex) {
    queueActive = false;
    generation += 1;
    const expectedGeneration = generation;
    queueIndex = currentIndex + 1;
    scheduleQueueStep(expectedGeneration);
  }

  function start(index) {
    generation += 1;
    paused = false;
    queueActive = true;
    queueIndex = Math.max(0, Number.isInteger(index) ? index : 0);
    scheduleQueueStep(generation);
  }

  function acquire(index) {
    const resource = resources[index];
    if (!resource?.element || !["loading", "ready"].includes(resource.status)) return null;
    const element = resource.element;
    resource.status = "in-use";
    resource.mode = "active";
    resource.element = null;
    return element;
  }

  function release(index) {
    const resource = resources[index];
    if (!resource) return;
    resource.status = "played";
    resource.mode = "browser-cache";
    resource.element = null;
  }

  function pause() {
    paused = true;
    generation += 1;
    cancelIdle(scheduled);
    scheduled = null;
    resources.forEach((resource) => {
      if (["probing", "loading"].includes(resource.status)) {
        resetElement(resource);
        resource.status = "idle";
        resource.mode = "none";
      }
    });
  }

  function stop() {
    pause();
    queueActive = false;
    resources.forEach((resource) => {
      if (resource.status !== "in-use") {
        resetElement(resource);
        resource.status = resource.status === "played" ? "played" : "idle";
        resource.mode = resource.status === "played" ? "browser-cache" : "none";
      }
    });
    queueIndex = -1;
  }

  function resume(index) {
    activeIndex = Number.isInteger(index) ? index : -1;
    paused = false;
    schedule(activeIndex);
  }

  function snapshot() {
    return resources.map(({ element, ...resource }) => ({
      ...resource,
      hasElement: Boolean(element),
      sizeMB: resource.sizeBytes ? Number((resource.sizeBytes / 1024 / 1024).toFixed(2)) : null
    }));
  }

  function debug() {
    return { activeIndex, generation, paused, hidden: document.hidden, scheduled: scheduled !== null };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (activeIndex >= 0) resume(activeIndex);
  });
  window.addEventListener("offline", pause);
  window.addEventListener("online", () => {
    if (activeIndex >= 0) resume(activeIndex);
  });

  return { acquire, debug, pause, release, resume, schedule, snapshot, start, stop, resources };
}
