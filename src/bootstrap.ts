import "./style.css";

function showFallback(detail: string) {
  document.documentElement.dataset.webglFallback = "true";
  const loading = document.querySelector<HTMLElement>("#loading");
  if (loading) {
    loading.classList.add("is-hidden");
    loading.hidden = true;
  }
  const panel = document.querySelector<HTMLElement>("#error-panel");
  const title = document.querySelector<HTMLElement>("#error-title");
  const description = document.querySelector<HTMLElement>("#error-detail");
  if (panel) panel.hidden = false;
  if (title) title.textContent = "当前浏览器无法显示 3D 场景";
  if (description) description.textContent = detail;
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
let webglAvailable = false;
try {
  webglAvailable = Boolean(
    canvas?.getContext("webgl2") ?? canvas?.getContext("webgl"),
  );
} catch {
  webglAvailable = false;
}

if (webglAvailable) {
  import("./main").catch((error: unknown) => {
    console.error("Forest cabin scene failed to initialize.", error);
    showFallback(
      "场景初始化失败。请开启浏览器硬件加速，或使用最新版 Chrome、Edge 或 Safari 后重试。",
    );
  });
} else {
  showFallback(
    "当前设备未提供 WebGL。请开启硬件加速，或使用最新版 Chrome、Edge 或 Safari 后重试。",
  );
}
