// 将 ONNX 策略输出按训练评测相同的规则确定性解码为通用舰队动作。

function requireTensor(tensors, name) {
  const tensor = tensors?.[name];
  if (!tensor?.data || !Array.isArray(tensor.dims)) {
    throw new TypeError(`缺少策略张量：${name}`);
  }
  return tensor;
}

function maskedArgmax(logits, logitsOffset, count, mask, maskOffset = 0) {
  let selected = -1;
  let selectedValue = -Infinity;
  for (let index = 0; index < count; index += 1) {
    if (mask && !mask[maskOffset + index]) continue;
    const value = Number(logits[logitsOffset + index]);
    if (selected < 0 || value > selectedValue) {
      selected = index;
      selectedValue = value;
    }
  }
  return selected < 0 ? 0 : selected;
}

function binaryArgmax(logits, offset, trueAllowed) {
  return trueAllowed && Number(logits[offset + 1]) > Number(logits[offset]) ? 1 : 0;
}

function squashed(value) {
  return Math.fround(Math.tanh(Number(value)));
}

function shipCount(mask, batchIndex, capacity) {
  let count = 0;
  const offset = batchIndex * capacity;
  for (let index = 0; index < capacity; index += 1) count += mask[offset + index] ? 1 : 0;
  return count;
}

/**
 * 返回与 Python actions_to_seat_payloads 完全相同的席位动作数组。
 * 客户端候选采用确定性动作，避免不同浏览器随机数实现造成回放分歧。
 */
export function decodeDeterministicPolicyActions(outputs, tensors) {
  const ownShips = requireTensor(tensors, "own_ships_mask");
  const [batch, shipCapacity] = ownShips.dims;
  if (!Number.isInteger(batch) || !Number.isInteger(shipCapacity)) {
    throw new TypeError("己方舰船掩码维度无效");
  }

  const navigationLogits = requireTensor(outputs, "ship_navigation_logits").data;
  const setGearLogits = requireTensor(outputs, "ship_set_gear_logits").data;
  const gearLogits = requireTensor(outputs, "ship_gear_logits").data;
  const brakeLogits = requireTensor(outputs, "ship_brake_logits").data;
  const subskillLogits = requireTensor(outputs, "ship_subskill_logits").data;
  const subzoneLogits = requireTensor(outputs, "ship_subzone_logits").data;
  const shipContinuous = requireTensor(outputs, "ship_continuous_mean").data;
  const splitLogits = requireTensor(outputs, "split_logits").data;
  const scoutLaunchLogits = requireTensor(outputs, "scout_launch_logits").data;
  const scoutSourceLogits = requireTensor(outputs, "scout_source_logits").data;
  const scoutZoneLogits = requireTensor(outputs, "scout_zone_logits").data;
  const flagshipLogits = requireTensor(outputs, "flagship_logits").data;
  const flagshipZoneLogits = requireTensor(outputs, "flagship_zone_logits").data;
  const flagshipContinuous = requireTensor(outputs, "flagship_continuous_mean").data;

  const navigationMask = requireTensor(tensors, "action_navigation_mask").data;
  const gearMask = requireTensor(tensors, "action_gear_mask").data;
  const shipFlags = requireTensor(tensors, "action_ship_flags").data;
  const splitMask = requireTensor(tensors, "action_split_mask").data;
  const scoutLaunchMask = requireTensor(tensors, "action_scout_launch").data;
  const scoutSourceMask = requireTensor(tensors, "action_scout_source_mask").data;
  const scoutZoneMask = requireTensor(tensors, "action_scout_zone_mask").data;
  const flagshipMask = requireTensor(tensors, "action_flagship").data;

  const seats = [];
  for (let sample = 0; sample < batch; sample += 1) {
    const ships = [];
    const count = shipCount(ownShips.data, sample, shipCapacity);
    for (let ship = 0; ship < count; ship += 1) {
      const entity = sample * shipCapacity + ship;
      const navigation = maskedArgmax(
        navigationLogits,
        entity * 3,
        3,
        navigationMask,
        entity * 3,
      );
      const flagOffset = entity * 5;
      const continuousOffset = entity * 6;
      ships.push({
        navigation,
        setGear: Boolean(binaryArgmax(setGearLogits, entity * 2, shipFlags[flagOffset])),
        gear: maskedArgmax(gearLogits, entity * 5, 5, gearMask, entity * 5),
        end: {
          x: squashed(shipContinuous[continuousOffset]),
          y: squashed(shipContinuous[continuousOffset + 1]),
        },
        control: {
          x: squashed(shipContinuous[continuousOffset + 2]),
          y: squashed(shipContinuous[continuousOffset + 3]),
        },
        emergencyBrake: Boolean(binaryArgmax(
          brakeLogits,
          entity * 2,
          shipFlags[flagOffset + 1],
        )),
        castSubSkill: Boolean(binaryArgmax(
          subskillLogits,
          entity * 2,
          shipFlags[flagOffset + 2],
        )),
        skillZone: maskedArgmax(subzoneLogits, entity * 9, 9) + 1,
        skillTarget: {
          x: squashed(shipContinuous[continuousOffset + 4]),
          y: squashed(shipContinuous[continuousOffset + 5]),
        },
      });
    }

    seats.push({
      ships,
      split: maskedArgmax(splitLogits, sample * 3, 3, splitMask, sample * 3),
      scout: {
        launch: Boolean(binaryArgmax(
          scoutLaunchLogits,
          sample * 2,
          scoutLaunchMask[sample],
        )),
        sourceShip: maskedArgmax(
          scoutSourceLogits,
          sample * shipCapacity,
          shipCapacity,
          scoutSourceMask,
          sample * shipCapacity,
        ),
        zone: maskedArgmax(scoutZoneLogits, sample * 9, 9, scoutZoneMask, sample * 9) + 1,
      },
      flagshipSkill: {
        cast: Boolean(binaryArgmax(flagshipLogits, sample * 2, flagshipMask[sample])),
        zone: maskedArgmax(flagshipZoneLogits, sample * 9, 9) + 1,
        target: {
          x: squashed(flagshipContinuous[sample * 2]),
          y: squashed(flagshipContinuous[sample * 2 + 1]),
        },
      },
    });
  }
  return seats;
}
