const sanctionLabels = {
  FARM_BAN: "farmBan",
  FARM_SUSPENSION: "farmSuspension",
  FARM_WARNING: "farmWarning",
  SHARED_TRADE_BAN: "sharedTradeBan",
  SHARED_TRADE_SUSPENSION: "sharedTradeSuspension",
  SHARED_TRADE_WARNING: "sharedTradeWarning"
} as const;

export function anticheatSanctionLabel(type?: string) {
  if (!type || !Object.hasOwn(sanctionLabels, type)) return undefined;
  return sanctionLabels[type as keyof typeof sanctionLabels];
}
