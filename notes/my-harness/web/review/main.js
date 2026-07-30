/**
 * 复习页：平滑锚点滚动（无其它交互逻辑）
 */
document.querySelectorAll('.toc a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href")?.slice(1);
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", "#" + id);
  });
});
