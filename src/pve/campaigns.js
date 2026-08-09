import { cloneLoadout } from "../../shared/game-core.js";

export const PVE_CAMPAIGN_IDS = Object.freeze({
  RESEARCH_CHALLENGE: "research-challenge",
  JUSTICE_PREVAILS: "justice-prevails",
});

const CAMPAIGNS = {
  [PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE]: {
    id: PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE,
    menuNo: "03",
    title: "电研社的挑战",
    subtitle: "敌方拥有全图视野与相位跃迁；强化长门将作为友军参战",
    shortTitle: "电研社的挑战",
    playerTeamName: "SOS团临时舰队",
    enemyTeamName: "电研社作弊舰队",
    playerLoadout: { main: "haruhi", sub1: "kyon", sub2: "koizumi" },
    enemyLoadout: { main: "haruhi", sub1: "kyon", sub2: "shamisen" },
    objective: "借助长门援军，击溃拥有全域观测与相位跃迁的敌舰",
    opening: [
      {
        kind: "title",
        eyebrow: "PVE CAMPAIGN 01",
        speaker: "电研社的挑战",
        text: "约定的对战刚刚开始，对面的舰队便锁定了本不可能观测到的目标。星图上，陌生的坐标改写正在成片发生。",
        cue: "wide-standoff",
      },
      {
        speaker: "电研社社长",
        side: "right",
        tone: "hostile",
        text: "只是把侦察范围和移动参数稍微调高了一点。这是主办方的技术优势，不算作弊。",
        cue: "enemy-cheat",
      },
      {
        speaker: "凉宫春日",
        characterId: "haruhi",
        side: "left",
        text: "全地图都看得见，还能说消失就消失？很好——那我们就正面把他们打到认输！",
        cue: "haruhi-forward",
      },
      {
        speaker: "长门有希",
        characterId: "yuki",
        side: "left",
        text: "确认未授权的全域观测与坐标重写。常规舰队难以追踪。申请以独立战斗舰接入。",
        cue: "yuki-arrives",
      },
      {
        speaker: "阿虚",
        characterId: "kyon",
        side: "left",
        text: "也就是说，他们永远知道我们在哪，还会突然跳到侧后方。好消息是，这次长门站在我们这边。",
        cue: "ally-lock",
      },
      {
        kind: "objective",
        eyebrow: "作战规则已改写",
        speaker: "长门援军接入",
        text: "敌军持续获得真实全图视野，并会在短暂预警后发动相位跃迁。强化长门由 AI 控制，会主动寻找交战位置。",
        actionLabel: "迎战作弊舰队",
        cue: "battle-ready",
      },
    ],
  },
  [PVE_CAMPAIGN_IDS.JUSTICE_PREVAILS]: {
    id: PVE_CAMPAIGN_IDS.JUSTICE_PREVAILS,
    menuNo: "04",
    title: "正义必将得到伸张",
    subtitle: "利用短暂作弊窗口速攻；长门会逐步剥夺全部优势",
    shortTitle: "正义必将得到伸张",
    playerTeamName: "电研社复仇舰队",
    enemyTeamName: "SOS团统合舰队",
    playerLoadout: { main: "kyon", sub1: "koizumi", sub2: "future1096" },
    enemyLoadout: { main: "yuki", sub1: "haruhi", sub2: "asakura" },
    objective: "在作弊协议被长门逐层解除前重创 SOS 团，并击破强化长门",
    opening: [
      {
        kind: "title",
        eyebrow: "PVE CAMPAIGN 02",
        speaker: "正义必将得到伸张",
        text: "电脑被夺走，社团活动室也成了赌注。电研社社长决定接受春日的挑战——并把胜负写进自己最熟悉的程序里。",
        cue: "wide-standoff",
      },
      {
        speaker: "电研社社长",
        side: "left",
        text: "全域索敌、火控增幅、动力超频……只要在她发现之前结束战斗，电脑和长门都会回到我们这里。",
        cue: "player-cheat",
      },
      {
        speaker: "凉宫春日",
        characterId: "haruhi",
        side: "right",
        tone: "hostile",
        text: "你们尽管先动手！不管加了什么小把戏，SOS团都不可能输！",
        cue: "haruhi-taunt",
      },
      {
        speaker: "长门有希",
        characterId: "yuki",
        side: "right",
        tone: "hostile",
        text: "检测到七项非对称参数。开始解析。预计将依次剥离火控、观测与动力权限。",
        cue: "yuki-analysis",
      },
      {
        speaker: "电研社社长",
        side: "left",
        text: "她真的能把后台权限抢走……没时间摆阵了。趁所有作弊协议仍然有效，集中火力！",
        cue: "countdown-threat",
      },
      {
        kind: "objective",
        eyebrow: "优势正在倒数",
        speaker: "先发制人",
        text: "开局拥有全图视野、火控、射程与机动强化。长门会分三阶段解除它们，并在解析完成后进入完全战斗状态。",
        actionLabel: "立即发动速攻",
        cue: "battle-ready",
      },
    ],
  },
};

export const PVE_CAMPAIGN_MENU_ITEMS = Object.freeze(
  Object.values(CAMPAIGNS).map(({ id, menuNo: no, title: label, subtitle: sub }) => ({ id, no, label, sub })),
);

export function isPveCampaign(campaignId) {
  return Boolean(CAMPAIGNS[campaignId]);
}

export function getPveCampaign(campaignId) {
  const campaign = CAMPAIGNS[campaignId];
  if (!campaign) return null;
  return {
    ...campaign,
    playerLoadout: cloneLoadout(campaign.playerLoadout),
    enemyLoadout: cloneLoadout(campaign.enemyLoadout),
    opening: campaign.opening.map((step) => ({ ...step })),
  };
}
