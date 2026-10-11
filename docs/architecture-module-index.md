# 架构模块索引

源码基线 `221c077`（生成时工作树）。共 229 个 JavaScript 模块，范围为 `shared/game`、`shared/protocol`、`shared/data`、`server`、`src`，另含稳定导出和快照差量。样式、素材、测试、发布脚本不在此索引中。

运行 `node scripts/generate-architecture-index.mjs` 更新。本表按相对静态 import/export 引用生成；出边为不同本地 JS 模块，入边仅统计本表范围。行数与引用数量不衡量架构质量，状态持有和实际消费见 [架构地图](architecture-map.md)。

## `server`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [config.js](../server/config.js) | 47 | 1 | 6 |
| [game-identity.js](../server/game-identity.js) | 117 | 0 | 1 |
| [input-queue.js](../server/input-queue.js) | 93 | 1 | 1 |
| [match-runtime.js](../server/match-runtime.js) | 89 | 4 | 1 |
| [protocol.js](../server/protocol.js) | 66 | 0 | 2 |
| [room-lifecycle.js](../server/room-lifecycle.js) | 310 | 4 | 1 |
| [room-registry.js](../server/room-registry.js) | 304 | 4 | 1 |
| [room-state.js](../server/room-state.js) | 4 | 0 | 2 |
| [room.js](../server/room.js) | 116 | 2 | 1 |
| [server.js](../server/server.js) | 731 | 17 | 0 |
| [snapshot-stream.js](../server/snapshot-stream.js) | 247 | 4 | 1 |
| [statistics-records.js](../server/statistics-records.js) | 101 | 4 | 1 |
| [statistics-store.js](../server/statistics-store.js) | 412 | 3 | 2 |

## `shared`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [game-core.js](../shared/game-core.js) | 46 | 8 | 3 |
| [network-patch.js](../shared/network-patch.js) | 243 | 0 | 3 |

## `shared/data`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [plain-data.js](../shared/data/plain-data.js) | 26 | 0 | 21 |
| [readonly-id-set.js](../shared/data/readonly-id-set.js) | 14 | 0 | 4 |

## `shared/game`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [action-dispatcher.js](../shared/game/action-dispatcher.js) | 90 | 1 | 2 |
| [bot-controller.js](../shared/game/bot-controller.js) | 55 | 1 | 2 |
| [bunny-companion-runtime.js](../shared/game/bunny-companion-runtime.js) | 198 | 2 | 8 |
| [bunny-haruhi-companion.js](../shared/game/bunny-haruhi-companion.js) | 146 | 1 | 3 |
| [bunny-haruhi-config.js](../shared/game/bunny-haruhi-config.js) | 55 | 0 | 12 |
| [bunny-haruhi-runtime.js](../shared/game/bunny-haruhi-runtime.js) | 272 | 8 | 9 |
| [bunny-haruhi-support.js](../shared/game/bunny-haruhi-support.js) | 42 | 2 | 5 |
| [bunny-haruhi-view-params.js](../shared/game/bunny-haruhi-view-params.js) | 28 | 2 | 4 |
| [bunny-haruhi.js](../shared/game/bunny-haruhi.js) | 273 | 3 | 4 |
| [character-contacts.js](../shared/game/character-contacts.js) | 131 | 9 | 1 |
| [characters.js](../shared/game/characters.js) | 279 | 2 | 30 |
| [collision-system.js](../shared/game/collision-system.js) | 52 | 1 | 3 |
| [combat-rules.js](../shared/game/combat-rules.js) | 33 | 0 | 15 |
| [constants.js](../shared/game/constants.js) | 9 | 0 | 21 |
| [contact-geometry.js](../shared/game/contact-geometry.js) | 77 | 1 | 3 |
| [damage.js](../shared/game/damage.js) | 26 | 0 | 7 |
| [fixed-step-clock.js](../shared/game/fixed-step-clock.js) | 49 | 1 | 2 |
| [future-flagship-form.js](../shared/game/future-flagship-form.js) | 44 | 0 | 3 |
| [haruhi-flagship-runtime.js](../shared/game/haruhi-flagship-runtime.js) | 38 | 1 | 1 |
| [haruhi-flagship.js](../shared/game/haruhi-flagship.js) | 118 | 2 | 13 |
| [haruhi-hero-power.js](../shared/game/haruhi-hero-power.js) | 203 | 1 | 5 |
| [haruhi-support.js](../shared/game/haruhi-support.js) | 156 | 2 | 11 |
| [koizumi-barrier.js](../shared/game/koizumi-barrier.js) | 366 | 1 | 8 |
| [koizumi-orb.js](../shared/game/koizumi-orb.js) | 395 | 2 | 8 |
| [match-telemetry.js](../shared/game/match-telemetry.js) | 97 | 1 | 1 |
| [math.js](../shared/game/math.js) | 139 | 1 | 58 |
| [rng.js](../shared/game/rng.js) | 55 | 0 | 13 |
| [shamisen-claw.js](../shared/game/shamisen-claw.js) | 78 | 1 | 2 |
| [shamisen-hunt.js](../shared/game/shamisen-hunt.js) | 90 | 1 | 8 |
| [sponsor-effect.js](../shared/game/sponsor-effect.js) | 29 | 0 | 1 |
| [status-effect-definitions.js](../shared/game/status-effect-definitions.js) | 50 | 0 | 3 |
| [status-effects.js](../shared/game/status-effects.js) | 111 | 9 | 2 |
| [targeting-system.js](../shared/game/targeting-system.js) | 92 | 0 | 1 |
| [throttle.js](../shared/game/throttle.js) | 53 | 0 | 12 |
| [visibility-radar.js](../shared/game/visibility-radar.js) | 128 | 3 | 4 |
| [vision-wave-purge.js](../shared/game/vision-wave-purge.js) | 18 | 0 | 1 |
| [vision-wave.js](../shared/game/vision-wave.js) | 123 | 2 | 5 |

## `shared/game/ai`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [actions.js](../shared/game/ai/actions.js) | 58 | 1 | 2 |

## `shared/game/ai/bridge`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [action-port.js](../shared/game/ai/bridge/action-port.js) | 89 | 4 | 1 |
| [observation.js](../shared/game/ai/bridge/observation.js) | 336 | 6 | 1 |
| [runner.js](../shared/game/ai/bridge/runner.js) | 16 | 2 | 1 |

## `shared/game/ai/params`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [default.js](../shared/game/ai/params/default.js) | 719 | 0 | 1 |
| [difficulty.js](../shared/game/ai/params/difficulty.js) | 48 | 0 | 1 |
| [index.js](../shared/game/ai/params/index.js) | 70 | 3 | 2 |
| [presets.js](../shared/game/ai/params/presets.js) | 16 | 0 | 1 |

## `shared/game/ai/policy`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [belief.js](../shared/game/ai/policy/belief.js) | 194 | 1 | 1 |
| [commands.js](../shared/game/ai/policy/commands.js) | 38 | 1 | 1 |
| [context.js](../shared/game/ai/policy/context.js) | 252 | 3 | 1 |
| [debug-state.js](../shared/game/ai/policy/debug-state.js) | 264 | 1 | 1 |
| [detached.js](../shared/game/ai/policy/detached.js) | 383 | 3 | 1 |
| [energy.js](../shared/game/ai/policy/energy.js) | 97 | 1 | 1 |
| [evaluation.js](../shared/game/ai/policy/evaluation.js) | 298 | 2 | 1 |
| [geometry.js](../shared/game/ai/policy/geometry.js) | 56 | 2 | 1 |
| [intel-tracker.js](../shared/game/ai/policy/intel-tracker.js) | 456 | 4 | 1 |
| [mode.js](../shared/game/ai/policy/mode.js) | 189 | 0 | 1 |
| [movement.js](../shared/game/ai/policy/movement.js) | 545 | 5 | 1 |
| [observation-view.js](../shared/game/ai/policy/observation-view.js) | 22 | 1 | 1 |
| [policy-program.js](../shared/game/ai/policy/policy-program.js) | 95 | 14 | 1 |
| [rule-policy.js](../shared/game/ai/policy/rule-policy.js) | 537 | 11 | 1 |
| [scout.js](../shared/game/ai/policy/scout.js) | 119 | 3 | 1 |
| [search-navigation.js](../shared/game/ai/policy/search-navigation.js) | 75 | 2 | 1 |
| [skill-decision-cycle.js](../shared/game/ai/policy/skill-decision-cycle.js) | 122 | 2 | 1 |
| [skills.js](../shared/game/ai/policy/skills.js) | 137 | 5 | 1 |
| [split.js](../shared/game/ai/policy/split.js) | 123 | 3 | 1 |
| [targets.js](../shared/game/ai/policy/targets.js) | 360 | 1 | 1 |
| [view.js](../shared/game/ai/policy/view.js) | 39 | 1 | 1 |

## `shared/game/ai/policy/characters`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [asakura.js](../shared/game/ai/policy/characters/asakura.js) | 62 | 0 | 1 |
| [bunny-haruhi.js](../shared/game/ai/policy/characters/bunny-haruhi.js) | 9 | 1 | 1 |
| [decision-view.js](../shared/game/ai/policy/characters/decision-view.js) | 10 | 1 | 2 |
| [future1096.js](../shared/game/ai/policy/characters/future1096.js) | 59 | 1 | 1 |
| [haruhi.js](../shared/game/ai/policy/characters/haruhi.js) | 44 | 1 | 1 |
| [index.js](../shared/game/ai/policy/characters/index.js) | 32 | 10 | 4 |
| [koizumi.js](../shared/game/ai/policy/characters/koizumi.js) | 26 | 0 | 1 |
| [kyon.js](../shared/game/ai/policy/characters/kyon.js) | 9 | 0 | 1 |
| [shamisen.js](../shared/game/ai/policy/characters/shamisen.js) | 19 | 0 | 1 |
| [tsuruya.js](../shared/game/ai/policy/characters/tsuruya.js) | 21 | 0 | 1 |
| [yuki.js](../shared/game/ai/policy/characters/yuki.js) | 11 | 0 | 1 |

## `shared/game/ai/policy/tactics`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [bunny-stage.js](../shared/game/ai/policy/tactics/bunny-stage.js) | 56 | 2 | 2 |
| [character-counterplay.js](../shared/game/ai/policy/tactics/character-counterplay.js) | 521 | 2 | 5 |
| [shamisen-hunt.js](../shared/game/ai/policy/tactics/shamisen-hunt.js) | 324 | 1 | 3 |
| [yuki-scout.js](../shared/game/ai/policy/tactics/yuki-scout.js) | 378 | 2 | 1 |

## `shared/game/model`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [burst.js](../shared/game/model/burst.js) | 31 | 1 | 1 |
| [floating-text.js](../shared/game/model/floating-text.js) | 47 | 2 | 1 |
| [model-support.js](../shared/game/model/model-support.js) | 115 | 2 | 15 |
| [projectile.js](../shared/game/model/projectile.js) | 143 | 4 | 1 |
| [scout.js](../shared/game/model/scout.js) | 315 | 3 | 1 |
| [ship.js](../shared/game/model/ship.js) | 554 | 14 | 1 |
| [team.js](../shared/game/model/team.js) | 479 | 21 | 1 |
| [wingman.js](../shared/game/model/wingman.js) | 189 | 2 | 1 |

## `shared/game/rules`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [active-skills.js](../shared/game/rules/active-skills.js) | 54 | 0 | 1 |
| [aircraft-port.js](../shared/game/rules/aircraft-port.js) | 32 | 3 | 1 |
| [attribute-evaluation.js](../shared/game/rules/attribute-evaluation.js) | 65 | 6 | 1 |
| [attribute-facts.js](../shared/game/rules/attribute-facts.js) | 58 | 4 | 1 |
| [beam-port.js](../shared/game/rules/beam-port.js) | 55 | 4 | 1 |
| [character-assembly.js](../shared/game/rules/character-assembly.js) | 16 | 6 | 2 |
| [character-battle.js](../shared/game/rules/character-battle.js) | 66 | 10 | 1 |
| [character-rules.js](../shared/game/rules/character-rules.js) | 155 | 14 | 1 |
| [character-team.js](../shared/game/rules/character-team.js) | 63 | 12 | 1 |
| [collision-port.js](../shared/game/rules/collision-port.js) | 21 | 0 | 1 |
| [fire-control.js](../shared/game/rules/fire-control.js) | 54 | 1 | 1 |
| [formation-port.js](../shared/game/rules/formation-port.js) | 34 | 0 | 1 |
| [future-form-port.js](../shared/game/rules/future-form-port.js) | 15 | 1 | 1 |
| [haruhi-flagship-port.js](../shared/game/rules/haruhi-flagship-port.js) | 26 | 4 | 1 |
| [hero-power-runtime.js](../shared/game/rules/hero-power-runtime.js) | 25 | 2 | 1 |
| [match-feedback.js](../shared/game/rules/match-feedback.js) | 55 | 2 | 1 |
| [navigation-port.js](../shared/game/rules/navigation-port.js) | 42 | 0 | 1 |
| [projectile-phase.js](../shared/game/rules/projectile-phase.js) | 53 | 5 | 1 |
| [ship-combat-port.js](../shared/game/rules/ship-combat-port.js) | 50 | 4 | 1 |
| [ship-destruction.js](../shared/game/rules/ship-destruction.js) | 13 | 2 | 1 |
| [ship-effects.js](../shared/game/rules/ship-effects.js) | 76 | 8 | 1 |
| [ship-projection.js](../shared/game/rules/ship-projection.js) | 76 | 6 | 1 |
| [sponsor-port.js](../shared/game/rules/sponsor-port.js) | 18 | 1 | 1 |
| [support-conversion.js](../shared/game/rules/support-conversion.js) | 37 | 3 | 1 |
| [team-projection.js](../shared/game/rules/team-projection.js) | 50 | 7 | 1 |
| [team-skill-port.js](../shared/game/rules/team-skill-port.js) | 59 | 5 | 1 |
| [vision-wave-port.js](../shared/game/rules/vision-wave-port.js) | 34 | 1 | 1 |

## `shared/game/runtime`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [match-simulation.js](../shared/game/runtime/match-simulation.js) | 450 | 21 | 2 |

## `shared/game/systems`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [aircraft-operations.js](../shared/game/systems/aircraft-operations.js) | 177 | 1 | 1 |
| [beam-system.js](../shared/game/systems/beam-system.js) | 121 | 1 | 1 |
| [expanding-wave.js](../shared/game/systems/expanding-wave.js) | 50 | 1 | 2 |
| [fleet-formation.js](../shared/game/systems/fleet-formation.js) | 181 | 0 | 1 |
| [fleet-roster.js](../shared/game/systems/fleet-roster.js) | 33 | 0 | 1 |
| [hull-damage.js](../shared/game/systems/hull-damage.js) | 25 | 1 | 1 |
| [projectile-system.js](../shared/game/systems/projectile-system.js) | 7 | 0 | 1 |
| [ship-navigation.js](../shared/game/systems/ship-navigation.js) | 366 | 3 | 1 |
| [ship-status.js](../shared/game/systems/ship-status.js) | 30 | 0 | 1 |
| [skill-cycle.js](../shared/game/systems/skill-cycle.js) | 54 | 0 | 1 |
| [visibility.js](../shared/game/systems/visibility.js) | 32 | 1 | 1 |
| [weapon-cycle.js](../shared/game/systems/weapon-cycle.js) | 30 | 1 | 1 |

## `shared/protocol`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [match-actions.js](../shared/protocol/match-actions.js) | 79 | 0 | 5 |
| [ruleset-version.js](../shared/protocol/ruleset-version.js) | 20 | 0 | 5 |

## `src`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [auth-callback.js](../src/auth-callback.js) | 42 | 1 | 1 |
| [changelog.js](../src/changelog.js) | 106 | 4 | 0 |
| [character-presentation.js](../src/character-presentation.js) | 33 | 2 | 6 |
| [character-select.js](../src/character-select.js) | 1419 | 6 | 2 |
| [confirm-dialog.js](../src/confirm-dialog.js) | 73 | 0 | 2 |
| [credits.js](../src/credits.js) | 91 | 3 | 1 |
| [debug.js](../src/debug.js) | 1991 | 10 | 0 |
| [deployment.js](../src/deployment.js) | 4 | 0 | 7 |
| [guide.js](../src/guide.js) | 122 | 3 | 1 |
| [i18n.js](../src/i18n.js) | 270 | 3 | 33 |
| [identity.js](../src/identity.js) | 238 | 1 | 5 |
| [interaction-feedback.js](../src/interaction-feedback.js) | 79 | 0 | 1 |
| [main.js](../src/main.js) | 61 | 9 | 0 |
| [menu-hero.js](../src/menu-hero.js) | 188 | 0 | 2 |
| [menu.js](../src/menu.js) | 276 | 7 | 1 |
| [mobile.js](../src/mobile.js) | 33 | 0 | 8 |
| [online.js](../src/online.js) | 2207 | 35 | 0 |
| [profile-view.js](../src/profile-view.js) | 194 | 6 | 1 |
| [profile.js](../src/profile.js) | 214 | 2 | 8 |
| [router.js](../src/router.js) | 121 | 1 | 1 |
| [ship-destruction-effects.js](../src/ship-destruction-effects.js) | 129 | 0 | 5 |
| [solo-setup.js](../src/solo-setup.js) | 166 | 5 | 1 |
| [solo.js](../src/solo.js) | 1579 | 28 | 0 |
| [starfield.js](../src/starfield.js) | 57 | 0 | 8 |
| [statistics-client.js](../src/statistics-client.js) | 119 | 5 | 3 |
| [statistics.js](../src/statistics.js) | 227 | 6 | 0 |
| [tutorial.js](../src/tutorial.js) | 516 | 2 | 1 |

## `src/battle`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [action-transport.js](../src/battle/action-transport.js) | 44 | 1 | 2 |
| [bunny-haruhi-view.js](../src/battle/bunny-haruhi-view.js) | 92 | 5 | 3 |
| [camera.js](../src/battle/camera.js) | 252 | 4 | 2 |
| [canvas-resolution.js](../src/battle/canvas-resolution.js) | 43 | 1 | 1 |
| [command-panel.js](../src/battle/command-panel.js) | 109 | 5 | 1 |
| [cooldown-progress.js](../src/battle/cooldown-progress.js) | 121 | 0 | 1 |
| [director-camera.js](../src/battle/director-camera.js) | 107 | 2 | 2 |
| [hud.js](../src/battle/hud.js) | 313 | 8 | 2 |
| [input.js](../src/battle/input.js) | 23 | 2 | 2 |
| [native-webgl-renderer.js](../src/battle/native-webgl-renderer.js) | 203 | 3 | 3 |
| [native-webgl-visual-fixture.js](../src/battle/native-webgl-visual-fixture.js) | 290 | 3 | 1 |
| [render.js](../src/battle/render.js) | 1286 | 14 | 4 |
| [scout-joystick.js](../src/battle/scout-joystick.js) | 290 | 0 | 2 |
| [ship-selection.js](../src/battle/ship-selection.js) | 14 | 0 | 4 |
| [state-interpolation.js](../src/battle/state-interpolation.js) | 393 | 2 | 2 |
| [status-effect-timing.js](../src/battle/status-effect-timing.js) | 17 | 0 | 2 |
| [status-effects.js](../src/battle/status-effects.js) | 160 | 2 | 4 |
| [template.js](../src/battle/template.js) | 170 | 3 | 2 |
| [throttle.js](../src/battle/throttle.js) | 64 | 2 | 3 |

## `src/battle/render`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [bunny-haruhi.js](../src/battle/render/bunny-haruhi.js) | 92 | 1 | 1 |
| [haruhi-hero-power.js](../src/battle/render/haruhi-hero-power.js) | 187 | 0 | 1 |
| [koizumi-barrier.js](../src/battle/render/koizumi-barrier.js) | 544 | 0 | 1 |
| [koizumi-orb.js](../src/battle/render/koizumi-orb.js) | 157 | 0 | 1 |
| [radar.js](../src/battle/render/radar.js) | 347 | 3 | 1 |
| [shamisen-hunt.js](../src/battle/render/shamisen-hunt.js) | 177 | 0 | 1 |
| [vision-wave.js](../src/battle/render/vision-wave.js) | 100 | 2 | 1 |

## `src/battle/webgl`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [color.js](../src/battle/webgl/color.js) | 107 | 0 | 2 |
| [driver.js](../src/battle/webgl/driver.js) | 594 | 0 | 3 |
| [fixture-page.js](../src/battle/webgl/fixture-page.js) | 19 | 2 | 0 |
| [geometry.js](../src/battle/webgl/geometry.js) | 333 | 0 | 1 |
| [matrix.js](../src/battle/webgl/matrix.js) | 40 | 0 | 2 |
| [native-context.js](../src/battle/webgl/native-context.js) | 768 | 6 | 1 |
| [projectile-batch.js](../src/battle/webgl/projectile-batch.js) | 134 | 3 | 1 |
| [text-cache.js](../src/battle/webgl/text-cache.js) | 149 | 0 | 1 |

## `src/changelog`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [entries.js](../src/changelog/entries.js) | 848 | 0 | 1 |
| [meta.js](../src/changelog/meta.js) | 4 | 1 | 1 |

## `src/character-select`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [portraits.js](../src/character-select/portraits.js) | 383 | 2 | 5 |
| [skill-details.js](../src/character-select/skill-details.js) | 146 | 2 | 1 |
| [skill-presentation.js](../src/character-select/skill-presentation.js) | 195 | 9 | 1 |

## `src/i18n`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [bunny-haruhi-text.js](../src/i18n/bunny-haruhi-text.js) | 93 | 0 | 3 |
| [catalog.js](../src/i18n/catalog.js) | 12 | 4 | 1 |
| [character-text.js](../src/i18n/character-text.js) | 200 | 0 | 1 |
| [messages-en.js](../src/i18n/messages-en.js) | 951 | 1 | 1 |
| [messages-ja.js](../src/i18n/messages-ja.js) | 954 | 1 | 1 |

## `src/online`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [connection-target.js](../src/online/connection-target.js) | 59 | 0 | 2 |
| [lobby-view.js](../src/online/lobby-view.js) | 123 | 1 | 1 |
| [profile-controller.js](../src/online/profile-controller.js) | 148 | 5 | 1 |
| [result-view.js](../src/online/result-view.js) | 198 | 3 | 1 |
| [snapshot-transport.js](../src/online/snapshot-transport.js) | 342 | 5 | 1 |
| [spectator-view.js](../src/online/spectator-view.js) | 275 | 5 | 1 |
| [state-sync.js](../src/online/state-sync.js) | 297 | 3 | 1 |
| [throttle-command-state.js](../src/online/throttle-command-state.js) | 79 | 1 | 1 |
| [tournament-view.js](../src/online/tournament-view.js) | 44 | 1 | 1 |

## `src/solo`

| 模块 | 行数 | 静态出边 | 范围内入边 |
| --- | ---: | ---: | ---: |
| [session.js](../src/solo/session.js) | 88 | 5 | 1 |
