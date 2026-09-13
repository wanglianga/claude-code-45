// 自伤风险关键词：居民预约文本命中即触发高危即时分流，不进入普通排班
export const SELF_HARM_KEYWORDS = [
  '自杀', '轻生', '不想活', '活不下去', '活着没意思', '活着没意义', '了结自己', '结束生命',
  '寻死', '觅死', '想死', '死了算了', '一了百了', '同归于尽',
  '自伤', '自残', '割腕', '割手', '划伤自己', '伤害自己', '伤到自己', '毁掉自己',
  '跳楼', '跳河', '跳桥', '上吊', '吞药', '吞安眠药', '安眠药', '药物过量', '吃了一把药',
  '遗书', '写了遗书', '留了遗言',
];

export function detectSelfHarmKeywords(...texts: string[]): string[] {
  const joined = texts.filter(Boolean).join('\n');
  return SELF_HARM_KEYWORDS.filter(k => joined.includes(k));
}
