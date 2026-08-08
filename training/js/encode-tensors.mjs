import { encodeRlFrames, serializeRlTensors } from "../../shared/training/tensors.js";

let body = "";
for await (const chunk of process.stdin) body += chunk;
const request = JSON.parse(body);
const tensors = encodeRlFrames(request.frames, {
  limits: request.limits,
  strictOverflow: request.strictOverflow !== false,
});
process.stdout.write(`${JSON.stringify(serializeRlTensors(tensors))}\n`);
