/** 主题色应用：将系统设置中的 hex 主题色注入全局 CSS 变量（primary / ring / sidebar 系 / chart-1 / Arco 系列变量） */

const STYLE_ID = 'app-theme-style';

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = m[1];
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hNorm = h / 360;
  const sNorm = s / 100;
  const lNorm = l / 100;
  if (sNorm === 0) {
    const val = Math.round(lNorm * 255);
    return [val, val, val];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tVal = t;
    if (tVal < 0) tVal += 1;
    if (tVal > 1) tVal -= 1;
    if (tVal < 1 / 6) return p + (q - p) * 6 * tVal;
    if (tVal < 1 / 2) return q;
    if (tVal < 2 / 3) return p + (q - p) * (2 / 3 - tVal) * 6;
    return p;
  };
  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
  const p = 2 * lNorm - q;
  const r = hue2rgb(p, q, hNorm + 1 / 3);
  const g = hue2rgb(p, q, hNorm);
  const b = hue2rgb(p, q, hNorm - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** 生成 1~10 阶亮度（6 阶为基准色，1~5 渐亮、7~10 渐暗），用于 Arco RGB 色板变量 */
function lightnessLevels(baseL: number): number[] {
  return [
    Math.min(95, baseL + (100 - baseL) * 0.88), // 1
    Math.min(90, baseL + (100 - baseL) * 0.72), // 2
    Math.min(84, baseL + (100 - baseL) * 0.54), // 3
    Math.min(76, baseL + (100 - baseL) * 0.36), // 4
    Math.min(68, baseL + (100 - baseL) * 0.18), // 5
    baseL, // 6 (基准)
    Math.max(10, baseL * 0.85), // 7
    Math.max(8, baseL * 0.7), // 8
    Math.max(6, baseL * 0.55), // 9
    Math.max(4, baseL * 0.4), // 10
  ];
}

/** 生成 Arco 色板 RGB 变量串（primary 与 link 同步主题色） */
function arcoScaleVars(h: number, s: number, levels: number[]): string {
  return levels
    .map((lvl, idx) => {
      const [r, g, b] = hslToRgb(h, s, lvl);
      return `--primary-${idx + 1}:${r},${g},${b};--link-${idx + 1}:${r},${g},${b};`;
    })
    .join('');
}

/** 应用主题色（传空值则移除，回退 CSS 默认主题） */
export function applyTheme(hex?: string | null) {
  const style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!hex) {
    style?.remove();
    return;
  }
  const c = hexToHsl(hex);
  if (!c) return;
  const { h, s, l } = c;
  const ringL = Math.min(l + 8, 60);
  const darkS = Math.max(s - 10, 20);
  const darkL = 62;

  // Arco 原生组件（text/outline 按钮、链接、分页选中态等）直接消费 --primary-N / --link-N RGB 变量；
  // arco.css 将其定义在 body 上（覆盖 :root 继承值），因此注入时必须同时命中 :root 与 body，
  // 且本 style 元素位于 head 末尾（晚于 arco.css 加载），同优先级下后者生效
  const lightVars = arcoScaleVars(h, s, lightnessLevels(l));
  const darkVars = arcoScaleVars(h, darkS, lightnessLevels(darkL));

  const css = `:root,body{--primary:${h} ${s}% ${l}%;--ring:${h} ${s}% ${ringL}%;--sidebar-primary:${h} ${s}% ${l}%;--sidebar-ring:${h} ${s}% ${ringL}%;--chart-1:${h} ${s}% ${l}%;${lightVars}}
.dark,.dark body{--primary:${h} ${darkS}% ${darkL}%;--ring:${h} ${darkS}% 70%;--sidebar-primary:${h} ${darkS}% ${darkL}%;--sidebar-ring:${h} ${darkS}% 70%;--chart-1:${h} ${darkS}% ${darkL}%;${darkVars}}`;
  const el = style ?? document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  if (!style) document.head.appendChild(el);
}
