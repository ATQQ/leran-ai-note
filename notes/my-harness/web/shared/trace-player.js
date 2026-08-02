/**
 * M7.4 Trace 步进播放器（对齐 function-call-demo Viewer 的核心能力）
 * - 加载 harness Trace JSON（steps[]）
 * - 上一步 / 下一步 / 自动播放
 * - 按 actor 高亮 Harness / Model / Tool
 */

/**
 * @param {{
 *   stepEl: HTMLElement,
 *   pillEl: HTMLElement,
 *   flowEl: HTMLElement,
 *   btnPrev: HTMLButtonElement,
 *   btnNext: HTMLButtonElement,
 *   btnPlay: HTMLButtonElement,
 * }} els
 */
export function createTracePlayer(els) {
  let steps = [];
  let index = -1;
  let timer = null;

  function setButtons() {
    const has = steps.length > 0;
    els.btnPrev.disabled = !has || index <= 0;
    els.btnNext.disabled = !has || index >= steps.length - 1;
    els.btnPlay.disabled = !has;
  }

  function lit(actor) {
    for (const node of els.flowEl.querySelectorAll(".node")) {
      node.classList.remove("on", "on-harness", "on-model", "on-tool");
      if (node.getAttribute("data-actor") === actor) {
        node.classList.add("on", "on-" + actor);
      }
    }
  }

  function render() {
    if (index < 0 || !steps[index]) {
      els.stepEl.textContent = steps.length
        ? "（用下一步开始）"
        : "（尚未加载 Trace）";
      els.pillEl.textContent = steps.length ? "0/" + steps.length : "—";
      lit("");
      setButtons();
      return;
    }
    const s = steps[index];
    els.pillEl.textContent = index + 1 + "/" + steps.length;
    els.stepEl.textContent = JSON.stringify(
      {
        id: s.id,
        phase: s.phase,
        title: s.title,
        summary: s.summary,
        actor: s.actor,
        direction: s.direction,
        note: s.note,
        payload: s.payload,
        at: s.at,
      },
      null,
      2,
    );
    lit(s.actor || "");
    setButtons();
  }

  function stopPlay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    els.btnPlay.textContent = "自动播放";
  }

  return {
    load(trace) {
      stopPlay();
      steps = Array.isArray(trace?.steps) ? trace.steps : [];
      index = steps.length ? 0 : -1;
      els.pillEl.textContent = steps.length
        ? "1/" + steps.length
        : "empty";
      els.pillEl.className = "pill" + (steps.length ? " ok" : " warn");
      render();
    },
    setError(msg) {
      stopPlay();
      steps = [];
      index = -1;
      els.stepEl.textContent = msg;
      els.pillEl.textContent = "err";
      els.pillEl.className = "pill err";
      setButtons();
    },
    next() {
      if (index < steps.length - 1) {
        index += 1;
        render();
      } else stopPlay();
    },
    prev() {
      if (index > 0) {
        index -= 1;
        render();
      }
    },
    togglePlay() {
      if (timer) {
        stopPlay();
        return;
      }
      els.btnPlay.textContent = "暂停";
      timer = setInterval(() => {
        if (index >= steps.length - 1) {
          stopPlay();
          return;
        }
        index += 1;
        render();
      }, 900);
    },
  };
}

// wire buttons if present when factory returns — caller binds:
// player.next etc. We attach in factory via els for convenience.
export function bindTracePlayerControls(player, els) {
  els.btnPrev.onclick = () => player.prev();
  els.btnNext.onclick = () => player.next();
  els.btnPlay.onclick = () => player.togglePlay();
}
