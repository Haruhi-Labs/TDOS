import { RL_ACTION_SCHEMA_VERSION } from "./actions.js";
import { RL_OBSERVATION_SCHEMA_VERSION } from "./observation.js";
import { decodeDeterministicPolicyActions } from "./policy-action.js";
import {
  encodeRlFrames,
  RL_ENCODED_MODEL_INPUT_NAMES,
  RL_MODEL_INPUT_NAMES,
  RL_MODEL_OUTPUT_NAMES,
  RL_TENSOR_SCHEMA_VERSION,
} from "./tensors.js";

function sameList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function validateRlModelMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") throw new TypeError("强化学习模型元数据无效");
  if (metadata.observation_schema_version !== RL_OBSERVATION_SCHEMA_VERSION) {
    throw new RangeError("强化学习模型的观察契约版本不兼容");
  }
  if (metadata.action_schema_version !== RL_ACTION_SCHEMA_VERSION) {
    throw new RangeError("强化学习模型的动作契约版本不兼容");
  }
  if (metadata.tensor_schema_version !== RL_TENSOR_SCHEMA_VERSION) {
    throw new RangeError("强化学习模型的张量契约版本不兼容");
  }
  if (!sameList(metadata.inputs, RL_MODEL_INPUT_NAMES)) {
    throw new RangeError("强化学习模型输入顺序不兼容");
  }
  if (!sameList(metadata.outputs, RL_MODEL_OUTPUT_NAMES)) {
    throw new RangeError("强化学习模型输出顺序不兼容");
  }
  const recurrentDim = Number(metadata.model_config?.recurrent_dim);
  if (!Number.isInteger(recurrentDim) || recurrentDim <= 0) {
    throw new RangeError("强化学习模型循环隐状态维度无效");
  }
  if (!metadata.tensor_limits || typeof metadata.tensor_limits !== "object") {
    throw new RangeError("强化学习模型缺少实体容量配置");
  }
  return metadata;
}

function defaultTensorFactory(type, data, dims) {
  return { type, data, dims };
}

export class BrowserRlPolicy {
  constructor({ session, metadata, tensorFactory = defaultTensorFactory }) {
    if (!session || typeof session.run !== "function") {
      throw new TypeError("浏览器强化学习策略需要有效的推理会话");
    }
    if (typeof tensorFactory !== "function") throw new TypeError("ONNX 张量工厂无效");
    this.session = session;
    this.metadata = validateRlModelMetadata(metadata);
    this.tensorFactory = tensorFactory;
    this.recurrentDim = Number(metadata.model_config.recurrent_dim);
    this.hidden = new Float32Array(this.recurrentDim);
    this.episodeStart = true;
    this.generation = 0;
    this.running = false;
  }

  reset() {
    this.hidden.fill(0);
    this.episodeStart = true;
    this.generation += 1;
  }

  async act(frame) {
    if (this.running) throw new Error("强化学习策略已有一次推理正在进行");
    this.running = true;
    const generation = this.generation;
    try {
      const encoded = encodeRlFrames([frame], { limits: this.metadata.tensor_limits });
      const feeds = {};
      for (const name of RL_ENCODED_MODEL_INPUT_NAMES) {
        const tensor = encoded[name];
        feeds[name] = this.tensorFactory(tensor.type, tensor.data, tensor.dims);
      }
      feeds.hidden = this.tensorFactory("float32", this.hidden.slice(), [1, this.recurrentDim]);
      feeds.episode_start = this.tensorFactory(
        "bool",
        Uint8Array.of(this.episodeStart ? 1 : 0),
        [1],
      );
      const outputs = await this.session.run(feeds);
      if (generation !== this.generation) throw new Error("强化学习回合在推理期间已重置");
      const nextHidden = outputs?.next_hidden;
      if (!nextHidden?.data || nextHidden.data.length !== this.recurrentDim) {
        throw new RangeError("强化学习模型返回的循环隐状态无效");
      }
      const [action] = decodeDeterministicPolicyActions(outputs, encoded);
      this.hidden.set(nextHidden.data);
      this.episodeStart = false;
      return action;
    } finally {
      this.running = false;
    }
  }
}

async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function checkedFetch(fetcher, url, label) {
  const response = await fetcher(url);
  if (!response?.ok) throw new Error(`${label}加载失败：HTTP ${response?.status ?? "unknown"}`);
  return response;
}

/** 只供通过门槛后的候选接入；当前游戏入口不会自动调用该函数。 */
export async function loadBrowserRlPolicy({
  ort,
  modelUrl,
  metadataUrl,
  fetcher = globalThis.fetch,
  sessionOptions = { executionProviders: ["wasm"] },
}) {
  if (!ort?.InferenceSession?.create || typeof ort.Tensor !== "function") {
    throw new TypeError("ONNX Runtime Web 未正确提供");
  }
  if (typeof fetcher !== "function") throw new TypeError("模型加载需要 fetch 实现");
  const metadataResponse = await checkedFetch(fetcher, metadataUrl, "模型元数据");
  const metadata = validateRlModelMetadata(await metadataResponse.json());
  const modelResponse = await checkedFetch(fetcher, modelUrl, "ONNX 模型");
  const model = await modelResponse.arrayBuffer();
  const actualHash = await sha256Hex(model);
  if (actualHash !== String(metadata.onnx_sha256 || "").toLowerCase()) {
    throw new Error("ONNX 模型 SHA-256 校验失败");
  }
  const session = await ort.InferenceSession.create(model, sessionOptions);
  return new BrowserRlPolicy({
    session,
    metadata,
    tensorFactory: (type, data, dims) => new ort.Tensor(type, data, dims),
  });
}
