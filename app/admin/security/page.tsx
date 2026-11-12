import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { UrlPagination } from "@/components/ui/url-pagination";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AdminNavigation } from "../admin-navigation";
import { SanctionAppeals } from "./sanction-appeals";
import { FarmAssetPreview } from "./farm-asset-preview";
import {
  applySmurfSanctionAction,
  cancelPendingReferralRewardAction,
  recoverUnusedReferralLotAction,
  simulateFarmAction,
  resolveTradeQuarantineAction,
  reviewAnticheatFarmAction,
  reviewAnticheatCaseAction
} from "./actions";
import {
  AccountStatus,
  EventDetail,
  type AccountState,
  type EventAssetDetail,
  type ReferralPackCardProvenance
} from "./event-detail";
import {
  RelatedAccountPicker,
  type RelatedAccountData
} from "./related-account-picker";
import {
  DeletedAccountHistory,
  type DeletedAccountPreview
} from "./deleted-account-history";
import {
  DeletedSmurfRecovery,
  type DeletedSmurfRecoveryPreview
} from "./deleted-smurf-recovery";
import {
  SanctionQuarantineConflicts,
  type SanctionQuarantineConflict
} from "./sanction-quarantine-conflicts";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const severities = new Set(["watch", "elevated", "high", "critical"]);
const quarantineStatuses = new Set([
  "",
  "SHADOW",
  "PENDING_ANALYSIS",
  "AWAITING_REVIEW",
  "RELEASED",
  "CANCELLED",
  "EXPIRED"
]);
const eventTypes = new Set([
  "account_registered",
  "trade_created",
  "trade_accepted",
  "trade_declined",
  "trade_cancelled",
  "auction_created",
  "auction_bid",
  "auction_sold",
  "auction_expired",
  "referral_rewarded",
  "network_identity_shared",
  "trade_shared_network_identity",
  "referral_network_review",
  "referral_network_enforcement"
]);

type CaseRow = {
  accountState?: AccountState;
  userId: string;
  pseudo: string;
  email: string;
  score: number;
  severity: string;
  status: string;
  eventCount: number;
  reasonCodes: string[];
  lastFlaggedAt: string;
  economicLinkedAccounts: number;
  networkLinkedAccounts: number;
  latestReview: {
    decision: string;
    note: string;
    createdAt: string;
    adminPseudo: string;
  } | null;
};

type EventParty = {
  id: string;
  pseudo: string;
  accountState?: AccountState;
} | null;
type EventSubject = {
  userId: string;
  pseudo: string;
  riskPoints: number;
  reasonCodes: string[];
};
type EventRow = {
  sanctionApplied: boolean;
  detail?: EventAssetDetail;
  id: number;
  occurredAt: string;
  type: string;
  subjectId: string | null;
  amount: number;
  cardCount: number;
  actor: EventParty;
  counterparty: EventParty;
  subjects: EventSubject[];
  metadata: Record<string, unknown>;
};

type QuarantineRow = {
  id: string;
  subjectType: string;
  subjectId: string;
  status: string;
  sender: { id: string | null; pseudo: string };
  recipient: { id: string | null; pseudo: string };
  riskScore: number;
  confidence: string;
  economicSeverity: string;
  sharedConnectionRecorded: boolean;
  createdAt: string;
  expiresAt: string;
  version: number;
  cardCount: number;
  karas: number;
  analysisOutcome: string | null;
  reviewDueAt: string | null;
};

type SanctionPreview = {
  smurf: { userId: string; pseudo: string; banned: boolean };
  primary: { userId: string; pseudo: string; karasBalance: number };
  evidence: {
    sharedNetwork: boolean;
    sharedDevice: boolean;
    acceptedTrades: number;
  };
  recovery: {
    cards: number;
    blockedCards: number;
    cardsNoLongerOnPrimary: number;
    tradeKaras: number;
    saleKaras: number;
    saleCount: number;
    karas: number;
    quarantineConflicts?: SanctionQuarantineConflict[];
  };
  alreadyApplied: boolean;
  eligible: boolean;
  previewToken: string;
  cardLabels: Record<
    string,
    { name: string; rarity?: string; franchise?: string }
  >;
  history: SanctionHistory;
  receipt: {
    id: string;
    appliedAt: string;
    note: string;
    history: SanctionHistory;
    recovery: SanctionPreview["recovery"];
  } | null;
};

type SanctionHistory = {
  trades: {
    id: string;
    acceptedAt: string;
    fromUser: string;
    toUser: string;
    offeredCards: string[];
    requestedCards: string[];
    offeredKaras: number;
    requestedKaras: number;
  }[];
  sales: {
    id: string;
    cardInstanceId: string;
    createdAt: string;
    karas: number;
  }[];
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function caseFromRpc(value: Record<string, unknown>): CaseRow {
  return {
    accountState: value.accountState as AccountState | undefined,
    userId: String(value.userId ?? ""),
    pseudo: String(value.pseudo ?? ""),
    email: String(value.email ?? ""),
    score: Number(value.score ?? 0),
    severity: String(value.severity ?? "watch"),
    status: String(value.status ?? "open"),
    eventCount: Number(value.eventCount ?? 0),
    reasonCodes: strings(value.reasonCodes),
    lastFlaggedAt: String(value.lastFlaggedAt ?? ""),
    economicLinkedAccounts: Number(value.economicLinkedAccounts ?? 0),
    networkLinkedAccounts: Number(value.networkLinkedAccounts ?? 0),
    latestReview:
      value.latestReview && typeof value.latestReview === "object"
        ? {
            decision: String(
              (value.latestReview as Record<string, unknown>).decision ?? ""
            ),
            note: String(
              (value.latestReview as Record<string, unknown>).note ?? ""
            ),
            createdAt: String(
              (value.latestReview as Record<string, unknown>).createdAt ?? ""
            ),
            adminPseudo: String(
              (value.latestReview as Record<string, unknown>).adminPseudo ?? ""
            )
          }
        : null
  };
}

function partyFromRpc(value: unknown): EventParty {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    id: String(record.id ?? ""),
    pseudo: String(record.pseudo ?? ""),
    accountState: record.accountState as AccountState | undefined
  };
}

function eventFromRpc(value: Record<string, unknown>): EventRow {
  return {
    sanctionApplied: value.sanctionApplied === true,
    detail:
      value.detail && typeof value.detail === "object"
        ? (value.detail as EventAssetDetail)
        : undefined,
    id: Number(value.id ?? 0),
    occurredAt: String(value.occurredAt ?? ""),
    type: String(value.type ?? ""),
    subjectId: typeof value.subjectId === "string" ? value.subjectId : null,
    amount: Number(value.amount ?? 0),
    cardCount: Number(value.cardCount ?? 0),
    actor: partyFromRpc(value.actor),
    counterparty: partyFromRpc(value.counterparty),
    metadata:
      value.metadata && typeof value.metadata === "object"
        ? (value.metadata as Record<string, unknown>)
        : {},
    subjects: (Array.isArray(value.subjects) ? value.subjects : []).map(
      item => {
        const record = item as Record<string, unknown>;
        return {
          userId: String(record.userId ?? ""),
          pseudo: String(record.pseudo ?? ""),
          riskPoints: Number(record.riskPoints ?? 0),
          reasonCodes: strings(record.reasonCodes)
        };
      }
    )
  };
}

function quarantineFromRpc(value: Record<string, unknown>): QuarantineRow {
  const party = (key: "sender" | "recipient") => {
    const record = value[key] as Record<string, unknown> | undefined;
    return {
      id: typeof record?.id === "string" ? record.id : null,
      pseudo: String(record?.pseudo ?? "Deleted player")
    };
  };
  return {
    id: String(value.id ?? ""),
    subjectType: String(value.subjectType ?? ""),
    subjectId: String(value.subjectId ?? ""),
    status: String(value.status ?? "SHADOW"),
    sender: party("sender"),
    recipient: party("recipient"),
    riskScore: Number(value.riskScore ?? 0),
    confidence: String(value.confidence ?? "LOW"),
    economicSeverity: String(value.economicSeverity ?? "LOW"),
    sharedConnectionRecorded: strings(value.reasonCodes).some(
      code =>
        code === "SHARED_NETWORK_BROWSER_ONE_WAY_TRANSFER" ||
        code === "SHARED_NETWORK_AND_BROWSER_WITH_ACCEPTED_TRADE"
    ),
    createdAt: String(value.createdAt ?? ""),
    expiresAt: String(value.expiresAt ?? ""),
    version: Number(value.version ?? 1),
    cardCount: Number(value.cardCount ?? 0),
    karas: Number(value.karas ?? 0),
    analysisOutcome:
      typeof value.analysisOutcome === "string" ? value.analysisOutcome : null,
    reviewDueAt:
      typeof value.reviewDueAt === "string" ? value.reviewDueAt : null
  };
}

const reasonKeys: Record<string, string> = {
  ONE_WAY_TRADE_SOURCE: "oneWayTradeSource",
  ONE_WAY_TRADE_BENEFICIARY: "oneWayTradeBeneficiary",
  TRADE_VALUE_IMBALANCE: "tradeValueImbalance",
  LARGE_KARA_TRANSFER: "largeKaraTransfer",
  REPEATED_TRADE_PAIR: "repeatedTradePair",
  EXTREME_AUCTION_BID: "extremeAuctionBid",
  EXTREME_AUCTION_BID_COUNTERPARTY: "extremeAuctionBidCounterparty",
  REPEATED_AUCTION_PAIR: "repeatedAuctionPair",
  REPEATED_AUCTION_SETTLEMENT_PAIR: "repeatedAuctionSettlementPair",
  REFERRAL_REWARD_BURST: "referralRewardBurst",
  NEW_ACCOUNT_ECONOMIC_ACTIVITY: "newAccountEconomicActivity",
  SHARED_NETWORK_IDENTITY: "sharedNetworkIdentity",
  TRADE_SHARED_NETWORK_IDENTITY: "tradeSharedNetworkIdentity",
  REFERRAL_NETWORK_REVIEW: "referralNetworkReview",
  REFERRAL_NETWORK_ENFORCEMENT: "referralNetworkEnforcement"
};

const eventKeys: Record<string, string> = {
  account_registered: "accountRegistered",
  trade_created: "tradeCreated",
  trade_accepted: "tradeAccepted",
  trade_declined: "tradeDeclined",
  trade_cancelled: "tradeCancelled",
  auction_created: "auctionCreated",
  auction_bid: "auctionBid",
  auction_sold: "auctionSold",
  auction_expired: "auctionExpired",
  referral_rewarded: "referralRewarded",
  network_identity_shared: "networkIdentityShared",
  trade_shared_network_identity: "tradeSharedNetworkIdentity",
  referral_network_review: "referralNetworkReview",
  referral_network_enforcement: "referralNetworkEnforcement"
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSecurity");
  return { title: t("metadataTitle") };
}

export default async function AdminSecurityPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    severity?: string;
    event?: string;
    user?: string;
    page?: string;
    sanction?: string;
    primary?: string;
    result?: string;
    deletedPrimary?: string;
    source?: string | string[];
    mode?: string;
    role?: string;
    source_account?: string | string[];
    deleted_q?: string;
    deleted_all?: string;
    deleted_page?: string;
    linked_q?: string;
    linked_status?: string;
    linked_page?: string;
    quarantine_status?: string;
    quarantine_result?: string;
    cluster?: string;
    farm_result?: string;
    appeal_result?: string;
    asset?: string;
    asset_kind?: string;
  }>;
}) {
  const admin = await requireAdminPage();
  const client = createClient(await cookies());
  const t = await getTranslations("adminSecurity");
  const locale = await getLocale();
  const params = await searchParams;
  const assetId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
    params.asset ?? ""
  )
    ? params.asset!
    : null;
  const assetKind =
    params.asset_kind === "CARD" || params.asset_kind === "SALE"
      ? params.asset_kind
      : null;
  const clusterId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
    params.cluster ?? ""
  )
    ? params.cluster!
    : null;
  const query = params.q?.trim().slice(0, 100) ?? "";
  const severity = severities.has(params.severity ?? "")
    ? params.severity!
    : "";
  const eventType =
    params.event === "trade_accepted" && eventTypes.has(params.event)
      ? params.event
      : "";
  const userId = /^[0-9a-f-]{36}$/i.test(params.user ?? "")
    ? params.user!
    : null;
  const subject = params.sanction ?? params.deletedPrimary;
  const sanctionUserId = /^[0-9a-f-]{36}$/i.test(subject ?? "")
    ? subject!
    : null;
  const sanctionMode =
    params.mode === "deleted" || params.deletedPrimary ? "deleted" : "active";
  const primaryUserId = /^[0-9a-f-]{36}$/i.test(params.primary ?? "")
    ? params.primary!
    : null;
  const sanctionApplied = params.result === "smurf-sanction-applied";
  const caseIsPrimary = params.role === "primary" || sanctionMode === "deleted";
  const roleIsExplicit =
    params.role === "primary" ||
    params.role === "smurf" ||
    sanctionMode === "deleted";
  const deletedPrimaryId = sanctionMode === "deleted" ? sanctionUserId : null;
  const historicalTradeIds = (
    Array.isArray(params.source)
      ? params.source
      : params.source
        ? [params.source]
        : []
  )
    .filter(id => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 100);
  let deletedRecovery: DeletedSmurfRecoveryPreview | null = null;
  let deletedAccountPreview: DeletedAccountPreview | null = null;
  const selectedDeletedAccounts = [
    ...new Set(
      (Array.isArray(params.source_account)
        ? params.source_account
        : params.source_account
          ? [params.source_account]
          : []
      )
        .filter(id => /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, 100)
    )
  ];
  const deletedQuery = params.deleted_q?.trim().slice(0, 100) ?? "";
  const deletedRelatedOnly = params.deleted_all !== "1";
  const deletedPage = Math.max(
    1,
    Number.parseInt(params.deleted_page ?? "1", 10) || 1
  );
  const linkedQuery =
    (params.linked_q ?? params.deleted_q)?.trim().slice(0, 100) ?? "";
  const linkedStatus = new Set(["active", "banned", "deleted", "archived"]).has(
    params.linked_status ?? ""
  )
    ? params.linked_status!
    : params.deleted_all === "1"
      ? "archived"
      : "";
  const linkedPage = Math.max(
    1,
    Number.parseInt(params.linked_page ?? "1", 10) || 1
  );
  const quarantineStatus = quarantineStatuses.has(
    params.quarantine_status ?? ""
  )
    ? params.quarantine_status!
    : "";
  let relatedData: RelatedAccountData | null = null;
  if (sanctionUserId) {
    const result = await client.rpc("admin_list_anticheat_related_accounts", {
      p_subject_user_id: sanctionUserId,
      p_query: linkedQuery,
      p_status: linkedStatus,
      p_limit: 30,
      p_offset: (linkedPage - 1) * 30
    });
    if (result.error) throw new Error(result.error.message);
    relatedData = result.data as RelatedAccountData;
  }
  if (deletedPrimaryId) {
    const result = await client.rpc("admin_preview_sanction", {
      p_subject_user_id: deletedPrimaryId,
      p_mode: "deleted",
      p_primary_user_id: null,
      p_trade_ids: historicalTradeIds
    });
    if (result.error) throw new Error(result.error.message);
    deletedRecovery = result.data as DeletedSmurfRecoveryPreview;
    if (
      selectedDeletedAccounts.length &&
      selectedDeletedAccounts.length <= 20
    ) {
      const previewResult = await client.rpc(
        "admin_preview_deleted_account_sanction",
        {
          p_primary_user_id: deletedPrimaryId,
          p_deleted_user_ids: selectedDeletedAccounts
        }
      );
      if (previewResult.error) throw new Error(previewResult.error.message);
      deletedAccountPreview = previewResult.data as DeletedAccountPreview;
    }
  }
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const [
    name,
    karas,
    casesResult,
    eventsResult,
    quarantinesResult,
    clustersResult,
    workloadResult,
    farmRecoveryResult
  ] = await Promise.all([
    getCurrentPseudo(admin.id),
    getCurrentKarasBalance(client),
    client.rpc("admin_list_anticheat_cases", {
      p_query: query,
      p_severity: severity,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE
    }),
    client.rpc("admin_list_anticheat_events", {
      p_user_id: userId,
      p_event_type: "trade_accepted",
      p_limit: 40,
      p_offset: 0
    }),
    client.rpc("admin_list_anticheat_quarantines", {
      p_status: quarantineStatus,
      p_limit: 30,
      p_offset: 0
    }),
    client.rpc("admin_list_anticheat_clusters", { p_id: clusterId }),
    client.rpc("admin_anticheat_workload"),
    clusterId
      ? client.rpc("admin_preview_anticheat_farm_recovery", {
          p_cluster: clusterId
        })
      : Promise.resolve({ data: null, error: null })
  ]);
  if (casesResult.error) throw new Error(casesResult.error.message);
  if (eventsResult.error) throw new Error(eventsResult.error.message);
  if (quarantinesResult.error) throw new Error(quarantinesResult.error.message);
  if (clustersResult.error) throw new Error(clustersResult.error.message);
  if (workloadResult.error) throw new Error(workloadResult.error.message);
  if (farmRecoveryResult.error)
    throw new Error(farmRecoveryResult.error.message);
  const workload = (workloadResult.data ?? {}) as Record<string, number>;
  const farmRecovery = farmRecoveryResult.data as {
    beneficiary: string;
    secondaries: string[];
    unusedPacks: number;
    attributedCards: number;
    protectedCards: number;
    availableCards: number;
    blockedCards: number;
    creditedKaras: number;
    possibleKaras: number;
    recoveryEnabled?: boolean;
    referredLots?: { id: string; owner: string; packs: number }[];
    pendingRewards?: { id: string; recipient: string; packs: number }[];
    sales: { id: string; sale_karas: number }[];
    cards?: { card_instance_id: string; state: string }[];
  } | null;
  const clusters = (clustersResult.data ?? []) as {
    id: string;
    accountCount: number;
    recentAccountCount: number;
    activeAccountCount: number;
    referralCount: number;
    internalTrades: number;
    cards: number;
    karas: number;
    beneficiary: string | null;
    priority: string;
    state: string;
    farmDecision: "INVESTIGATE" | "ECONOMICALLY_CONFIRMED" | null;
    farmConfidence: "INSUFFICIENT" | "CORROBORATED" | null;
    farmRisk: number | null;
    farmVersion: string | null;
    farmReview: "CONFIRMED" | "DISMISSED" | null;
    enforcement?: {
      decision: string;
      principalInvolved?: boolean;
      secondaries?: string[];
    };
    farmEvidence: {
      indirectCards?: number;
      cycleCards?: number;
      auctionSales?: number;
      scenarioFindings?: Partial<
        Record<
          "A" | "B" | "C" | "D",
          {
            score: number;
            confidence: "CORROBORATED" | "INSUFFICIENT";
            decision: "INVESTIGATE" | "ECONOMICALLY_CONFIRMED";
            cards?: number;
            netKaras?: number;
            secondaries: string[];
          }
        >
      >;
      proofs?: {
        secondary: string;
        card: string;
        edge: number;
        path: string[];
      }[];
    } | null;
    members: { id: string; pseudo: string | null; createdAt: string }[];
  }[];
  const casePayload = (casesResult.data ?? {}) as Record<string, unknown>;
  const eventPayload = (eventsResult.data ?? {}) as Record<string, unknown>;
  const quarantinePayload = (quarantinesResult.data ?? {}) as Record<
    string,
    unknown
  >;
  const summary = (casePayload.summary ?? {}) as Record<string, unknown>;
  const cases = (Array.isArray(casePayload.cases) ? casePayload.cases : []).map(
    item => caseFromRpc(item as Record<string, unknown>)
  );
  const events = (
    Array.isArray(eventPayload.events) ? eventPayload.events : []
  ).map(item => eventFromRpc(item as Record<string, unknown>));
  const quarantines = (
    Array.isArray(quarantinePayload.items) ? quarantinePayload.items : []
  ).map(item => quarantineFromRpc(item as Record<string, unknown>));
  const quarantinesAwaitingReview = Number(
    quarantinePayload.awaitingReview ?? 0
  );
  const referralCardInstanceIds = [
    ...new Set(
      events.flatMap(event => {
        const detail = event.detail;
        if (!detail) return [];
        return [
          ...(detail.offeredCards ?? []),
          ...(detail.requestedCards ?? []),
          ...(detail.cards ?? [])
        ]
          .map(card => card.instanceId)
          .filter((id): id is string => typeof id === "string");
      })
    )
  ];
  if (referralCardInstanceIds.length) {
    const provenanceResult = await client.rpc(
      "admin_get_referral_pack_provenance",
      { p_card_instance_ids: referralCardInstanceIds.slice(0, 1000) }
    );
    if (provenanceResult.error) throw new Error(provenanceResult.error.message);
    const provenanceByCard = new Map<string, ReferralPackCardProvenance>();
    for (const item of Array.isArray(provenanceResult.data)
      ? provenanceResult.data
      : []) {
      const record = item as Record<string, unknown>;
      const transfers = Array.isArray(record.transfers)
        ? record.transfers.map(value => {
            const transfer = value as Record<string, unknown>;
            return {
              type: String(
                transfer.type
              ) as ReferralPackCardProvenance["transfers"][number]["type"],
              occurredAt: String(transfer.occurredAt ?? ""),
              from: typeof transfer.from === "string" ? transfer.from : null,
              to: typeof transfer.to === "string" ? transfer.to : null,
              karas: typeof transfer.karas === "number" ? transfer.karas : null
            };
          })
        : [];
      provenanceByCard.set(String(record.cardInstanceId), {
        beneficiaryRole: String(
          record.beneficiaryRole
        ) as ReferralPackCardProvenance["beneficiaryRole"],
        openedAt: String(record.openedAt ?? ""),
        openedBy: typeof record.openedBy === "string" ? record.openedBy : null,
        referrer: typeof record.referrer === "string" ? record.referrer : null,
        referred: typeof record.referred === "string" ? record.referred : null,
        rewardGrantedAt: String(record.rewardGrantedAt ?? ""),
        transfers
      });
    }
    for (const event of events) {
      if (!event.detail) continue;
      const attachProvenance = <T extends { instanceId?: string }>(
        card: T
      ) => ({
        ...card,
        ...(card.instanceId && provenanceByCard.has(card.instanceId)
          ? { referralPack: provenanceByCard.get(card.instanceId) }
          : {})
      });
      event.detail = {
        ...event.detail,
        offeredCards: event.detail.offeredCards?.map(attachProvenance),
        requestedCards: event.detail.requestedCards?.map(attachProvenance),
        cards: event.detail.cards?.map(attachProvenance)
      };
    }
  }
  type Connection = {
    accountState?: AccountState;
    userId: string;
    pseudo: string | null;
    deleted: boolean;
    lastSharedAt: string;
    sharedBrowser: boolean;
    acceptedTrades: number;
  };
  const connectionsResult = await client.rpc(
    "admin_list_anticheat_connections",
    { p_user_ids: cases.map(item => item.userId) }
  );
  if (connectionsResult.error) throw new Error(connectionsResult.error.message);
  const connections = (connectionsResult.data ?? {}) as Record<
    string,
    { count: number; accounts: Connection[] }
  >;
  const total = Number(casePayload.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let sanctionPreview: SanctionPreview | null = null;
  if (
    sanctionUserId &&
    sanctionMode === "active" &&
    !relatedData?.subject?.removed
  ) {
    if (primaryUserId) {
      const previewResult = await client.rpc("admin_preview_sanction", {
        p_subject_user_id: caseIsPrimary ? primaryUserId : sanctionUserId,
        p_mode: "active",
        p_primary_user_id: caseIsPrimary ? sanctionUserId : primaryUserId,
        p_trade_ids: []
      });
      if (previewResult.error) throw new Error(previewResult.error.message);
      sanctionPreview = previewResult.data as SanctionPreview;
      if (sanctionPreview.receipt)
        sanctionPreview.recovery = sanctionPreview.receipt.recovery;
    }
  }
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const baseParams = new URLSearchParams({
    ...(query ? { q: query } : {}),
    ...(severity ? { severity } : {}),
    ...(eventType ? { event: eventType } : {}),
    ...(userId ? { user: userId } : {})
  });
  const allPlayersParams = new URLSearchParams({
    ...(query ? { q: query } : {}),
    ...(severity ? { severity } : {}),
    ...(eventType ? { event: eventType } : {})
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Topbar
        view="admin"
        account={<AccountMenu />}
        name={name ?? undefined}
        karas={karas}
      />
      <main
        id="main-content"
        className="min-w-0 px-3 py-6 [overflow-wrap:anywhere] [&_.yk-button]:min-w-0 [&_.yk-button]:whitespace-normal sm:px-8 sm:py-8"
      >
        <div className="mx-auto max-w-7xl space-y-6">
          <header>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300 sm:text-sm">
              {t("eyebrow")}
            </p>
            <h1 className="mt-1 text-3xl font-black sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              {t("description")}
            </p>
          </header>
          <AdminNavigation />

          {sanctionApplied && sanctionPreview?.receipt && (
            <p
              className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-100"
              role="status"
            >
              {t("receiptOutcome", {
                smurf: sanctionPreview.smurf.pseudo,
                primary: sanctionPreview.primary.pseudo,
                cards: sanctionPreview.receipt.recovery.cards,
                karas: sanctionPreview.receipt.recovery.karas
              })}
            </p>
          )}

          <section
            aria-label={t("summaryLabel")}
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {[
              ["openCases", Number(summary.open ?? 0)],
              ["criticalCases", Number(summary.critical ?? 0)],
              ["events24h", Number(summary.events24h ?? 0)],
              ["signals24h", Number(summary.flagged24h ?? 0)]
            ].map(([key, value]) => (
              <article
                className="min-w-0 rounded-2xl border border-cyan-300/15 bg-slate-900/70 p-4 sm:p-5"
                key={String(key)}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t(String(key))}
                </p>
                <p className="mt-2 text-2xl font-black text-cyan-100 sm:text-3xl">
                  {Number(value).toLocaleString(locale)}
                </p>
              </article>
            ))}
          </section>

          <section
            className="rounded-2xl border border-violet-300/20 bg-slate-900/70 p-4 sm:p-5"
            id="anticheat-quarantines"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">
                  {t("quarantines.eyebrow")}
                </p>
                <h2 className="mt-1 text-xl font-black">
                  {t("quarantines.title")}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-400">
                  {t("quarantines.help")}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-500/10 px-3 py-1 text-sm font-bold text-amber-100">
                {t("quarantines.awaitingReview", {
                  count: quarantinesAwaitingReview
                })}
              </span>
            </div>

            <form className="mt-4 flex flex-col gap-3 sm:flex-row" method="get">
              <input name="q" type="hidden" value={query} />
              <input name="severity" type="hidden" value={severity} />
              <select
                aria-label={t("quarantines.filterLabel")}
                className="yk-field-control min-w-0 sm:max-w-xs"
                defaultValue={quarantineStatus}
                name="quarantine_status"
              >
                <option value="">{t("quarantines.all")}</option>
                {[
                  "SHADOW",
                  "PENDING_ANALYSIS",
                  "AWAITING_REVIEW",
                  "RELEASED",
                  "CANCELLED",
                  "EXPIRED"
                ].map(status => (
                  <option key={status} value={status}>
                    {t(`quarantines.statuses.${status}`)}
                  </option>
                ))}
              </select>
              <button className="yk-button yk-button-secondary" type="submit">
                {t("filter")}
              </button>
            </form>

            {quarantines.length === 0 ? (
              <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-5 text-sm text-slate-400">
                {t("quarantines.empty")}
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-[56rem] w-full text-left text-sm">
                  <thead className="bg-slate-950/80 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      {[
                        "detected",
                        "transaction",
                        "accounts",
                        "evidence",
                        "status",
                        "expires"
                      ].map(key => (
                        <th
                          className="px-3 py-3 font-semibold"
                          key={key}
                          scope="col"
                        >
                          {t(`quarantines.columns.${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {quarantines.map(item => (
                      <tr
                        className="bg-slate-900/40"
                        id={`quarantine-${item.id}`}
                        key={item.id}
                      >
                        <td className="px-3 py-3 text-slate-300">
                          {dateFormatter.format(new Date(item.createdAt))}
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-100">
                            {t(`quarantines.types.${item.subjectType}`)}
                          </p>
                          <p className="max-w-32 truncate font-mono text-xs text-slate-500">
                            {item.subjectId}
                          </p>
                          <p className="text-xs text-slate-300">
                            {t("cards", { count: item.cardCount })} ·{" "}
                            {t("karas", { count: item.karas })}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-slate-300">
                          <p>{item.sender.pseudo}</p>
                          <p className="text-xs text-slate-500">
                            → {item.recipient.pseudo}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-amber-100">
                            {t("quarantines.risk", { count: item.riskScore })}
                          </p>
                          <p className="text-xs text-slate-400">
                            {t(`quarantines.confidence.${item.confidence}`)} ·{" "}
                            {t(`quarantines.severity.${item.economicSeverity}`)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span className="rounded-full border border-violet-300/20 bg-violet-500/10 px-2 py-1 text-xs font-bold text-violet-100">
                            {t(`quarantines.statuses.${item.status}`)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-300">
                          {dateFormatter.format(new Date(item.expiresAt))}
                          {item.analysisOutcome && (
                            <p className="max-w-52 text-xs text-amber-100">
                              {t(
                                `quarantines.analysis.${item.analysisOutcome}`
                              )}
                            </p>
                          )}
                          {item.reviewDueAt && (
                            <p className="max-w-52 text-xs text-slate-400">
                              {t("quarantines.reviewDue", {
                                date: dateFormatter.format(
                                  new Date(item.reviewDueAt)
                                )
                              })}
                            </p>
                          )}
                          {item.subjectType === "trade" &&
                            ["PENDING_ANALYSIS", "AWAITING_REVIEW"].includes(
                              item.status
                            ) && (
                              <details className="mt-2 min-w-44">
                                <summary className="cursor-pointer text-cyan-200">
                                  {t("quarantines.review")}
                                </summary>
                                <dl className="mt-2 grid gap-1.5 rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">
                                  {(["sameIp", "sameBrowser"] as const).map(
                                    signal => (
                                      <div
                                        key={signal}
                                        className="flex flex-wrap justify-between gap-x-2"
                                      >
                                        <dt>
                                          {t(
                                            `quarantines.connection.${signal}`
                                          )}
                                        </dt>
                                        <dd
                                          className={
                                            item.sharedConnectionRecorded
                                              ? "font-semibold text-amber-200"
                                              : "text-slate-400"
                                          }
                                        >
                                          {t(
                                            item.sharedConnectionRecorded
                                              ? "quarantines.connection.confirmed"
                                              : "quarantines.connection.unknown"
                                          )}
                                        </dd>
                                      </div>
                                    )
                                  )}
                                </dl>
                                <form
                                  action={resolveTradeQuarantineAction}
                                  className="mt-2 grid gap-2"
                                >
                                  <input
                                    type="hidden"
                                    name="quarantine_id"
                                    value={item.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="version"
                                    value={item.version}
                                  />
                                  <textarea
                                    name="reason"
                                    aria-label={t("quarantines.reason")}
                                    placeholder={t("quarantines.reason")}
                                    required
                                    maxLength={500}
                                    className="w-full rounded border border-slate-600 bg-slate-950 p-2"
                                  />
                                  <button
                                    name="decision"
                                    value="release"
                                    className="rounded border border-cyan-400/40 p-2"
                                  >
                                    {t("quarantines.release")}
                                  </button>
                                  <button
                                    name="decision"
                                    value="cancel"
                                    className="rounded border border-rose-400/40 p-2"
                                  >
                                    {t("quarantines.cancel")}
                                  </button>
                                </form>
                              </details>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {["invalid", "failed", "saved"].includes(
              params.quarantine_result ?? ""
            ) && (
              <p role="status" className="mt-3 text-sm text-slate-300">
                {t(`quarantines.result.${params.quarantine_result}`)}
              </p>
            )}
          </section>

          <section
            id="anticheat-clusters"
            className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5"
          >
            <h2 className="text-xl font-bold text-slate-100">
              {t("clusters.title")}
            </h2>
            {clusterId && assetId && assetKind && (
              <FarmAssetPreview
                cluster={clusterId}
                asset={assetId}
                kind={assetKind}
              />
            )}
            <dl className="my-3 grid max-w-md grid-cols-2 gap-2 text-sm">
              {(["clusters", "activeQuarantines"] as const).map(key => (
                <div
                  key={key}
                  className="rounded-lg border border-slate-800 p-2"
                >
                  <dt className="text-slate-400">
                    {t(`clusters.workload.${key}`)}
                  </dt>
                  <dd className="font-semibold text-slate-100">
                    {workload[key] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
            {clusterId && (
              <Link
                href="/admin/security#anticheat-clusters"
                className="text-sm text-cyan-200"
              >
                {t("clusters.all")}
              </Link>
            )}
            {clusters.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                {t("clusters.empty")}
              </p>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {clusters.map(cluster => (
                  <article
                    key={cluster.id}
                    className="min-w-0 rounded-xl border border-slate-800 p-3"
                  >
                    <p className="font-semibold text-slate-100">
                      {t("clusters.accounts", { count: cluster.accountCount })}
                    </p>
                    <p className="text-sm text-slate-300">
                      {t(`clusters.priority.${cluster.priority}`)} ·{" "}
                      {t(`clusters.state.${cluster.state}`)}
                    </p>
                    <p className="mt-2 text-sm text-slate-400">
                      {t("clusters.activity", {
                        recent: cluster.recentAccountCount,
                        active: cluster.activeAccountCount
                      })}
                    </p>
                    <p className="text-sm text-slate-400">
                      {t("clusters.economy", {
                        trades: cluster.internalTrades,
                        referrals: cluster.referralCount,
                        cards: cluster.cards,
                        karas: cluster.karas
                      })}
                    </p>
                    {cluster.beneficiary && (
                      <p className="break-words text-sm text-slate-300">
                        {t("clusters.beneficiary", {
                          name: cluster.beneficiary
                        })}
                      </p>
                    )}
                    {cluster.farmDecision && cluster.farmConfidence && (
                      <p className="mt-2 text-sm text-amber-100">
                        {t(`clusters.farmDecision.${cluster.farmDecision}`)} ·{" "}
                        {t(`clusters.farmConfidence.${cluster.farmConfidence}`)}{" "}
                        ·{" "}
                        {t("quarantines.risk", {
                          count: cluster.farmRisk ?? 0
                        })}
                      </p>
                    )}
                    {cluster.farmReview && (
                      <p className="mt-2 text-sm text-cyan-100">
                        {t(`clusters.reviewDecision.${cluster.farmReview}`)}
                      </p>
                    )}
                    {clusterId && (
                      <form action={simulateFarmAction} className="mt-3">
                        <input
                          type="hidden"
                          name="cluster"
                          value={cluster.id}
                        />
                        <button className="yk-button min-h-11">
                          {t("clusters.dryRun")}
                        </button>
                        {cluster.enforcement && (
                          <p className="mt-2 text-sm">
                            {t(
                              `clusters.enforcement.${cluster.enforcement.decision}`
                            )}{" "}
                            ·{" "}
                            {t("clusters.accounts", {
                              count:
                                cluster.enforcement.secondaries?.length ?? 0
                            })}
                          </p>
                        )}
                      </form>
                    )}
                    {cluster.farmEvidence && (
                      <div className="mt-2 rounded border border-slate-800 p-2 text-sm text-slate-300">
                        {t("clusters.traceSummary", {
                          indirect: cluster.farmEvidence.indirectCards ?? 0,
                          cycles: cluster.farmEvidence.cycleCards ?? 0,
                          sales: cluster.farmEvidence.auctionSales ?? 0
                        })}
                        {Object.entries(
                          cluster.farmEvidence.scenarioFindings ?? {}
                        ).map(([key, finding]) => (
                          <div
                            key={key}
                            className="mt-2 rounded border border-slate-800 p-2"
                          >
                            <p className="font-semibold">
                              {t(`clusters.scenarios.${key}`)}
                            </p>
                            <p>
                              {t(
                                `clusters.farmConfidence.${finding.confidence}`
                              )}{" "}
                              ·{" "}
                              {t("quarantines.risk", { count: finding.score })}
                            </p>
                            <p>
                              {t("clusters.accounts", {
                                count: finding.secondaries.length
                              })}
                            </p>
                            {finding.cards !== undefined && (
                              <p>{t("cards", { count: finding.cards })}</p>
                            )}
                            {finding.netKaras !== undefined && (
                              <p>{t("karas", { count: finding.netKaras })}</p>
                            )}
                          </div>
                        ))}
                        {(cluster.farmEvidence.proofs ?? []).map(proof => (
                          <div
                            key={proof.edge}
                            className="mt-2 break-all text-xs"
                          >
                            <p>
                              {t("clusters.tracedCard", { id: proof.card })}
                            </p>
                            <p>
                              {proof.path
                                .map(
                                  id =>
                                    cluster.members.find(
                                      member => member.id === id
                                    )?.pseudo ?? id
                                )
                                .join(" → ")}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {clusterId && farmRecovery && (
                      <details className="mt-3 rounded-lg border border-slate-800 p-3 text-sm text-slate-200">
                        <summary className="cursor-pointer font-semibold">
                          {t("clusters.recoveryTitle")}
                        </summary>
                        <p className="mt-2">
                          {t("clusters.recoveryAssets", {
                            packs: farmRecovery.unusedPacks,
                            available: farmRecovery.availableCards,
                            attributed: farmRecovery.attributedCards,
                            blocked: farmRecovery.blockedCards,
                            protected: farmRecovery.protectedCards
                          })}
                        </p>
                        <p>
                          {t("clusters.recoveryKaras", {
                            credited: farmRecovery.creditedKaras,
                            possible: farmRecovery.possibleKaras
                          })}
                        </p>
                        {farmRecovery.recoveryEnabled &&
                          cluster.farmReview === "CONFIRMED" &&
                          cluster.farmVersion &&
                          (farmRecovery.referredLots ?? []).map(lot => (
                            <form
                              key={lot.id}
                              action={recoverUnusedReferralLotAction}
                              className="mt-2 grid gap-2 rounded border border-slate-700 p-2"
                            >
                              <input
                                type="hidden"
                                name="cluster"
                                value={cluster.id}
                              />
                              <input type="hidden" name="lot" value={lot.id} />
                              <input
                                type="hidden"
                                name="version"
                                value={cluster.farmVersion ?? undefined}
                              />
                              <input
                                type="hidden"
                                name="packs"
                                value={lot.packs}
                              />
                              <textarea
                                name="reason"
                                aria-label={t("quarantines.reason")}
                                placeholder={t("quarantines.reason")}
                                required
                                minLength={10}
                                maxLength={500}
                                className="yk-field-control w-full"
                              />
                              <button className="yk-button min-h-11">
                                {t("clusters.recoverUnusedLot", {
                                  packs: lot.packs,
                                  name:
                                    cluster.members.find(
                                      member => member.id === lot.owner
                                    )?.pseudo ?? lot.owner
                                })}
                              </button>
                            </form>
                          ))}
                        {(farmRecovery.cards ?? [])
                          .filter(
                            card => card.state === "HELD_BY_INVOLVED_ACCOUNT"
                          )
                          .map(card => (
                            <Link
                              key={card.card_instance_id}
                              className="mt-1 block break-all text-cyan-200 underline"
                              href={`/admin/security?cluster=${cluster.id}&asset_kind=CARD&asset=${card.card_instance_id}#farm-asset-preview`}
                            >
                              {t("clusters.tracedCard", {
                                id: card.card_instance_id
                              })}
                            </Link>
                          ))}
                        {farmRecovery.recoveryEnabled &&
                          (farmRecovery.pendingRewards ?? []).map(reward => (
                            <form
                              key={reward.id}
                              action={cancelPendingReferralRewardAction}
                              className="mt-3 grid gap-2"
                            >
                              <input
                                type="hidden"
                                name="cluster"
                                value={cluster.id}
                              />
                              <input
                                type="hidden"
                                name="version"
                                value={cluster.farmVersion ?? ""}
                              />
                              <input
                                type="hidden"
                                name="referral"
                                value={reward.id}
                              />
                              <p className="break-words text-sm">
                                {t("clusters.pendingReward", {
                                  packs: reward.packs,
                                  name:
                                    cluster.members.find(
                                      member => member.id === reward.recipient
                                    )?.pseudo ?? reward.recipient
                                })}
                              </p>
                              <textarea
                                name="reason"
                                minLength={10}
                                maxLength={500}
                                required
                                className="yk-field-control w-full"
                                aria-label={t("quarantines.reason")}
                                placeholder={t("quarantines.reason")}
                              />
                              <button className="yk-button min-h-11">
                                {t("clusters.cancelReward")}
                              </button>
                            </form>
                          ))}
                        {farmRecovery.sales.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {farmRecovery.sales.map(sale => (
                              <li key={sale.id} className="break-all">
                                <Link
                                  className="text-cyan-200 underline"
                                  href={`/admin/security?cluster=${cluster.id}&asset_kind=SALE&asset=${sale.id}#farm-asset-preview`}
                                >
                                  {t("clusters.recoverySale", {
                                    id: sale.id,
                                    karas: sale.sale_karas
                                  })}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                        {cluster.farmReview === "CONFIRMED" && (
                          <ul className="mt-2 space-y-1">
                            {farmRecovery.secondaries.map(id => (
                              <li key={id} className="[overflow-wrap:anywhere]">
                                <Link
                                  className="text-cyan-200 underline"
                                  href={`/admin/security?sanction=${id}&primary=${farmRecovery.beneficiary}&role=smurf#sanction-preview`}
                                >
                                  {t("clusters.previewPair", {
                                    name:
                                      cluster.members.find(
                                        member => member.id === id
                                      )?.pseudo ?? id
                                  })}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    )}
                    {clusterId ? (
                      <ul className="mt-2 space-y-1 text-sm text-slate-300">
                        {cluster.members.map(member => (
                          <li key={member.id} className="break-words">
                            <Link
                              href={`/admin/security?user=${member.id}`}
                              className="text-cyan-200"
                            >
                              {member.pseudo ?? member.id}
                            </Link>
                            {" · "}
                            {member.createdAt &&
                              dateFormatter.format(new Date(member.createdAt))}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Link
                        href={`/admin/security?cluster=${cluster.id}#anticheat-clusters`}
                        className="mt-2 inline-block text-sm text-cyan-200"
                      >
                        {t("clusters.review")}
                      </Link>
                    )}
                    {clusterId &&
                      cluster.farmVersion &&
                      !cluster.farmReview && (
                        <form
                          action={reviewAnticheatFarmAction}
                          className="mt-3 grid gap-2"
                        >
                          <input
                            type="hidden"
                            name="cluster_id"
                            value={cluster.id}
                          />
                          <input
                            type="hidden"
                            name="version"
                            value={cluster.farmVersion}
                          />
                          <textarea
                            name="reason"
                            aria-label={t("quarantines.reason")}
                            placeholder={t("quarantines.reason")}
                            required
                            minLength={10}
                            maxLength={500}
                            className="w-full rounded border border-slate-600 bg-slate-950 p-2"
                          />
                          {cluster.farmDecision ===
                            "ECONOMICALLY_CONFIRMED" && (
                            <button
                              name="decision"
                              value="CONFIRMED"
                              className="rounded border border-cyan-400/40 p-2"
                            >
                              {t("clusters.confirm")}
                            </button>
                          )}
                          <button
                            name="decision"
                            value="DISMISSED"
                            className="rounded border border-slate-600 p-2"
                          >
                            {t("clusters.dismiss")}
                          </button>
                        </form>
                      )}
                  </article>
                ))}
              </div>
            )}
            {["invalid", "failed", "saved"].includes(
              params.farm_result ?? ""
            ) && (
              <p role="status" className="mt-3 text-sm text-slate-300">
                {t(`clusters.reviewResult.${params.farm_result}`)}
              </p>
            )}
          </section>

          <SanctionAppeals result={params.appeal_result} />

          <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5">
            <form
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_auto_auto]"
              method="get"
            >
              <input
                aria-label={t("searchLabel")}
                className="yk-field-control min-w-0 sm:col-span-2 xl:col-span-1"
                defaultValue={query}
                maxLength={100}
                name="q"
                placeholder={t("searchPlaceholder")}
              />
              <select
                aria-label={t("severityLabel")}
                className="yk-field-control min-w-0"
                defaultValue={severity}
                name="severity"
              >
                <option value="">{t("allSeverities")}</option>
                {["watch", "elevated", "high", "critical"].map(item => (
                  <option key={item} value={item}>
                    {t(`severities.${item}`)}
                  </option>
                ))}
              </select>
              <button className="yk-button" type="submit">
                {t("filter")}
              </button>
              {(query || severity || eventType || userId) && (
                <Link
                  className="yk-button yk-button-secondary text-center"
                  href="/admin/security"
                >
                  {t("clear")}
                </Link>
              )}
            </form>
          </section>

          {sanctionUserId && (
            <section className="min-w-0 rounded-2xl border border-red-300/30 bg-red-950/15 p-4 [overflow-wrap:anywhere] sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-300">
                    {t("sanctionEyebrow")}
                  </p>
                  <h2 className="mt-1 text-xl font-black">
                    {t("sanctionTitle")}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-slate-300">
                    {t("sanctionHelp")}
                  </p>
                </div>
                <Link
                  className="yk-button yk-button-secondary text-center"
                  href="/admin/security"
                >
                  {t("cancelSanction")}
                </Link>
              </div>

              <div className="mt-4 space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
                <p className="text-sm font-semibold text-slate-200">
                  {t("caseAccountRole")}
                </p>
                {roleIsExplicit ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-bold text-cyan-100">
                      {t(caseIsPrimary ? "caseIsPrimary" : "caseIsSmurf")}
                    </span>
                    <Link
                      className="inline-flex min-h-11 items-center text-xs text-slate-400 underline underline-offset-4"
                      href={`/admin/security?sanction=${sanctionUserId}&role=${caseIsPrimary ? "smurf" : "primary"}`}
                    >
                      {t("switchCaseRole")}
                    </Link>
                  </div>
                ) : (
                  <div
                    role="alert"
                    className="space-y-3 text-sm text-amber-100"
                  >
                    <p>{t("explicitRolesRequired")}</p>
                    <div className="flex flex-wrap gap-3">
                      {(["primary", "smurf"] as const).map(role => (
                        <Link
                          key={role}
                          className="yk-button yk-button-secondary min-h-11 whitespace-normal"
                          href={`/admin/security?sanction=${sanctionUserId}${primaryUserId ? `&primary=${primaryUserId}` : ""}&role=${role}`}
                        >
                          {t(
                            role === "primary"
                              ? "chooseCasePrimary"
                              : "chooseCaseSmurf"
                          )}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {relatedData && (
                <RelatedAccountPicker
                  subjectId={sanctionUserId}
                  role={
                    roleIsExplicit ? (caseIsPrimary ? "primary" : "smurf") : ""
                  }
                  data={relatedData}
                  query={linkedQuery}
                  status={linkedStatus}
                  page={linkedPage}
                  selected={selectedDeletedAccounts}
                  activeId={primaryUserId}
                  targetLabel={
                    roleIsExplicit
                      ? t(caseIsPrimary ? "smurfAccount" : "primaryAccount")
                      : t("relatedAccounts.rolePending")
                  }
                />
              )}

              {deletedRecovery ? (
                <div className="mt-4 space-y-4">
                  <DeletedAccountHistory
                    primaryId={sanctionUserId}
                    showPicker={false}
                    preview={deletedAccountPreview}
                    selected={selectedDeletedAccounts}
                    query={deletedQuery}
                    relatedOnly={deletedRelatedOnly}
                    page={deletedPage}
                    applied={params.result === "deleted-accounts-applied"}
                  />
                  {deletedRecovery.candidateCount > 0 && (
                    <details className="rounded-xl border border-slate-700 p-3">
                      <summary className="min-h-11 cursor-pointer text-sm font-bold">
                        {t("unidentifiedLegacyTransfers")}
                      </summary>
                      <DeletedSmurfRecovery
                        data={deletedRecovery}
                        applied={params.result === "deleted-smurf-recovered"}
                        embedded
                      />
                    </details>
                  )}
                </div>
              ) : (
                <>
                  {sanctionPreview && (
                    <div
                      id="sanction-preview"
                      className="mt-5 grid min-w-0 gap-4 scroll-mt-28 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]"
                    >
                      <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                        <h3 className="font-black">
                          {t("sanctionPair", {
                            smurf: sanctionPreview.smurf.pseudo,
                            primary: sanctionPreview.primary.pseudo
                          })}
                        </h3>
                        <SanctionQuarantineConflicts
                          conflicts={
                            sanctionPreview.recovery.quarantineConflicts
                          }
                        />
                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-slate-400">
                              {t("sharedNetworkEvidence")}
                            </dt>
                            <dd className="font-bold">
                              {sanctionPreview.evidence.sharedNetwork
                                ? t("confirmed")
                                : t("notObserved")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-400">
                              {t("sharedDeviceEvidence")}
                            </dt>
                            <dd className="font-bold">
                              {sanctionPreview.evidence.sharedDevice
                                ? t("confirmed")
                                : t("notObserved")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-400">
                              {t("acceptedTradesEvidence")}
                            </dt>
                            <dd className="font-bold">
                              {sanctionPreview.evidence.acceptedTrades}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-400">
                              {t(
                                sanctionPreview.receipt
                                  ? "assetsAlreadyRecovered"
                                  : "assetsToRecover"
                              )}
                            </dt>
                            <dd className="font-bold">
                              {t("assetRecovery", {
                                cards: sanctionPreview.recovery.cards,
                                karas: sanctionPreview.recovery.karas
                              })}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-400">
                              {t("saleHistoryEvidence")}
                            </dt>
                            <dd className="font-bold">
                              {t("saleRecovery", {
                                count: sanctionPreview.recovery.saleCount,
                                karas: sanctionPreview.recovery.saleKaras
                              })}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-400">
                              {t("directKaraEvidence")}
                            </dt>
                            <dd className="font-bold">
                              {t("karas", {
                                count: sanctionPreview.recovery.tradeKaras
                              })}
                            </dd>
                          </div>
                        </dl>
                        <details className="mt-4 rounded-lg border border-slate-700 p-3 text-sm">
                          <summary className="cursor-pointer font-bold text-slate-100">
                            {t("pairHistory")}
                          </summary>
                          <div className="mt-3 max-h-96 space-y-3 overflow-y-auto [overflow-wrap:anywhere]">
                            {sanctionPreview.receipt && (
                              <p className="rounded-lg bg-emerald-500/10 p-3 text-emerald-100">
                                {t("receiptRecorded", {
                                  date: dateFormatter.format(
                                    new Date(sanctionPreview.receipt.appliedAt)
                                  )
                                })}
                                <span className="mt-1 block">
                                  {sanctionPreview.receipt.note}
                                </span>
                                <span className="mt-2 block font-bold">
                                  {t("receiptOutcome", {
                                    smurf: sanctionPreview.smurf.pseudo,
                                    primary: sanctionPreview.primary.pseudo,
                                    cards:
                                      sanctionPreview.receipt.recovery.cards,
                                    karas:
                                      sanctionPreview.receipt.recovery.karas
                                  })}
                                </span>
                                {sanctionPreview.receipt.recovery.cards === 0 &&
                                  sanctionPreview.receipt.recovery.karas ===
                                    0 && (
                                    <span className="mt-2 block text-amber-100">
                                      {t("receiptNoRecovery")}
                                    </span>
                                  )}
                                <span className="mt-2 block">
                                  {t(
                                    sanctionPreview.smurf.banned
                                      ? "currentlyBanned"
                                      : "currentlyNotBanned",
                                    { player: sanctionPreview.smurf.pseudo }
                                  )}
                                </span>
                              </p>
                            )}
                            {(
                              sanctionPreview.receipt?.history ??
                              sanctionPreview.history
                            ).trades.map(trade => (
                              <article
                                className="rounded-lg bg-slate-900 p-3"
                                key={trade.id}
                              >
                                <p className="font-semibold">
                                  {t("historyTrade", {
                                    date: dateFormatter.format(
                                      new Date(trade.acceptedAt)
                                    )
                                  })}
                                </p>
                                <p className="mt-1 text-slate-300">
                                  {t("historyTransfer", {
                                    from:
                                      trade.fromUser ===
                                      sanctionPreview.smurf.userId
                                        ? sanctionPreview.smurf.pseudo
                                        : sanctionPreview.primary.pseudo,
                                    to:
                                      trade.toUser ===
                                      sanctionPreview.primary.userId
                                        ? sanctionPreview.primary.pseudo
                                        : sanctionPreview.smurf.pseudo,
                                    cards: trade.offeredCards.length,
                                    karas: trade.offeredKaras
                                  })}
                                </p>
                                <p className="text-slate-300">
                                  {t("historyTransfer", {
                                    from:
                                      trade.toUser ===
                                      sanctionPreview.smurf.userId
                                        ? sanctionPreview.smurf.pseudo
                                        : sanctionPreview.primary.pseudo,
                                    to:
                                      trade.fromUser ===
                                      sanctionPreview.primary.userId
                                        ? sanctionPreview.primary.pseudo
                                        : sanctionPreview.smurf.pseudo,
                                    cards: trade.requestedCards.length,
                                    karas: trade.requestedKaras
                                  })}
                                </p>
                                <p className="mt-1 font-mono text-xs text-slate-400">
                                  {trade.id}
                                </p>
                                {[
                                  ...trade.offeredCards,
                                  ...trade.requestedCards
                                ].map(id => (
                                  <p
                                    className="text-sm text-slate-200"
                                    key={id}
                                  >
                                    {sanctionPreview.cardLabels[id]?.name ??
                                      t("unknownCardName")}
                                  </p>
                                ))}
                              </article>
                            ))}
                            {(
                              sanctionPreview.receipt?.history ??
                              sanctionPreview.history
                            ).sales.map(sale => (
                              <article
                                className="rounded-lg bg-slate-900 p-3"
                                key={sale.id}
                              >
                                <p className="font-semibold">
                                  {t("historySale", {
                                    date: dateFormatter.format(
                                      new Date(sale.createdAt)
                                    ),
                                    karas: sale.karas
                                  })}
                                </p>
                                <p className="mt-1 font-mono text-xs text-slate-400">
                                  {sale.id}
                                </p>
                                <p className="text-sm text-slate-200">
                                  {sanctionPreview.cardLabels[
                                    sale.cardInstanceId
                                  ]?.name ?? t("unknownCardName")}
                                </p>
                              </article>
                            ))}
                          </div>
                        </details>
                        {(sanctionPreview.recovery.blockedCards > 0 ||
                          sanctionPreview.recovery.cardsNoLongerOnPrimary >
                            0) && (
                          <p className="mt-4 rounded-lg border border-amber-300/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                            {t("recoveryWarnings", {
                              blocked: sanctionPreview.recovery.blockedCards,
                              moved:
                                sanctionPreview.recovery.cardsNoLongerOnPrimary
                            })}
                          </p>
                        )}
                      </div>

                      <form
                        action={applySmurfSanctionAction}
                        className="rounded-xl border border-red-300/30 bg-slate-950/70 p-4"
                      >
                        <input
                          name="smurf_user_id"
                          type="hidden"
                          value={sanctionPreview.smurf.userId}
                        />
                        <input
                          name="primary_user_id"
                          type="hidden"
                          value={sanctionPreview.primary.userId}
                        />
                        <input
                          type="hidden"
                          name="preview_token"
                          value={sanctionPreview.previewToken}
                        />
                        <label className="grid gap-1 text-sm font-semibold text-slate-200">
                          {t("sanctionNote")}
                          <textarea
                            className="yk-field-control min-h-24 resize-y"
                            maxLength={2000}
                            minLength={10}
                            name="note"
                            placeholder={t("sanctionNotePlaceholder")}
                            required
                          />
                        </label>
                        <label className="mt-3 flex items-start gap-3 text-sm text-slate-200">
                          <input
                            className="mt-1 size-4 shrink-0"
                            name="confirmation"
                            required
                            type="checkbox"
                            value={`${sanctionPreview.smurf.userId}:${sanctionPreview.primary.userId}`}
                            disabled={!roleIsExplicit}
                          />
                          <span>
                            {t(
                              sanctionPreview.recovery.cards === 0 &&
                                sanctionPreview.recovery.karas === 0
                                ? "confirmBanOnly"
                                : "confirmNamedRecovery",
                              {
                                smurf: sanctionPreview.smurf.pseudo,
                                primary: sanctionPreview.primary.pseudo,
                                cards: sanctionPreview.recovery.cards,
                                karas: sanctionPreview.recovery.karas
                              }
                            )}
                          </span>
                        </label>
                        {!sanctionPreview.eligible && (
                          <p className="mt-3 text-sm font-semibold text-amber-200">
                            {t("sanctionNotEligible")}
                          </p>
                        )}
                        <button
                          className="mt-4 min-h-11 w-full rounded-xl border border-red-300/50 bg-red-500/20 px-4 py-2 font-black text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={
                            !sanctionPreview.eligible || !roleIsExplicit
                          }
                          type="submit"
                        >
                          {t(
                            sanctionPreview.recovery.cards === 0 &&
                              sanctionPreview.recovery.karas === 0
                              ? "applyBanOnly"
                              : "applySanction"
                          )}
                        </button>
                      </form>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
            <section className="min-w-0" id="anticheat-cases" tabIndex={0}>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">{t("casesTitle")}</h2>
                  <p className="text-sm text-slate-400">{t("casesHelp")}</p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-sm text-slate-500">
                  {t("caseCount", { count: total })}
                </span>
              </div>
              <div className="space-y-3">
                {cases.length === 0 ? (
                  <p className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
                    {t("noCases")}
                  </p>
                ) : (
                  cases.map(item => (
                    <article
                      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-cyan-300/30 sm:p-5"
                      key={item.userId}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="min-w-0 text-lg font-black [overflow-wrap:anywhere]">
                              {item.accountState?.pseudo ??
                                (item.accountState?.deleted
                                  ? t("deletedPlayer")
                                  : item.pseudo)}
                            </h3>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs font-bold ${
                                item.severity === "critical"
                                  ? "border-red-400/50 bg-red-500/15 text-red-200"
                                  : item.severity === "high"
                                    ? "border-orange-400/50 bg-orange-500/15 text-orange-200"
                                    : item.severity === "elevated"
                                      ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
                                      : "border-sky-400/40 bg-sky-500/10 text-sky-200"
                              }`}
                            >
                              {t(`severities.${item.severity}`)}
                            </span>
                            <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-xs font-semibold text-slate-300">
                              {t(`statuses.${item.status}`)}
                            </span>
                            <AccountStatus state={item.accountState} />
                          </div>
                          <p className="text-sm text-slate-400 [overflow-wrap:anywhere]">
                            {item.email}
                          </p>
                        </div>
                        <div className="shrink-0 sm:text-right">
                          <p className="text-2xl font-black text-cyan-100">
                            {item.score}
                          </p>
                          <p className="text-xs text-slate-500">
                            {t("riskPoints")}
                          </p>
                        </div>
                      </div>
                      {!!connections[item.userId]?.count && (
                        <details className="mt-4 rounded-xl border border-slate-700 bg-slate-950/45 p-3">
                          <summary className="cursor-pointer text-sm font-bold text-cyan-100">
                            {t("connectionsSummary", {
                              count: connections[item.userId].count
                            })}
                          </summary>
                          <p className="mt-2 text-xs leading-relaxed text-slate-400">
                            {t("connectionsHelp")}
                          </p>
                          <ul className="mt-3 space-y-2">
                            {connections[item.userId].accounts.map(account => (
                              <li
                                key={account.userId}
                                className="min-w-0 rounded-lg bg-slate-900/80 p-3 text-sm [overflow-wrap:anywhere]"
                              >
                                {account.deleted ? (
                                  <span className="font-bold">
                                    {account.accountState?.pseudo ??
                                      account.pseudo ??
                                      t("deletedPlayer")}
                                  </span>
                                ) : (
                                  <Link
                                    href={`/profile/${account.userId}`}
                                    className="font-bold text-cyan-100 underline underline-offset-4"
                                  >
                                    {account.pseudo}
                                  </Link>
                                )}
                                <div className="mt-1">
                                  <AccountStatus state={account.accountState} />
                                </div>
                                <p className="mt-1 text-xs text-slate-400">
                                  {t("connectionLastSeen", {
                                    date: dateFormatter.format(
                                      new Date(account.lastSharedAt)
                                    )
                                  })}
                                </p>
                                <p className="mt-1 text-xs text-slate-300">
                                  {account.sharedBrowser
                                    ? t("browserAlsoShared")
                                    : t("browserNotConfirmed")}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {t("connectionTrades", {
                                    count: account.acceptedTrades
                                  })}
                                </p>
                              </li>
                            ))}
                          </ul>
                          {connections[item.userId].count >
                            connections[item.userId].accounts.length && (
                            <p className="mt-2 text-xs text-slate-400">
                              {t("connectionsLimited", {
                                count: connections[item.userId].accounts.length,
                                total: connections[item.userId].count
                              })}
                            </p>
                          )}
                        </details>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.reasonCodes.map(code => (
                          <span
                            className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300"
                            key={code}
                          >
                            {reasonKeys[code]
                              ? t(`reasons.${reasonKeys[code]}`)
                              : code}
                          </span>
                        ))}
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 text-sm sm:grid-cols-4">
                        <div>
                          <dt className="text-slate-500">{t("eventsCount")}</dt>
                          <dd className="font-semibold">{item.eventCount}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">
                            {t("economicLinkedAccounts")}
                          </dt>
                          <dd className="font-semibold">
                            {item.economicLinkedAccounts}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">
                            {t("networkLinkedAccounts")}
                          </dt>
                          <dd className="font-semibold">
                            {item.networkLinkedAccounts}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">{t("lastSignal")}</dt>
                          <dd className="font-semibold">
                            {dateFormatter.format(new Date(item.lastFlaggedAt))}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          className="yk-button yk-button-secondary"
                          href={`/admin/players?player=${item.userId}`}
                        >
                          {t("openPlayer")}
                        </Link>
                        <Link
                          className="yk-button yk-button-secondary"
                          href={`/admin/security?${new URLSearchParams({ ...Object.fromEntries(baseParams), user: item.userId })}`}
                        >
                          {t("showEvents")}
                        </Link>
                        <Link
                          className="yk-button yk-button-secondary"
                          href={`/admin/security?sanction=${item.userId}&role=primary`}
                        >
                          {t("prepareSanction")}
                        </Link>
                      </div>
                      <details className="mt-4 rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <summary className="cursor-pointer font-semibold text-cyan-200">
                          {t("reviewCase")}
                        </summary>
                        {item.latestReview && (
                          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-sm">
                            <p className="font-semibold text-slate-200">
                              {t("latestReview", {
                                admin: item.latestReview.adminPseudo,
                                status: t(
                                  `statuses.${item.latestReview.decision}`
                                )
                              })}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-slate-400 [overflow-wrap:anywhere]">
                              {item.latestReview.note}
                            </p>
                          </div>
                        )}
                        <form
                          action={reviewAnticheatCaseAction}
                          className="mt-3 grid gap-3"
                        >
                          <input
                            name="user_id"
                            type="hidden"
                            value={item.userId}
                          />
                          <label className="grid gap-1 text-sm font-semibold text-slate-300">
                            {t("reviewNote")}
                            <textarea
                              className="yk-field-control min-h-24 resize-y"
                              maxLength={2000}
                              minLength={5}
                              name="note"
                              placeholder={t("reviewNotePlaceholder")}
                              required
                            />
                          </label>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <button
                              className="yk-button yk-button-secondary"
                              name="status"
                              type="submit"
                              value="open"
                            >
                              {t("markOpen")}
                            </button>
                            <button
                              className="yk-button yk-button-secondary"
                              name="status"
                              type="submit"
                              value="reviewed"
                            >
                              {t("markReviewed")}
                            </button>
                            <button
                              className="yk-button yk-button-secondary"
                              name="status"
                              type="submit"
                              value="dismissed"
                            >
                              {t("dismissCase")}
                            </button>
                          </div>
                        </form>
                      </details>
                    </article>
                  ))
                )}
              </div>
              <UrlPagination
                page={page}
                pageCount={pages}
                scrollTargetId="anticheat-cases"
              />
            </section>

            <aside className="min-w-0 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5 xl:sticky xl:top-24">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">{t("eventsTitle")}</h2>
                  <p className="text-sm text-slate-400">{t("eventsHelp")}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">
                  {Number(eventPayload.total ?? 0)}
                </span>
              </div>
              {userId && (
                <Link
                  className="mt-3 inline-flex text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                  href={`/admin/security?${allPlayersParams}`}
                >
                  {t("removePlayerFilter")}
                </Link>
              )}
              <div className="mt-4 max-h-[48rem] space-y-3 overflow-y-auto pr-1">
                {events.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    {t("noEvents")}
                  </p>
                ) : (
                  events.map(event => {
                    const points = event.subjects.reduce(
                      (sum, subject) => sum + subject.riskPoints,
                      0
                    );
                    const eventReasons = [
                      ...new Set(
                        event.subjects.flatMap(subject => subject.reasonCodes)
                      )
                    ];
                    return (
                      <details
                        className="rounded-xl border border-slate-800 bg-slate-950/65 p-3"
                        key={event.id}
                        name="anticheat-event"
                      >
                        <summary className="min-h-11 cursor-pointer list-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-bold text-slate-100">
                              {t(`events.${eventKeys[event.type]}`)}
                            </h3>
                            {points > 0 && (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-200">
                                +{points}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 space-y-1 text-sm text-slate-300 [overflow-wrap:anywhere]">
                            {[event.actor, event.counterparty]
                              .filter(
                                (party): party is NonNullable<EventParty> =>
                                  !!party
                              )
                              .map((party, index) => (
                                <div
                                  key={`${party.id}:${index}`}
                                  className="flex flex-wrap items-center gap-2"
                                >
                                  <span>
                                    {index > 0 && (
                                      <span aria-hidden="true">→ </span>
                                    )}
                                    {party.accountState?.pseudo ??
                                      (party.accountState?.deleted
                                        ? t("deletedPlayer")
                                        : party.pseudo)}
                                  </span>
                                  <AccountStatus
                                    state={
                                      party.accountState
                                        ? {
                                            ...party.accountState,
                                            sanctionApplied: false
                                          }
                                        : undefined
                                    }
                                  />
                                </div>
                              ))}
                            {event.sanctionApplied && (
                              <AccountStatus
                                state={{
                                  deleted: false,
                                  banned: false,
                                  sanctionApplied: true
                                }}
                              />
                            )}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {dateFormatter.format(new Date(event.occurredAt))}
                            {event.cardCount > 0
                              ? ` · ${t("cards", { count: event.cardCount })}`
                              : ""}
                            {event.amount > 0
                              ? ` · ${t("karas", { count: event.amount })}`
                              : ""}
                          </p>
                          {eventReasons.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {eventReasons.map(code => (
                                <span
                                  className="rounded-md bg-amber-500/10 px-1.5 py-1 text-[0.68rem] font-semibold text-amber-100"
                                  key={code}
                                >
                                  {reasonKeys[code]
                                    ? t(`reasons.${reasonKeys[code]}`)
                                    : code}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="mt-2 text-xs font-semibold text-cyan-200">
                            {t("openEventDetails")}
                          </p>
                        </summary>
                        <div className="mt-3">
                          <EventDetail detail={event.detail} />
                        </div>
                      </details>
                    );
                  })
                )}
              </div>
            </aside>
          </div>

          <p className="rounded-xl border border-sky-300/15 bg-sky-500/5 p-4 text-sm text-sky-100/80">
            {t("observationNotice")}
          </p>
        </div>
      </main>
    </div>
  );
}
