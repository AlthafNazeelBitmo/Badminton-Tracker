'use client';

import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr';
import { useCallback, useMemo, useState } from 'react';
import type {
  AchievementView,
  AnalyticsFilter,
  AuthenticatedUser,
  DisciplineBreakdown,
  FatigueResponse,
  GoalProgress,
  HeatmapResponse,
  Insight,
  MatchDetail,
  MatchSummary,
  OpponentBreakdown,
  OverviewResponse,
  Paginated,
  PartnerBreakdown,
  PerformanceReport,
  PersonalRecord,
  PlayerSummary,
  RatingHistoryPoint,
  SessionSummary,
  SituationalResponse,
  TagCorrelation,
  TrendResponse,
  VenueBreakdown,
  VenueSummary,
} from '@badminton/contracts';
import { ApiError, api, buildQuery } from './api';
import { browserTimeZone } from './format';

const fetcher = <T>(path: string) => api.get<T>(path);

/** Analytics responses are stable within a page view; refetching on focus is noise. */
const analyticsConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  keepPreviousData: true,
};

export function useSession() {
  const { data, error, isLoading, mutate } = useSWR<{ user: AuthenticatedUser }>(
    '/auth/me',
    fetcher,
    {
      // A 401 here is the normal signed-out state, not a transient failure to retry.
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    },
  );

  return {
    user: data?.user ?? null,
    isLoading,
    isSignedOut: error instanceof ApiError && error.isUnauthorized,
    error: error instanceof ApiError && error.isUnauthorized ? null : (error as Error | undefined),
    refresh: mutate,
  };
}

/**
 * The global analytics filter, held in component state and turned into the query string
 * every analytics endpoint accepts. The time zone is always the browser's, so "this
 * month" means the user's month rather than the server's.
 */
export type FilterState = Pick<
  AnalyticsFilter,
  'preset' | 'discipline' | 'sessionType' | 'venueId' | 'opponentId' | 'partnerId' | 'result'
> & { from?: string; to?: string };

export const DEFAULT_FILTER: FilterState = { preset: 'ALL_TIME' };

export function useFilterState(initial: FilterState = DEFAULT_FILTER) {
  const [filter, setFilter] = useState<FilterState>(initial);

  const query = useMemo(() => {
    return buildQuery({
      preset: filter.preset,
      from: filter.from,
      to: filter.to,
      discipline: filter.discipline,
      sessionType: filter.sessionType,
      venueId: filter.venueId,
      opponentId: filter.opponentId,
      partnerId: filter.partnerId,
      result: filter.result,
      timeZone: browserTimeZone(),
    });
  }, [filter]);

  const update = useCallback((patch: Partial<FilterState>) => {
    setFilter((current) => ({ ...current, ...patch }));
  }, []);

  const reset = useCallback(() => setFilter(initial), [initial]);

  return { filter, setFilter, update, reset, query };
}

// --- Analytics -------------------------------------------------------------

export const useOverview = (query: string) =>
  useSWR<OverviewResponse>(`/analytics/overview${query}`, fetcher, analyticsConfig);

export const useTrend = (query: string, granularity: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR') =>
  useSWR<TrendResponse>(
    `/analytics/trend${query}${query ? '&' : '?'}granularity=${granularity}`,
    fetcher,
    analyticsConfig,
  );

export const useOpponents = (query: string) =>
  useSWR<OpponentBreakdown[]>(`/analytics/opponents${query}`, fetcher, analyticsConfig);

export const usePartners = (query: string) =>
  useSWR<PartnerBreakdown[]>(`/analytics/partners${query}`, fetcher, analyticsConfig);

export const useVenueAnalytics = (query: string) =>
  useSWR<VenueBreakdown[]>(`/analytics/venues${query}`, fetcher, analyticsConfig);

export const useDisciplines = (query: string) =>
  useSWR<DisciplineBreakdown[]>(`/analytics/disciplines${query}`, fetcher, analyticsConfig);

export const useSituational = (query: string) =>
  useSWR<SituationalResponse>(`/analytics/situational${query}`, fetcher, analyticsConfig);

export const useFatigue = (query: string) =>
  useSWR<FatigueResponse>(`/analytics/fatigue${query}`, fetcher, analyticsConfig);

export const useTagCorrelations = (query: string) =>
  useSWR<TagCorrelation[]>(`/analytics/tags${query}`, fetcher, analyticsConfig);

export const useHeatmap = (query: string) =>
  useSWR<HeatmapResponse>(`/analytics/heatmap${query}`, fetcher, analyticsConfig);

export const useRecords = (query: string) =>
  useSWR<PersonalRecord[]>(`/analytics/records${query}`, fetcher, analyticsConfig);

export const useInsights = (query: string) =>
  useSWR<Insight[]>(`/analytics/insights${query}`, fetcher, analyticsConfig);

export const useRatingHistory = () =>
  useSWR<RatingHistoryPoint[]>('/analytics/rating/history', fetcher, analyticsConfig);

export const useReport = (query: string) =>
  useSWR<PerformanceReport>(`/reports/performance${query}`, fetcher, analyticsConfig);

// --- Entities --------------------------------------------------------------

export const useMatches = (query: string) =>
  useSWR<Paginated<MatchSummary>>(`/matches${query}`, fetcher, { keepPreviousData: true });

export const useMatch = (id: string | null) =>
  useSWR<MatchDetail>(id ? `/matches/${id}` : null, fetcher);

export const useSessions = (query: string) =>
  useSWR<Paginated<SessionSummary>>(`/sessions${query}`, fetcher, { keepPreviousData: true });

export const usePlayers = (query = '?pageSize=100&sort=MOST_PLAYED') =>
  useSWR<Paginated<PlayerSummary>>(`/players${query}`, fetcher);

export const useVenues = (query = '?pageSize=100&sort=MOST_PLAYED') =>
  useSWR<Paginated<VenueSummary>>(`/venues${query}`, fetcher);

export const useGoals = (query = '?pageSize=50') =>
  useSWR<Paginated<GoalProgress>>(`/goals${query}`, fetcher);

export const useAchievements = () => useSWR<AchievementView[]>('/achievements', fetcher);

export const useNotifications = () =>
  useSWR<{
    items: Array<{
      id: string;
      type: string;
      title: string;
      body: string;
      read: boolean;
      createdAt: string;
    }>;
    unreadCount: number;
  }>('/notifications', fetcher);

/**
 * Invalidates every cached view that a new or edited match affects.
 *
 * Recording a match changes the dashboard, the analytics pages, records, goals and
 * achievements all at once. Listing those keys here — rather than at each call site —
 * means a new page cannot forget to refresh.
 */
export function invalidateMatchData(): void {
  void globalMutate(
    (key) =>
      typeof key === 'string' &&
      (key.startsWith('/analytics') ||
        key.startsWith('/matches') ||
        key.startsWith('/sessions') ||
        key.startsWith('/reports') ||
        key.startsWith('/goals') ||
        key.startsWith('/achievements') ||
        key.startsWith('/players') ||
        key.startsWith('/venues') ||
        key.startsWith('/notifications')),
    undefined,
    { revalidate: true },
  );
}

/** Wraps a mutating call with pending state and a readable error message. */
export function useAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      setPending(true);
      setError(null);
      try {
        return await action(...args);
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(
                0,
                'NETWORK_ERROR',
                'Could not reach the server. Check your connection.',
              ),
        );
        return null;
      } finally {
        setPending(false);
      }
    },
    [action],
  );

  return { run, isPending, error, clearError: () => setError(null) };
}
