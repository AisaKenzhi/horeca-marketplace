/**
 * Application store and configuration.
 *
 * Holds the in-browser repository, the current demo persona (session), locale
 * and the staleness config. The "session" here is a DEMO persona switch, not
 * real authentication.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSyncExternalStore } from "react";
import {
  buildInitialState,
  Repository,
  type RepositoryState,
  type SessionContext,
} from "@/data/repository";
import {
  baskets as seedBaskets,
  buyerLocations,
  buyerLists,
  memberships,
  notifications,
  offers,
  organizations,
  products,
  suppliers,
  DEMO_NOW,
} from "@/data/seed";
import type { Membership } from "@/domain/entities";
import { DEFAULT_FRESHNESS_CONFIG, type FreshnessConfig } from "@/domain/freshness";
import { defaultLocale, getMessages, type Locale, type Messages } from "@/app/i18n";

export interface AppConfig {
  readonly freshness: FreshnessConfig;
  readonly locale: Locale;
  /** ISO "now" for the demo. Kept fixed so freshness badges are stable. */
  readonly demoNow: string;
}

function readConfig(): AppConfig {
  const hours = Number(import.meta.env.VITE_STALENESS_HOURS ?? "24");
  return {
    freshness: {
      stalenessHours:
        Number.isFinite(hours) && hours > 0
          ? hours
          : DEFAULT_FRESHNESS_CONFIG.stalenessHours,
    },
    locale: defaultLocale(),
    demoNow: DEMO_NOW,
  };
}

export function createRepository(): Repository {
  return new Repository(
    buildInitialState({
      organizations,
      buyerLocations,
      memberships,
      suppliers,
      products,
      offers,
      buyerLists,
      baskets: seedBaskets,
      notifications,
    }),
  );
}

interface AppContextValue {
  readonly repo: Repository;
  readonly state: RepositoryState;
  readonly config: AppConfig;
  readonly messages: Messages;
  readonly session: SessionContext;
  readonly membership: Membership;
  readonly allMemberships: readonly Membership[];
  setMembership: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  repository,
}: {
  children: ReactNode;
  repository?: Repository;
}) {
  const repo = useMemo(() => repository ?? createRepository(), [repository]);
  const config = useMemo(readConfig, []);
  const [membershipId, setMembershipId] = useState<string>(memberships[0]!.id as string);

  const state = useSyncExternalStore(
    useCallback((cb: () => void) => repo.subscribe(cb), [repo]),
    useCallback(() => repo.getState(), [repo]),
  );

  const membership = useMemo(
    () => state.memberships.find((m) => m.id === membershipId) ?? memberships[0]!,
    [state.memberships, membershipId],
  );

  const session: SessionContext = useMemo(
    () => ({ membership, nowIso: config.demoNow }),
    [membership, config.demoNow],
  );

  const value: AppContextValue = useMemo(
    () => ({
      repo,
      state,
      config,
      messages: getMessages(config.locale),
      session,
      membership,
      allMemberships: state.memberships,
      setMembership: setMembershipId,
    }),
    [repo, state, config, session, membership],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
