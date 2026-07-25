// 通用诊断渲染：只展示键值，不理解模式字段。

export function renderDiagnostics(container, diagnostics) {
  if (!container) return;
  container.innerHTML = "";
  const data = diagnostics && typeof diagnostics === "object" ? diagnostics : {};
  const keys = Object.keys(data);
  if (keys.length === 0) {
    container.textContent = "暂无诊断数据";
    return;
  }
  const table = document.createElement("div");
  table.className = "proto-diag-grid";
  for (const key of keys) {
    const row = document.createElement("div");
    row.className = "proto-diag-row";
    const k = document.createElement("span");
    k.className = "proto-diag-key";
    k.textContent = key;
    const v = document.createElement("span");
    v.className = "proto-diag-val";
    const value = data[key];
    v.textContent = value == null ? "-" : String(value);
    row.append(k, v);
    table.append(row);
  }
  container.append(table);
}
