import { decodeDeterministicPolicyActions } from "../../shared/training/policy-action.js";

let body = "";
for await (const chunk of process.stdin) body += chunk;
const request = JSON.parse(body);
process.stdout.write(`${JSON.stringify(
  decodeDeterministicPolicyActions(request.outputs, request.tensors),
)}\n`);
