// 根据 parameterSchema 自动生成表单；不含任何 modeId 专属分支。

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value != null) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function renderParameterPanel(container, schema, values, onChange) {
  if (!container) return;
  container.innerHTML = "";
  const list = Array.isArray(schema) ? schema : [];
  if (list.length === 0) {
    container.append(el("div", { className: "proto-muted", text: "当前模式无可调参数" }));
    return;
  }

  for (const field of list) {
    const row = el("label", { className: "proto-field" });
    row.append(el("span", { className: "proto-field-label", text: field.label || field.key }));
    if (field.description) {
      row.append(el("span", { className: "proto-field-desc", text: field.description }));
    }

    const current = values?.[field.key];
    let input;
    if (field.type === "boolean") {
      input = el("input", { type: "checkbox" });
      input.checked = Boolean(current);
      input.addEventListener("change", () => onChange?.(field.key, input.checked));
    } else if (field.type === "select") {
      input = el("select");
      for (const option of field.options || []) {
        const value = typeof option === "object" ? option.value : option;
        const label = typeof option === "object" ? option.label : String(option);
        const opt = el("option", { value: String(value), text: label });
        if (String(value) === String(current)) opt.selected = true;
        input.append(opt);
      }
      input.addEventListener("change", () => onChange?.(field.key, input.value));
    } else {
      input = el("input", {
        type: "number",
        value: current == null ? "" : String(current),
      });
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      if (field.step != null) input.step = String(field.step);
      input.addEventListener("change", () => onChange?.(field.key, Number(input.value)));
    }
    input.dataset.paramKey = field.key;
    row.append(input);
    container.append(row);
  }
}

export function readParameterPanel(container) {
  if (!container) return {};
  const out = {};
  for (const input of container.querySelectorAll("[data-param-key]")) {
    const key = input.dataset.paramKey;
    if (input.type === "checkbox") out[key] = input.checked;
    else if (input.type === "number") out[key] = Number(input.value);
    else out[key] = input.value;
  }
  return out;
}
