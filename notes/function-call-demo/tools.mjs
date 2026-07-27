/**
 * 共享：本地假工具 + 通用日志
 * 真实项目里这里会换成查库 / 调 API / 跑脚本。
 */

export const toolsImpl = {
  get_weather: async ({ city }) => {
    // 假数据，只为演示「执行 → 回灌」
    const table = {
      北京: { temp_c: 28, condition: "晴" },
      上海: { temp_c: 31, condition: "多云" },
      深圳: { temp_c: 33, condition: "雷阵雨" },
    };
    const hit = table[city] ?? { temp_c: 26, condition: "未知城市（演示默认值）" };
    return { city, ...hit, source: "local-mock" };
  },

  add: async ({ a, b }) => ({ a, b, sum: a + b }),
};

export async function runTool(name, args) {
  const fn = toolsImpl[name];
  if (!fn) {
    return { error: `unknown tool: ${name}` };
  }
  return fn(args);
}

export function logSection(title) {
  console.log(`\n========== ${title} ==========`);
}

export function logJson(label, obj) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(obj, null, 2));
}
