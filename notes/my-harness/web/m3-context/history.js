/**
 * 历史消息编辑器（M3）
 * - 在页面构造 user/assistant/tool 历史
 * - 预设：短对话 / 长填充 / 含工具回合
 *
 * 注意：assistant「仅调工具」时 content 可为 null（协议合法），
 * 页面上用占位说明 + 单独编辑 toolCalls，避免看起来像「空白坏了」。
 */
export function createHistoryEditor({ listEl, countEl, onChange }) {
  /** @type {Array<{ id: string, role: string, content: string|null, toolCalls?: object[], toolCallId?: string, name?: string }>} */
  let items = [];

  function uid() {
    return `h_${Math.random().toString(36).slice(2, 9)}`;
  }

  function emit() {
    countEl.textContent = `共 ${items.length} 条历史`;
    onChange?.(items);
  }

  function render() {
    listEl.replaceChildren();
    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "hist-row";
      if (item.role === "assistant" && item.toolCalls?.length) {
        row.classList.add("has-tools");
      }
      if (item.role === "tool") row.classList.add("is-tool");

      const role = document.createElement("select");
      for (const r of ["user", "assistant", "tool"]) {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        if (r === item.role) opt.selected = true;
        role.append(opt);
      }
      role.onchange = () => {
        item.role = role.value;
        if (item.role !== "assistant") delete item.toolCalls;
        if (item.role !== "tool") {
          delete item.toolCallId;
          delete item.name;
        }
        if (item.role === "tool" && !item.toolCallId) {
          item.toolCallId = `call_${uid()}`;
          item.name = item.name || "add";
        }
        render();
        emit();
      };

      const main = document.createElement("div");
      main.className = "hist-main";

      const badge = document.createElement("div");
      badge.className = "hist-badge";
      if (item.role === "assistant" && item.toolCalls?.length) {
        badge.textContent = `#${index + 1} · assistant 仅工具调用（content=null 是正常的）`;
        badge.classList.add("warn");
      } else if (item.role === "tool") {
        badge.textContent = `#${index + 1} · tool 结果回写 · id=${item.toolCallId || "?"} · name=${item.name || "?"}`;
      } else {
        badge.textContent = `#${index + 1} · ${item.role}`;
      }
      main.append(badge);

      // tool 角色：可编辑 toolCallId / name
      if (item.role === "tool") {
        const ids = document.createElement("div");
        ids.className = "hist-ids";
        const idInput = document.createElement("input");
        idInput.type = "text";
        idInput.placeholder = "toolCallId";
        idInput.value = item.toolCallId || "";
        idInput.oninput = () => {
          item.toolCallId = idInput.value;
          emit();
        };
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.placeholder = "name";
        nameInput.value = item.name || "";
        nameInput.oninput = () => {
          item.name = nameInput.value;
          emit();
        };
        ids.append(idInput, nameInput);
        main.append(ids);
      }

      const ta = document.createElement("textarea");
      const isToolOnly =
        item.role === "assistant" &&
        (item.content == null || item.content === "") &&
        item.toolCalls?.length;
      ta.value = item.content ?? "";
      ta.placeholder = isToolOnly
        ? "（可留空）本轮无面向用户的文本；真正内容在下方 toolCalls"
        : item.role === "tool"
          ? '工具结果 JSON，如 {"sum":8}'
          : "消息正文";
      if (isToolOnly) ta.classList.add("is-empty-ok");
      ta.oninput = () => {
        const v = ta.value;
        // 空串对「仅工具」assistant 存成 null，贴近真实协议
        item.content =
          item.role === "assistant" && item.toolCalls?.length && v.trim() === ""
            ? null
            : v;
        emit();
      };
      main.append(ta);

      // assistant：单独编辑 toolCalls JSON（含工具回合的核心）
      if (item.role === "assistant") {
        const label = document.createElement("div");
        label.className = "hist-sublabel";
        label.textContent = "toolCalls（JSON 数组；仅调工具时 content 可为空）";
        const tc = document.createElement("textarea");
        tc.className = "hist-toolcalls";
        tc.value = item.toolCalls?.length
          ? JSON.stringify(item.toolCalls, null, 2)
          : "";
        tc.placeholder =
          '例如 [{"id":"call_1","name":"add","arguments":{"a":1,"b":2}}]';
        tc.oninput = () => {
          const raw = tc.value.trim();
          if (!raw) {
            delete item.toolCalls;
            render();
            emit();
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              item.toolCalls = parsed;
              tc.classList.remove("is-bad");
            } else {
              tc.classList.add("is-bad");
            }
          } catch {
            tc.classList.add("is-bad");
          }
          emit();
        };
        main.append(label, tc);
      }

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "secondary rm";
      rm.textContent = "删";
      rm.onclick = () => {
        items = items.filter((x) => x.id !== item.id);
        render();
        emit();
      };

      row.append(role, main, rm);
      listEl.append(row);
    });
    emit();
  }

  function setItems(next) {
    items = next.map((m) => ({ id: uid(), ...m }));
    render();
  }

  function add(role, content = "") {
    const row = { id: uid(), role, content };
    if (role === "tool") {
      row.toolCallId = `call_${uid()}`;
      row.name = "add";
      row.content = JSON.stringify({ ok: true });
    }
    items.push(row);
    render();
  }

  function toPayload() {
    return items.map(({ role, content, toolCalls, toolCallId, name }) => {
      const m = { role, content };
      if (toolCalls?.length) m.toolCalls = toolCalls;
      if (toolCallId) m.toolCallId = toolCallId;
      if (name) m.name = name;
      return m;
    });
  }

  const presets = {
    short3() {
      setItems([
        { role: "user", content: "你好，我想了解 Context 是什么。" },
        {
          role: "assistant",
          content: "Context 是发给模型的消息窗口，包括 system、历史、工具结果等。",
        },
        { role: "user", content: "那和完整轨迹有什么区别？" },
        {
          role: "assistant",
          content: "Harness 可保留完整轨迹做审计，但发给模型的可以是裁剪后的视图。",
        },
        { role: "user", content: "有哪些常见裁剪策略？" },
        {
          role: "assistant",
          content: "例如保留最近 N 条，或按字符/ token 预算从尾部截断。",
        },
      ]);
    },
    long6() {
      const next = [];
      for (let i = 1; i <= 6; i++) {
        next.push({
          role: "user",
          content: `【历史 #${i}】这是一段故意写长的填充问题，用来撑开 Context 字符数。请忽略具体语义。重复：上下文工程关注发给模型的视图。`.repeat(
            2,
          ),
        });
        next.push({
          role: "assistant",
          content: `【回答 #${i}】这是填充回复。Harness 内存可留全量，assembleContext 再裁剪。不含密钥与工具源码。`.repeat(
            2,
          ),
        });
      }
      setItems(next);
    },
    tools() {
      // 模拟真实 FC 轨迹：assistant content=null + toolCalls → tool 回写 → 最终文本
      setItems([
        { role: "user", content: "深圳天气怎么样？再算 3+5。" },
        {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_weather_demo",
              name: "get_weather",
              arguments: { city: "深圳" },
            },
          ],
        },
        {
          role: "tool",
          name: "get_weather",
          toolCallId: "call_weather_demo",
          content: JSON.stringify(
            {
              city: "深圳",
              temp_c: 33,
              condition: "雷阵雨",
              source: "history-preset",
            },
            null,
            2,
          ),
        },
        {
          role: "assistant",
          content: null,
          toolCalls: [
            { id: "call_add_demo", name: "add", arguments: { a: 3, b: 5 } },
          ],
        },
        {
          role: "tool",
          name: "add",
          toolCallId: "call_add_demo",
          content: JSON.stringify({ a: 3, b: 5, sum: 8 }, null, 2),
        },
        {
          role: "assistant",
          content: "深圳雷阵雨约 33℃；3+5=8。",
        },
      ]);
    },
    clear() {
      setItems([]);
    },
  };

  // 默认加载短对话，便于立刻看到裁剪效果
  presets.short3();

  return { add, setItems, toPayload, presets, render };
}
