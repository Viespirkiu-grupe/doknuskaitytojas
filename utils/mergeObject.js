export function deepMerge(target, source, _visited = new WeakSet()) {
  if (_visited.has(source)) return target;
  _visited.add(source);
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      if (!target[key] || typeof target[key] !== "object") {
        target[key] = {};
      }
      deepMerge(target[key], source[key], _visited);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
