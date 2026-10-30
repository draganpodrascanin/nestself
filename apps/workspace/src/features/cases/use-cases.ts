/**
 * TanStack Query hooks over the professional client. Lists are metadata only
 * and keyset-paged. Conversation and intake reads return confidential bodies:
 * they go through `withStepUp` (restricted class), are never retried or
 * refetched in the background, and are dropped from the cache the moment the
 * screen unmounts (`gcTime: 0`). Nothing here logs a response.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createProfessionalApi } from '@nestself/api-client';
import type { ProfessionalApi } from '@nestself/api-client';
import { api } from '../../api';
import { useAuth, withStepUp } from '../../auth';

export const professionalApi: ProfessionalApi = createProfessionalApi(api);

/** Rows per page of both conversation lists. */
export const CONVERSATION_PAGE_SIZE = 25;

export const casesKeys = {
  assigned: ['professional', 'assigned'] as const,
  mine: ['professional', 'mine'] as const,
  conversation: (id: string) => ['professional', 'conversation', id] as const,
  myConversation: (id: string) => ['professional', 'my-conversation', id] as const,
  intake: (id: string) => ['professional', 'intake', id] as const,
};

/** Confidential reads: no cache beyond the screen, no retry, no background refetch. */
const RESTRICTED = {
  gcTime: 0,
  staleTime: Infinity,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useAssignedConversations(pro: ProfessionalApi, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: casesKeys.assigned,
    queryFn: ({ pageParam }) =>
      pro.listAssignedConversations({ limit: CONVERSATION_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useMyConversations(pro: ProfessionalApi, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: casesKeys.mine,
    queryFn: ({ pageParam }) =>
      pro.listMyConversations({ limit: CONVERSATION_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** Assigned-expert read of one conversation (`conversation.read.assigned`, step-up). */
export function useExpertConversation(pro: ProfessionalApi, id: string, enabled: boolean) {
  const { stepUp } = useAuth();
  return useQuery({
    queryKey: casesKeys.conversation(id),
    queryFn: () => withStepUp(stepUp, () => pro.getConversation(id)),
    enabled,
    ...RESTRICTED,
  });
}

/** Participant read of the caller's own conversation. */
export function useMyConversation(pro: ProfessionalApi, id: string, enabled: boolean) {
  const { stepUp } = useAuth();
  return useQuery({
    queryKey: casesKeys.myConversation(id),
    queryFn: () => withStepUp(stepUp, () => pro.getMyConversation(id)),
    enabled,
    ...RESTRICTED,
  });
}

/** Assigned-expert read of a case intake; `null` keeps it closed. */
export function useIntake(pro: ProfessionalApi, intakeId: string | null) {
  const { stepUp } = useAuth();
  return useQuery({
    queryKey: casesKeys.intake(intakeId ?? ''),
    queryFn: () => withStepUp(stepUp, () => pro.getIntake(intakeId!)),
    enabled: intakeId !== null,
    ...RESTRICTED,
  });
}
